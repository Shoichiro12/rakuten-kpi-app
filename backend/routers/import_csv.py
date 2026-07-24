import io
import os
import re
import calendar
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query

from malware import scan_bytes  # アップロードのマルウェアスキャン
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import pandas as pd

from database import get_db
from models import RppWeekly, MonthlyAnalysis, MonthlyItemSales, RppSales, InventoryStatus
from masters import get_or_create_default_shop, get_or_create_category, upsert_product, make_cost_resolver

router = APIRouter(prefix="/api/import", tags=["import"])

RPP_COLUMN_MAP = {
    "計測期間": "week_start",
    "商品URL": "product_url",
    "管理番号": "management_no",
    "商品名": "product_name",
    "ジャンル": "genre",
    "RPP売上": "gross",
    "売上原価": "cost_of_sales",
    "広告費": "ad_cost",
    "注文件数": "cv",
    "クリック数": "ct",
    "CTR(%)": "ctr",
    "CPC(円)": "cpc",
    "CTR％": "ctr",
    "CPC円": "cpc",
}

MONTHLY_COLUMN_MAP = {
    "年月": "year_month",
    "商品URL": "product_url",
    "管理番号": "management_no",
    "商品名": "product_name",
    "ジャンル": "genre",
    "売上": "sales",
    "アクセス数": "access_count",
    "注文件数": "cv",
    "転換率(%)": "cvr",
    "客単価": "av",
}

# 楽天RMS 商品分析CSVの実カラム名 → モデルフィールドのマッピング。
# 実CSVのジャンルは単一列「ジャンル」（"大 > 中 > 小" 形式）なので、
# genre_u1/u2/u3 へは _split_genre() で分割して格納する（このマップでは扱わない）。
MONTHLY_ITEM_COLUMN_MAP = {
    "商品管理番号": "management_no",
    "商品名": "product_name",
    "ジャンル": "genre",
    "売上": "sales",
    "売上件数": "cv",
    "売上個数": "sales_qty",
    "アクセス人数": "access_count",   # 転換率の母数（= cv / アクセス人数）
    "ユニークユーザー数": "access_uu",
    "転換率": "cvr",                  # "13.45%" → parse_number で % 除去
    "客単価": "avg_price",
    "在庫数": "stock_count",
    "在庫0日日数": "zero_stock_days",
    "レビュー投稿数": "review_count",
    "レビュー総合評価（点）": "review_score",
}

# 楽天RMS RPP広告レポートCSVの実カラム名 → モデルフィールドのマッピング。
# 実CSVは 12時間/720時間 の集計列が別名で並ぶため、サフィックスごと直接対応させる。
# 売上・件数・CVR・ROAS・CPO はいずれも「(合計720時間)」を主要値として採用する。
RPP_REAL_COLUMN_MAP = {
    "日付": "date_str",
    "商品ページURL": "item_url",
    "商品管理番号": "item_code",
    "入札単価": "bid_price",
    "CTR(%)": "ctr",
    "CPC実績(合計)": "cpc_actual",
    "クリック数(合計)": "ct",
    "実績額(合計)": "ad_cost",
    # 720時間（主要値）
    "売上金額(合計720時間)": "gross_720",
    "売上件数(合計720時間)": "cv_720",
    "CVR(合計720時間)(%)": "cvr_720",
    "ROAS(合計720時間)(%)": "roas_720",
    "注文獲得単価(合計720時間)": "cpo_720",
    # 12時間（参考値）
    "売上金額(合計12時間)": "gross_12",
    "売上件数(合計12時間)": "cv_12",
    "CVR(合計12時間)(%)": "cvr_12",
    "ROAS(合計12時間)(%)": "roas_12",
    "注文獲得単価(合計12時間)": "cpo_12",
}


def parse_number(val) -> float:
    """数値文字列を float に変換。カンマ・円記号・%・全角スペースを除去する。"""
    if val is None:
        return 0.0
    try:
        if pd.isna(val):
            return 0.0
    except (TypeError, ValueError):
        pass
    s = (
        str(val)
        .replace(",", "")
        .replace("¥", "")
        .replace("￥", "")
        .replace("%", "")
        .replace("　", "")
        .strip()
    )
    if s in ("", "-", "nan", "None", "N/A", "―"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _decode_content(content: bytes) -> str:
    """bytes をエンコード自動判別してデコードする。"""
    for enc in ["utf-8-sig", "utf-8", "cp932", "shift_jis"]:
        try:
            return content.decode(enc)
        except Exception:
            continue
    raise ValueError("ファイルのエンコードを判別できませんでした")


def _extract_year_month_from_header(lines: list[str]) -> str:
    """RMS商品分析CSVのヘッダー行から YYYY-MM を抽出する。
    例: '表示期間,2026年05月から2026年05月' → '2026-05'
    """
    # 仕様どおり「表示期間,YYYY年MM月から…」を優先して取得
    for line in lines[:8]:
        m = re.search(r"表示期間.*?(\d{4})年(\d{2})月", line)
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    # フォールバック: 先頭付近の任意の YYYY年MM月
    for line in lines[:8]:
        m = re.search(r"(\d{4})年(\d{2})月", line)
        if m:
            return f"{m.group(1)}-{m.group(2)}"
    raise ValueError("表示期間の行が見つかりません。RMS商品分析CSVをご確認ください。")


def _split_genre(genre) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """単一の「ジャンル」列（例: '靴 > 靴ケア用品・アクセサリー > 靴ひも'）を
    大/中/小分類（genre_u1/u2/u3）に分割する。区切りは半角/全角の '>' 両対応。
    """
    s = str(genre).strip() if genre is not None else ""
    if not s or s == "nan":
        return None, None, None
    parts = [p.strip() for p in re.split(r"[>＞]", s) if p.strip()]
    u1 = parts[0] if len(parts) > 0 else None
    u2 = parts[1] if len(parts) > 1 else None
    u3 = parts[2] if len(parts) > 2 else None
    return u1, u2, u3


def _extract_rpp_period(lines: list[str]) -> Optional[tuple]:
    """RPP広告レポートCSVの「集計期間」行から対象期間を取得する。
    例: '集計期間: 全期間で集計 2026-05-24 - 2026-05-30'
    Returns (period_type, year_month, date_from, date_to) または None。
    """
    pat = re.compile(r"集計期間:.*?(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})")
    for line in lines[:8]:
        m = pat.search(line)
        if not m:
            continue
        d_from, d_to = m.group(1), m.group(2)
        try:
            df_d = date.fromisoformat(d_from)
            dt_d = date.fromisoformat(d_to)
        except ValueError:
            continue
        # 月初〜月末の範囲なら monthly、それ以外は weekly とみなす
        last_day = calendar.monthrange(dt_d.year, dt_d.month)[1]
        is_full_month = (
            df_d.day == 1 and dt_d.day == last_day
            and df_d.year == dt_d.year and df_d.month == dt_d.month
        )
        period_type = "monthly" if is_full_month else "weekly"
        return period_type, d_from[:7], d_from, d_to
    return None


def parse_rpp_date(date_str: str) -> Optional[tuple]:
    """
    楽天RPP CSVの計測期間文字列をパースする。

    週次: '2026年03月01日〜2026年03月07日'
      → ('weekly', '2026-03', '2026-03-01', '2026-03-07')
    月次: '2026年03月'
      → ('monthly', '2026-03', '2026-03-01', '2026-03-31')
    不明: None
    """
    s = str(date_str).strip()
    # 週次: 日付〜日付
    weekly_re = re.compile(r"(\d{4})年(\d{2})月(\d{2})日\s*[〜～\-]\s*(\d{4})年(\d{2})月(\d{2})日")
    ms = weekly_re.search(s)
    if ms:
        y1, mo1, d1, y2, mo2, d2 = ms.groups()
        return "weekly", f"{y1}-{mo1}", f"{y1}-{mo1}-{d1}", f"{y2}-{mo2}-{d2}"

    # 月次: 年月のみ
    monthly_re = re.compile(r"^(\d{4})年(\d{2})月$")
    ms = monthly_re.search(s)
    if ms:
        year, month = ms.groups()
        last = calendar.monthrange(int(year), int(month))[1]
        return "monthly", f"{year}-{month}", f"{year}-{month}-01", f"{year}-{month}-{last:02d}"

    # YYYY-MM-DD〜YYYY-MM-DD (ASCII形式フォールバック)
    ascii_re = re.compile(r"(\d{4}-\d{2}-\d{2})\s*[〜～\-]\s*(\d{4}-\d{2}-\d{2})")
    ms = ascii_re.search(s)
    if ms:
        d_from, d_to = ms.groups()
        ym = d_from[:7]
        return "weekly", ym, d_from, d_to

    return None


class CsvTextPayload(BaseModel):
    csv_text: str
    overwrite: bool = False


def _find_header_row(lines: list[str], marker: str = "計測期間") -> int:
    """指定マーカーを含む行インデックスを返す。見つからない場合は -1。"""
    for i, line in enumerate(lines):
        if marker in line:
            return i
    return -1


def _build_rpp_real_df(lines: list[str]) -> pd.DataFrame:
    """
    楽天RMS RPP広告レポートCSVの生テキスト行リストから DataFrame を構築する。

    - 先頭の説明行（仕様上8行）をスキップし、「商品管理番号」を含む行をヘッダーに使用
    - 12時間/720時間の集計列はそれぞれ別名のため、そのままヘッダーとして読み込む
    - 全カラムを文字列型で読み込む
    """
    header_idx = _find_header_row(lines, "商品管理番号")
    if header_idx < 0:
        raise ValueError("「商品管理番号」列が見つかりません。RPP広告レポートCSVをご確認ください。")

    if not "\n".join(lines[header_idx + 1:]).strip():
        raise ValueError("データ行が見つかりません。")

    csv_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(io.StringIO(csv_text), dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def parse_rpp_real_file(content: bytes) -> tuple[list[dict], list[dict]]:
    """
    楽天RMS RPP CSVファイル（Shift-JIS、先頭～8行スキップ）をパースする。

    週次・月次どちらも同じ関数で処理し、計測期間の書式から period_type を自動判別する。
    Returns:
        rpp_sales_records: RppSales テーブル用レコードのリスト
        rpp_weekly_records: RppWeekly テーブル用レコードのリスト（後方互換）
    """
    # エンコード自動判別（楽天RMSはShift-JIS/CP932が基本）
    text = None
    last_err = None
    for enc in ["cp932", "shift_jis", "utf-8-sig", "utf-8"]:
        try:
            text = content.decode(enc)
            break
        except Exception as e:
            last_err = e
            continue
    if text is None:
        raise ValueError(f"エンコード判別失敗: {last_err}")

    lines = text.splitlines()

    # 期間は仕様どおり「集計期間」行から取得する（データ行に計測期間列は無い）
    file_period = _extract_rpp_period(lines)

    df = _build_rpp_real_df(lines)

    # 実カラム名 → モデルフィールドへリネーム（完全一致）
    col_renames = {
        col: RPP_REAL_COLUMN_MAP[col]
        for col in df.columns
        if col in RPP_REAL_COLUMN_MAP
    }
    df = df.rename(columns=col_renames)

    rpp_sales: list[dict] = []
    rpp_weekly: list[dict] = []

    for _, row in df.iterrows():
        item_code = str(row.get("item_code", "")).strip()
        if item_code in ("", "nan"):
            item_code = ""
        item_url = str(row.get("item_url", "")).strip()
        if item_url == "nan":
            item_url = ""

        # item_code・item_url が両方空の行はスキップ（集計行・合計行等）
        if not item_code and not item_url:
            continue

        # 期間: 集計期間行を最優先。無ければ各行の「日付」列から判定する。
        if file_period:
            period_type, year_month, date_from, date_to = file_period
        else:
            parsed = parse_rpp_date(str(row.get("date_str", "")))
            if not parsed:
                continue
            period_type, year_month, date_from, date_to = parsed

        product_name = str(row.get("product_name", "")).strip()
        if product_name == "nan":
            product_name = ""

        ct = int(parse_number(row.get("ct", 0)))
        ad_cost = int(parse_number(row.get("ad_cost", 0)))
        bid_price = int(parse_number(row.get("bid_price", 0)))
        cpc_actual = parse_number(row.get("cpc_actual", 0))
        ctr = parse_number(row.get("ctr", 0))

        # 売上・件数・CVR・ROAS・CPO は (合計720時間) を主要値、(合計12時間) を参考値とする
        gross_720 = parse_number(row.get("gross_720", 0))
        cv_720 = int(parse_number(row.get("cv_720", 0)))
        cvr_720 = parse_number(row.get("cvr_720", 0))
        roas_720 = parse_number(row.get("roas_720", 0))
        cpo_720 = parse_number(row.get("cpo_720", 0))

        gross_12 = parse_number(row.get("gross_12", 0))
        cv_12 = int(parse_number(row.get("cv_12", 0)))
        cvr_12 = parse_number(row.get("cvr_12", 0))
        roas_12 = parse_number(row.get("roas_12", 0))
        cpo_12 = parse_number(row.get("cpo_12", 0))

        rpp_sales.append({
            "period_type": period_type,
            "year_month": year_month,
            "date_from": date_from,
            "date_to": date_to,
            "item_code": item_code,
            "item_url": item_url,
            "product_name": product_name,
            "bid_price": bid_price,
            "ct": ct,
            "ad_cost": ad_cost,
            "cpc_actual": cpc_actual,
            "ctr": ctr,
            "gross_720": gross_720,
            "cv_720": cv_720,
            "cvr_720": cvr_720,
            "roas_720": roas_720,
            "cpo_720": cpo_720,
            "gross_12": gross_12,
            "cv_12": cv_12,
            "cvr_12": cvr_12,
            "roas_12": roas_12,
            "cpo_12": cpo_12,
        })

        # RppWeekly への後方互換マッピング
        try:
            week_date = date.fromisoformat(date_from)
        except Exception:
            week_date = date.today()

        rpp_weekly.append({
            "week_start": week_date,
            "product_url": item_url if item_url else f"code:{item_code}",
            "management_no": item_code,
            "product_name": product_name,
            "genre": "",
            "gross": gross_720,
            "cost_of_sales": 0.0,
            "ad_cost": float(ad_cost),
            "cv": cv_720,
            "ct": ct,
            "ctr": ctr,
            "cpc": cpc_actual,
            # 二重計上ガード用の一時キー（DB書き込み前に除去される）
            "_period_type": period_type,
            "_year_month": year_month,
        })

    return rpp_sales, rpp_weekly


def parse_rpp_df(df: pd.DataFrame) -> list[dict]:
    """シンプルなRPP CSV（旧形式・テキスト貼り付け）を RppWeekly レコードリストに変換する。"""
    df = df.rename(columns=RPP_COLUMN_MAP)
    required = {"product_url", "gross", "ad_cost", "cv", "ct"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"必須列が見つかりません: {missing}")

    records = []
    for _, row in df.iterrows():
        week_val = row.get("week_start", "")
        if week_val and str(week_val).strip():
            try:
                week_date = pd.to_datetime(str(week_val)).date()
            except Exception:
                week_date = date.today()
        else:
            week_date = date.today()

        records.append({
            "week_start": week_date,
            "product_url": str(row.get("product_url", "")).strip(),
            "management_no": str(row.get("management_no", "")).strip(),
            "product_name": str(row.get("product_name", "")).strip(),
            "genre": str(row.get("genre", "")).strip(),
            "gross": parse_number(row.get("gross", 0)),
            "cost_of_sales": parse_number(row.get("cost_of_sales", 0)),
            "ad_cost": parse_number(row.get("ad_cost", 0)),
            "cv": int(parse_number(row.get("cv", 0))),
            "ct": int(parse_number(row.get("ct", 0))),
            "ctr": parse_number(row.get("ctr", 0)),
            "cpc": parse_number(row.get("cpc", 0)),
        })
    return records


def parse_monthly_items_file(content: bytes):
    """
    Parse real RMS 商品分析 CSV.
    Returns (year_month: str, records: list[dict])
    """
    text = _decode_content(content)
    lines = text.splitlines()

    year_month = _extract_year_month_from_header(lines)

    # Find the data header row (contains 商品管理番号 or 商品URL)
    header_idx = -1
    for i, line in enumerate(lines):
        if "商品管理番号" in line or "商品URL" in line:
            header_idx = i
            break

    if header_idx < 0:
        raise ValueError("列ヘッダー行が見つかりません。RMS商品分析CSVをご確認ください。")

    csv_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(io.StringIO(csv_text), dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.rename(columns=MONTHLY_ITEM_COLUMN_MAP)

    records = []
    for _, row in df.iterrows():
        mgmt_no = str(row.get("management_no", "")).strip()
        product_url = str(row.get("product_url", "")).strip()
        if not mgmt_no or mgmt_no == "nan":
            continue

        stock = int(parse_number(row.get("stock_count", 0)))
        zero_days = int(parse_number(row.get("zero_stock_days", 0)))
        has_inventory = not (stock == 0 or zero_days > 0)

        # ジャンルは単一列（"大 > 中 > 小"）。大/中/小へ分割する。
        genre_u1, genre_u2, genre_u3 = _split_genre(row.get("genre", ""))

        records.append({
            "year_month": year_month,
            "management_no": mgmt_no,
            "product_url": product_url if product_url and product_url != "nan" else None,
            "product_name": str(row.get("product_name", "")).strip() or None,
            "genre_u1": genre_u1,
            "genre_u2": genre_u2,
            "genre_u3": genre_u3,
            "price": parse_number(row.get("price", 0)),
            "stock_count": stock,
            "access_uu": int(parse_number(row.get("access_uu", 0))),
            "access_count": int(parse_number(row.get("access_count", 0))),
            "cvr": parse_number(row.get("cvr", 0)),
            "cv": int(parse_number(row.get("cv", 0))),
            "sales": parse_number(row.get("sales", 0)),
            "sales_qty": int(parse_number(row.get("sales_qty", 0))),
            "cart_count": int(parse_number(row.get("cart_count", 0))),
            "cart_rate": parse_number(row.get("cart_rate", 0)),
            "avg_price": parse_number(row.get("avg_price", 0)),
            "ad_sales": parse_number(row.get("ad_sales", 0)),
            "ad_cost": parse_number(row.get("ad_cost", 0)),
            "roas": parse_number(row.get("roas", 0)),
            "cpo": parse_number(row.get("cpo", 0)),
            "review_count": int(parse_number(row.get("review_count", 0))),
            "review_score": parse_number(row.get("review_score", 0)),
            "fav_count": int(parse_number(row.get("fav_count", 0))),
            "zero_stock_days": zero_days,
            "subscription_cv": int(parse_number(row.get("subscription_cv", 0))),
            "subscription_sales": parse_number(row.get("subscription_sales", 0)),
            "_has_inventory": has_inventory,
        })

    return year_month, records


# ─── RPP simple text import ──────────────────────────────────────────────────

@router.post("/rpp")
def import_rpp_text(payload: CsvTextPayload, db: Session = Depends(get_db)):
    try:
        df = pd.read_csv(io.StringIO(payload.csv_text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV解析エラー: {str(e)}")

    try:
        records = parse_rpp_df(df)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not records:
        raise HTTPException(status_code=400, detail="有効なデータがありません")

    if payload.overwrite:
        week_starts = {r["week_start"] for r in records}
        for ws in week_starts:
            db.query(RppWeekly).filter(RppWeekly.week_start == ws).delete()

    inserted = 0
    for rec in records:
        existing = db.query(RppWeekly).filter(
            RppWeekly.week_start == rec["week_start"],
            RppWeekly.product_url == rec["product_url"],
        ).first()
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
        else:
            db.add(RppWeekly(**rec))
            inserted += 1

    db.commit()
    return {"message": f"{len(records)}件を処理しました（新規: {inserted}件）", "count": len(records)}


def _upsert_rpp_sales(db: Session, rpp_sales_recs: list[dict]) -> tuple[int, int]:
    """RppSales レコードをアップサート。(inserted, updated) を返す。"""
    inserted = updated = 0
    for rec in rpp_sales_recs:
        # UniqueConstraint: (period_type, date_from, date_to, item_code)
        # item_code が空の場合は item_url で代替検索する
        q = db.query(RppSales).filter(
            RppSales.period_type == rec["period_type"],
            RppSales.date_from == rec["date_from"],
            RppSales.date_to == rec["date_to"],
        )
        if rec.get("item_code"):
            q = q.filter(RppSales.item_code == rec["item_code"])
        else:
            q = q.filter(RppSales.item_url == rec["item_url"])

        existing = q.first()
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(RppSales(**rec))
            inserted += 1
    return inserted, updated


def _upsert_rpp_weekly(db: Session, rpp_weekly_recs: list[dict]) -> None:
    """RppWeekly レコードをアップサート（後方互換用）。"""
    for rec in rpp_weekly_recs:
        # 一時キー（_period_type / _year_month 等）はモデルに存在しないため除去
        rec = {k: v for k, v in rec.items() if not k.startswith("_")}
        existing = db.query(RppWeekly).filter(
            RppWeekly.week_start == rec["week_start"],
            RppWeekly.product_url == rec["product_url"],
        ).first()
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
        else:
            db.add(RppWeekly(**rec))


def _month_bounds_ym(ym: str) -> tuple[date, date]:
    """'YYYY-MM' から [月初, 翌月初) の半開区間を返す。"""
    y, m = int(ym[:4]), int(ym[5:7])
    start = date(y, m, 1)
    end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return start, end


def detect_rpp_double_count(db: Session, year_month: Optional[str] = None) -> list[dict]:
    """RppWeekly 内の「週次×月次の二重計上」を検出する。

    同じ月に週次レポートと月次レポートの両方をインポートすると、RppWeekly には
    週ごとの行（週次由来）と月合計の行（月次由来・week_start=月初）が共存し、
    月次集計（ダッシュボード等）が約2倍になる。

    月次由来の行は「week_start が月次レポートの date_from と一致し、かつ
    週次レポートの date_from 集合に含まれない」ことで識別する。
    """
    q = db.query(RppSales.year_month).filter(RppSales.period_type == "monthly")
    if year_month:
        q = q.filter(RppSales.year_month == year_month)
    monthly_yms = {r.year_month for r in q.distinct().all()}

    issues = []
    for ym in sorted(monthly_yms):
        weekly_froms = {
            r.date_from
            for r in db.query(RppSales.date_from).filter(
                RppSales.period_type == "weekly", RppSales.year_month == ym
            ).distinct().all()
        }
        if not weekly_froms:
            continue  # 週次が無ければ RppWeekly は月次由来のみ → 二重計上なし

        monthly_from = db.query(RppSales.date_from).filter(
            RppSales.period_type == "monthly", RppSales.year_month == ym
        ).first()[0]

        if monthly_from in weekly_froms:
            # 月初が日曜で週次と同じ date_from → upsert で相互上書きされている稀ケース。
            # 自動判別不可のため手動対応（該当期間を削除して週次を再取込み）を案内する。
            issues.append({
                "type": "ambiguous_overlap",
                "year_month": ym,
                "rows": 0,
                "fixable": False,
                "detail": f"{ym}: 週次と月次レポートの開始日が同一のため自動修復できません。この月のRPPデータを削除して週次のみ再取込みしてください。",
            })
            continue

        dup_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start == date.fromisoformat(monthly_from)
        ).count()
        if dup_rows > 0:
            issues.append({
                "type": "weekly_monthly_double_count",
                "year_month": ym,
                "rows": dup_rows,
                "fixable": True,
                "detail": f"{ym}: 週次と月次レポートが混在し、月合計行が{dup_rows}件重複しています（広告費・売上が約2倍で集計されます）。",
            })
    return issues


def _sync_rpp_from_monthly(db: Session) -> int:
    """RppWeekly の genre / product_name を商品分析データ（MonthlyItemSales）で補完する。

    RPP広告レポートCSVにはジャンル列・商品名が無く（商品管理番号のみ）、これらの情報は
    商品分析側だけが持つ。そこで management_no を突き合わせ、
      - genre        … genre_u1/u2/u3 を「大/中/小」のスラッシュ連結で設定
      - product_name … 商品分析の商品名で補完（RPP側が空のときのみ）
    を行う。gap_analysis のジャンル別GAPは RppWeekly.genre のスラッシュ区切りを階層分解
    するため、これを満たすことでジャンル別分析・商品名表示が機能する。

    RPP・商品分析どちらのインポート完了時にも呼ぶことで、取込み順序に依存せず紐付く。
    戻り値は更新した RppWeekly 行数。
    """
    # SessionLocal は autoflush=False のため、直前のインポートで追加・削除した
    # レコードを確実に反映させてから集計・更新する。
    db.flush()

    # management_no -> {"genre": "大/中/小", "name": 商品名}
    info_map: dict[str, dict] = {}
    for mno, u1, u2, u3, name in db.query(
        MonthlyItemSales.management_no,
        MonthlyItemSales.genre_u1,
        MonthlyItemSales.genre_u2,
        MonthlyItemSales.genre_u3,
        MonthlyItemSales.product_name,
    ).all():
        if not mno:
            continue
        parts = [str(p).strip() for p in (u1, u2, u3) if p and str(p).strip()]
        info_map[mno] = {
            "genre": "/".join(parts) if parts else None,
            "name": str(name).strip() if name and str(name).strip() else None,
        }

    if not info_map:
        return 0

    updated = 0
    for r in db.query(RppWeekly).all():
        info = info_map.get(r.management_no)
        if not info:
            continue
        changed = False
        # ジャンル: RPPは常に空なので、取得できれば設定する
        if info["genre"] and r.genre != info["genre"]:
            r.genre = info["genre"]
            changed = True
        # 商品名: RPP側が空のときのみ補完（CSV由来の商品名は尊重する）
        if info["name"] and not (r.product_name and r.product_name.strip()):
            r.product_name = info["name"]
            changed = True
        if changed:
            updated += 1
    return updated


def _sync_products_from_rpp(db: Session, rpp_sales_recs: list[dict]) -> int:
    """RPP実データ取込で出てきた management_no を商品マスタ（products）へ upsert する。

    RPP（楽天RMS RPPレポート）にはジャンル情報が無いため category_id=None のまま。
    is_active は upsert_product 側で上書きしない（手動フラグを取込で消さない）。
    戻り値は処理した distinct 商品数。
    """
    if not rpp_sales_recs:
        return 0
    shop = get_or_create_default_shop(db)
    seen: set[str] = set()
    for rec in rpp_sales_recs:
        mno = (rec.get("item_code") or "").strip()
        if not mno or mno in seen:
            continue
        seen.add(mno)
        upsert_product(
            db, mno, shop_id=shop.id,
            product_name=(rec.get("product_name") or None),
            product_url=(rec.get("item_url") or None),
            category_id=None,
        )
    return len(seen)


def _sync_products_from_monthly(db: Session, records: list[dict]) -> int:
    """月次商品分析取込で出てきた management_no を商品マスタ（products）へ upsert する。

    ジャンルは genre_u1/u2/u3 を product_categories に find-or-create して category_id に紐付ける。
    is_active は upsert_product 側で上書きしない。戻り値は処理した distinct 商品数。
    """
    if not records:
        return 0
    shop = get_or_create_default_shop(db)
    seen: set[str] = set()
    for rec in records:
        mno = (rec.get("management_no") or "").strip()
        if not mno or mno in seen:
            continue
        seen.add(mno)
        cat = get_or_create_category(
            db, rec.get("genre_u1"), rec.get("genre_u2"), rec.get("genre_u3")
        )
        upsert_product(
            db, mno, shop_id=shop.id,
            product_name=(rec.get("product_name") or None),
            product_url=(rec.get("product_url") or None),
            category_id=cat.id if cat else None,
        )
    return len(seen)


def _import_rpp_bytes(content: bytes, db: Session, overwrite: bool = False) -> dict:
    """RMS実ファイル形式のRPP CSVバイト列をパースして取り込む。

    失敗（形式不一致・有効行なし）は ValueError を投げる。commit まで行う。
    /rpp/file と /auto・/inbox の取込みが共通で使う唯一の実装。
    """
    rpp_sales_recs, rpp_weekly_recs = parse_rpp_real_file(content)
    if not rpp_sales_recs:
        raise ValueError("有効なデータがありません（RPP広告レポート形式として解析できませんでした）")

    if overwrite:
        # 対象期間のデータを削除
        periods = {(r["period_type"], r["date_from"], r["date_to"]) for r in rpp_sales_recs}
        for pt, df_str, dt_str in periods:
            db.query(RppSales).filter(
                RppSales.period_type == pt,
                RppSales.date_from == df_str,
                RppSales.date_to == dt_str,
            ).delete()

    # ── テーブル役割の整理 ────────────────────────────────────────────
    # rpp_sales  : 楽天RMS RPP CSVの生データを忠実に保持する「生データ保管テーブル」。
    #              720h / 12h の両集計値を持ち、新規 API や将来の分析基盤用。
    # rpp_weekly : 既存の集計エンドポイント（dashboard / gap_analysis）が参照する
    #              後方互換テーブル。gross/cv/ct/ad_cost 等のシンプルな構造。
    #
    # 注意: 1回のインポートで両テーブルに書き込むため、将来 rpp_sales を使った
    #       集計 API を追加する際は rpp_weekly 側と二重計上にならないよう注意すること。
    #       既存の集計処理はすべて rpp_weekly のみを参照しており、現時点で二重計上は発生しない。
    # ─────────────────────────────────────────────────────────────────
    # ── 二重計上ガード（週次×月次の混在防止） ──────────────────────────
    # RppWeekly に同じ月の「週ごとの行」と「月合計の行」が共存すると月次集計が
    # 約2倍になるため、インポート時点で混在を防ぐ。方針: 週次データを正とする。
    months_weekly_new = {r["year_month"] for r in rpp_sales_recs if r["period_type"] == "weekly"}
    months_monthly_new = {r["year_month"] for r in rpp_sales_recs if r["period_type"] == "monthly"}
    guard_notes: list[str] = []

    # (1) 月次レポート: 同月に週次データが既にある/同時に取り込む場合、RppWeekly には書かない
    #     （RppSales への生データ保存は行う。集計は週次由来の行が担う）
    skip_monthly_yms = set()
    for ym in months_monthly_new:
        has_weekly = ym in months_weekly_new or db.query(RppSales).filter(
            RppSales.period_type == "weekly", RppSales.year_month == ym
        ).count() > 0
        if has_weekly:
            skip_monthly_yms.add(ym)
            guard_notes.append(f"{ym}は週次データがあるため月次レポートは生データのみ保存（二重計上防止）")
    if skip_monthly_yms:
        rpp_weekly_recs = [
            rec for rec in rpp_weekly_recs
            if not (rec.get("_period_type") == "monthly" and rec.get("_year_month") in skip_monthly_yms)
        ]

    # (2) 週次レポート: その月に「月次レポートのみ」だった場合、既存の RppWeekly 行は
    #     すべて月次由来（月合計行）なので削除してから週次の行を書く
    for ym in months_weekly_new:
        had_weekly_before = db.query(RppSales).filter(
            RppSales.period_type == "weekly", RppSales.year_month == ym
        ).count() > 0
        has_monthly = db.query(RppSales).filter(
            RppSales.period_type == "monthly", RppSales.year_month == ym
        ).count() > 0
        if has_monthly and not had_weekly_before:
            m_start, m_end = _month_bounds_ym(ym)
            purged = db.query(RppWeekly).filter(
                RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
            ).delete()
            if purged:
                guard_notes.append(f"{ym}の月次由来の集計行{purged}件を週次データで置き換え（二重計上防止）")
    # ─────────────────────────────────────────────────────────────────

    # ── 原価の焼き込み ────────────────────────────────────────────────
    # cost_of_sales = gross × resolve_rate(management_no)（従来の 0.0 固定を廃止）。
    # 解決順: ProductCost.cost_rate（商品別）→ Shop.default_cost_rate（店舗デフォルト）→ 0.6。
    # これにより calc_kpis の GP / GPR / LimitCPO / ROI / Rev が自然に機能し始める。
    _resolve_rate = make_cost_resolver(db)
    for _rec in rpp_weekly_recs:
        _rec["cost_of_sales"] = round(_rec.get("gross", 0) * _resolve_rate(_rec.get("management_no")), 0)

    inserted, updated = _upsert_rpp_sales(db, rpp_sales_recs)
    _upsert_rpp_weekly(db, rpp_weekly_recs)
    # 商品分析データがあればジャンル・商品名を補完（RPPには両列が無いため）
    _sync_rpp_from_monthly(db)
    # 商品マスタへ upsert（RPP由来はジャンル情報が無いため category_id=None）
    _sync_products_from_rpp(db, rpp_sales_recs)
    db.commit()

    period_types = sorted({r["period_type"] for r in rpp_sales_recs})
    year_months = sorted({r["year_month"] for r in rpp_sales_recs})
    _note = f"／{'・'.join(guard_notes)}" if guard_notes else ""
    return {
        "message": (
            f"{len(rpp_sales_recs)}件をインポートしました"
            f"（{'/'.join(period_types)} / {', '.join(year_months)}）{_note}"
        ),
        "count": len(rpp_sales_recs),
        "inserted": inserted,
        "updated": updated,
        "period_types": period_types,
        "year_months": year_months,
        "format": "rms_rpp",
    }


@router.post("/rpp/file")
async def import_rpp_file(
    file: UploadFile = File(...),
    overwrite: bool = False,
    db: Session = Depends(get_db),
):
    """
    楽天RMS RPPレポートCSVをインポートする（週次・月次どちらも対応）。

    - Shift-JIS (CP932) エンコードを優先して自動判別
    - 計測期間の書式から weekly/monthly を自動判別
    - RppSales テーブルと RppWeekly テーブル（後方互換）の両方に保存
    - overwrite=true の場合、同一期間の既存データを削除してから挿入
    """
    content = await file.read()

    scan_bytes(content, getattr(file, 'filename', 'upload') or 'upload')
    if not content:
        raise HTTPException(status_code=400, detail="ファイルが空です")

    # --- RMS実ファイル形式（メイン処理） ---
    parse_error: Optional[str] = None
    try:
        return _import_rpp_bytes(content, db, overwrite=overwrite)
    except ValueError as e:
        parse_error = str(e)
    except Exception as e:
        parse_error = f"パース中にエラーが発生しました: {str(e)}"

    # --- フォールバック: シンプル形式（テキスト貼り付け等） ---
    df = None
    for enc in ["utf-8-sig", "utf-8", "shift_jis", "cp932"]:
        try:
            df = pd.read_csv(io.BytesIO(content), encoding=enc)
            break
        except Exception:
            continue

    if df is None:
        # RMS実ファイルのパースエラーがあればそちらを優先して返す
        detail = parse_error or "CSVファイルの読み込みに失敗しました"
        raise HTTPException(status_code=400, detail=detail)

    try:
        records = parse_rpp_df(df)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not records:
        raise HTTPException(status_code=400, detail="有効なデータがありません")

    _upsert_rpp_weekly(db, records)
    db.commit()
    return {
        "message": f"{len(records)}件をインポートしました",
        "count": len(records),
        "inserted": len(records),
        "updated": 0,
        "format": "simple",
    }


@router.get("/rpp/template")
def get_rpp_template():
    header = "計測期間,商品URL,管理番号,商品名,ジャンル,RPP売上,売上原価,広告費,注文件数,クリック数,CTR(%),CPC(円)"
    sample = "2024-01-07,https://item.rakuten.co.jp/shop/item001/,ITEM-001,サンプル商品,カテゴリ,100000,60000,12000,20,800,1.2,150"
    return JSONResponse(
        content={"template": f"{header}\n{sample}"},
        headers={"Content-Disposition": "attachment; filename=rpp_template.csv"},
    )


# ─── RPP Sales データ取得エンドポイント ─────────────────────────────────────

@router.get("/rpp/sales")
def get_rpp_sales(
    period_type: Optional[Literal["weekly", "monthly"]] = Query(None),
    year_month: Optional[str] = Query(None, description="YYYY-MM 形式"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD 形式"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD 形式"),
    item_code: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    インポート済み RPP 売上データを取得する。

    クエリパラメータで期間種別・年月・商品コード等でフィルタリング可能。
    """
    q = db.query(RppSales)
    if period_type:
        q = q.filter(RppSales.period_type == period_type)
    if year_month:
        q = q.filter(RppSales.year_month == year_month)
    if date_from:
        q = q.filter(RppSales.date_from >= date_from)
    if date_to:
        q = q.filter(RppSales.date_to <= date_to)
    if item_code:
        q = q.filter(RppSales.item_code == item_code)

    total = q.count()
    rows = q.order_by(RppSales.date_from.desc(), RppSales.item_code).offset(offset).limit(limit).all()

    def row_to_dict(r: RppSales) -> dict:
        return {
            "id": r.id,
            "period_type": r.period_type,
            "year_month": r.year_month,
            "date_from": r.date_from,
            "date_to": r.date_to,
            "item_code": r.item_code,
            "item_url": r.item_url,
            "product_name": r.product_name,
            "bid_price": r.bid_price,
            "ct": r.ct,
            "ad_cost": r.ad_cost,
            "cpc_actual": r.cpc_actual,
            "ctr": r.ctr,
            "gross_720": r.gross_720,
            "cv_720": r.cv_720,
            "cvr_720": r.cvr_720,
            "roas_720": r.roas_720,
            "cpo_720": r.cpo_720,
            "gross_12": r.gross_12,
            "cv_12": r.cv_12,
            "cvr_12": r.cvr_12,
            "roas_12": r.roas_12,
            "cpo_12": r.cpo_12,
        }

    return {
        "total": total,
        "count": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [row_to_dict(r) for r in rows],
    }


@router.get("/rpp/periods")
def get_rpp_periods(db: Session = Depends(get_db)):
    """
    インポート済み RPP データの期間一覧を返す。
    フロントエンドのドロップダウン（週・月選択）用。
    """
    from sqlalchemy import distinct

    weekly_rows = (
        db.query(RppSales.year_month, RppSales.date_from, RppSales.date_to)
        .filter(RppSales.period_type == "weekly")
        .distinct()
        .order_by(RppSales.date_from.desc())
        .all()
    )
    monthly_rows = (
        db.query(RppSales.year_month)
        .filter(RppSales.period_type == "monthly")
        .distinct()
        .order_by(RppSales.year_month.desc())
        .all()
    )

    return {
        "weekly": [
            {"year_month": r.year_month, "date_from": r.date_from, "date_to": r.date_to}
            for r in weekly_rows
        ],
        "monthly": [{"year_month": r.year_month} for r in monthly_rows],
    }


@router.get("/rpp/summary")
def get_rpp_summary(
    period_type: Literal["weekly", "monthly"] = Query("weekly"),
    year_month: Optional[str] = Query(None, description="YYYY-MM 形式"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD 形式（週次の場合）"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD 形式（週次の場合）"),
    db: Session = Depends(get_db),
):
    """
    RPP 売上データの集計サマリーを返す（対象期間の合計値）。

    広告費・売上・ROAS・CPO・CVR等の KPI を集計して返す。
    """
    q = db.query(RppSales).filter(RppSales.period_type == period_type)
    if year_month:
        q = q.filter(RppSales.year_month == year_month)
    if date_from:
        q = q.filter(RppSales.date_from == date_from)
    if date_to:
        q = q.filter(RppSales.date_to == date_to)

    rows = q.all()
    if not rows:
        return {
            "period_type": period_type,
            "year_month": year_month,
            "count": 0,
            "summary": {},
        }

    total_ad_cost = sum(r.ad_cost for r in rows)
    total_ct = sum(r.ct for r in rows)
    total_gross_720 = sum(r.gross_720 for r in rows)
    total_cv_720 = sum(r.cv_720 for r in rows)
    total_gross_12 = sum(r.gross_12 for r in rows)
    total_cv_12 = sum(r.cv_12 for r in rows)

    def safe_div(n, d):
        return round(n / d, 2) if d else 0.0

    summary = {
        "total_ad_cost": total_ad_cost,
        "total_ct": total_ct,
        "avg_cpc": safe_div(total_ad_cost, total_ct),
        # 720h（広告経由720時間以内）
        "total_gross_720": total_gross_720,
        "total_cv_720": total_cv_720,
        "roas_720": round(safe_div(total_gross_720, total_ad_cost) * 100, 1),
        "cpo_720": round(safe_div(total_ad_cost, total_cv_720), 0),
        "cvr_720": round(safe_div(total_cv_720, total_ct) * 100, 2),
        # 12h（広告経由12時間以内）
        "total_gross_12": total_gross_12,
        "total_cv_12": total_cv_12,
        "roas_12": round(safe_div(total_gross_12, total_ad_cost) * 100, 1),
        "cpo_12": round(safe_div(total_ad_cost, total_cv_12), 0),
        "cvr_12": round(safe_div(total_cv_12, total_ct) * 100, 2),
    }

    return {
        "period_type": period_type,
        "year_month": year_month,
        "date_from": date_from,
        "date_to": date_to,
        "count": len(rows),
        "summary": summary,
    }


# ─── Monthly analysis (simple text) ─────────────────────────────────────────

@router.post("/monthly")
def import_monthly_text(payload: CsvTextPayload, db: Session = Depends(get_db)):
    try:
        df = pd.read_csv(io.StringIO(payload.csv_text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV解析エラー: {str(e)}")

    df = df.rename(columns=MONTHLY_COLUMN_MAP)
    required = {"product_url", "year_month"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"必須列が見つかりません: {missing}")

    for _, row in df.iterrows():
        existing = db.query(MonthlyAnalysis).filter(
            MonthlyAnalysis.year_month == str(row.get("year_month", "")).strip(),
            MonthlyAnalysis.product_url == str(row.get("product_url", "")).strip(),
        ).first()
        rec = {
            "year_month": str(row.get("year_month", "")).strip(),
            "product_url": str(row.get("product_url", "")).strip(),
            "management_no": str(row.get("management_no", "")).strip(),
            "product_name": str(row.get("product_name", "")).strip(),
            "genre": str(row.get("genre", "")).strip(),
            "sales": parse_number(row.get("sales", 0)),
            "access_count": int(parse_number(row.get("access_count", 0))),
            "cv": int(parse_number(row.get("cv", 0))),
        }
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
        else:
            db.add(MonthlyAnalysis(**rec))

    db.commit()
    return {"message": f"{len(df)}件をインポートしました"}


# ─── Monthly item sales (RMS 商品分析 CSV) ───────────────────────────────────

@router.post("/monthly-items/preview")
async def preview_monthly_items(file: UploadFile = File(...)):
    content = await file.read()

    scan_bytes(content, getattr(file, 'filename', 'upload') or 'upload')
    try:
        year_month, records = parse_monthly_items_file(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not records:
        raise HTTPException(status_code=400, detail="有効なデータが見つかりませんでした")

    total_sales = sum(r["sales"] for r in records)
    total_access = sum(r["access_uu"] for r in records)
    total_cv = sum(r["cv"] for r in records)
    total_access_all = sum(r["access_count"] for r in records)
    avg_cvr = round((total_cv / total_access_all * 100) if total_access_all > 0 else 0, 2)
    no_stock = sum(1 for r in records if not r["_has_inventory"])

    top = sorted(records, key=lambda r: r["sales"], reverse=True)[:5]
    top_products = [
        {"management_no": r["management_no"], "product_name": r["product_name"], "sales": r["sales"]}
        for r in top
    ]

    return {
        "year_month": year_month,
        "count": len(records),
        "total_sales": total_sales,
        "total_access_uu": total_access,
        "avg_cvr": avg_cvr,
        "no_stock_count": no_stock,
        "top_products": top_products,
    }


def _import_monthly_items_bytes(content: bytes, db: Session, overwrite: bool = False) -> dict:
    """RMS商品分析CSVバイト列をパースして取り込む。

    失敗（形式不一致・有効行なし）は ValueError を投げる。commit まで行う。
    /monthly-items と /auto・/inbox の取込みが共通で使う唯一の実装。
    """
    year_month, records = parse_monthly_items_file(content)

    if not records:
        raise ValueError("有効なデータが見つかりませんでした")

    if overwrite:
        db.query(MonthlyItemSales).filter(MonthlyItemSales.year_month == year_month).delete()

    inserted = updated = 0
    for rec in records:
        has_inv = rec.pop("_has_inventory")
        existing = db.query(MonthlyItemSales).filter(
            MonthlyItemSales.management_no == rec["management_no"],
            MonthlyItemSales.year_month == rec["year_month"],
        ).first()
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(MonthlyItemSales(**rec))
            inserted += 1

        # Auto-update InventoryStatus when product_url is available
        purl = rec.get("product_url")
        if purl:
            inv = db.query(InventoryStatus).filter(InventoryStatus.product_url == purl).first()
            if inv:
                inv.has_inventory = has_inv
            elif not has_inv:
                db.add(InventoryStatus(product_url=purl, has_inventory=False))
    # 取込んだジャンル・商品名を既存のRPPデータにも紐付ける（取込み順序に依存しない）
    _sync_rpp_from_monthly(db)
    # 商品マスタへ upsert（ジャンルを product_categories に正規化して紐付け）
    _sync_products_from_monthly(db, records)
    db.commit()
    return {
        "message": f"{year_month}のデータをインポートしました（新規: {inserted}件 / 更新: {updated}件）",
        "year_month": year_month,
        "count": len(records),
        "inserted": inserted,
        "updated": updated,
    }


@router.post("/monthly-items")
async def import_monthly_items(
    file: UploadFile = File(...),
    overwrite: bool = False,
    db: Session = Depends(get_db),
):
    content = await file.read()

    scan_bytes(content, getattr(file, 'filename', 'upload') or 'upload')
    try:
        return _import_monthly_items_bytes(content, db, overwrite=overwrite)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── かんたん取込み（zip・複数ファイル・種別自動判別） ────────────────────────
#
# 「RMSからダウンロードしたファイルを、zipのまま・種別を選ばずに放り込むだけ」を
# 実現する取込み経路。既存の /rpp/file・/monthly-items は個別取込みとして温存し、
# 実際の書き込みは _import_rpp_bytes / _import_monthly_items_bytes を共用する。

# zip展開の安全上限（zip爆弾・誤爆対策）
_ZIP_MAX_MEMBERS = 50
_ZIP_MAX_MEMBER_SIZE = 50 * 1024 * 1024  # 50MB/ファイル


def _detect_kind(content: bytes) -> Optional[Literal["rpp", "monthly"]]:
    """CSVバイト列の先頭部分から、RPP広告レポートか商品分析レポートかを判別する。

    ファイル名ではなく内容で判定する（リネームされていても正しく取り込むため）。
    - RPP広告レポート: 5行目に「集計期間」、ヘッダーに「実績額(合計)」等
    - 商品分析レポート: 3行目に「表示期間」、ヘッダーに「アクセス人数」等
    """
    try:
        text = _decode_content(content)
    except ValueError:
        return None
    head = "\n".join(text.splitlines()[:15])
    if "集計期間" in head or "実績額(合計)" in head or "売上金額(合計720時間)" in head:
        return "rpp"
    if "表示期間" in head or "アクセス人数" in head:
        return "monthly"
    return None


def _iter_csv_payloads(filename: str, content: bytes) -> list[tuple[str, bytes]]:
    """アップロード1件を (表示名, CSVバイト列) のリストに展開する。

    - zip（拡張子 .zip または PK マジックナンバー）: 中のCSVを展開して返す
    - それ以外: そのまま1件として返す
    zipfile.BadZipFile は呼び出し元でハンドリングする。
    """
    is_zip = filename.lower().endswith(".zip") or content[:2] == b"PK"
    if not is_zip:
        return [(filename, content)]

    payloads: list[tuple[str, bytes]] = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for info in zf.infolist()[:_ZIP_MAX_MEMBERS]:
            if info.is_dir():
                continue
            if not info.filename.lower().endswith(".csv"):
                continue
            if info.file_size > _ZIP_MAX_MEMBER_SIZE:
                continue
            inner_name = Path(info.filename).name
            payloads.append((f"{filename} 内の {inner_name}", zf.read(info)))
    return payloads


def _import_one(name: str, content: bytes, db: Session) -> dict:
    """CSV1件を種別自動判別して取り込み、結果dictを返す（例外は投げない）。"""
    kind = _detect_kind(content)
    if kind == "rpp":
        try:
            r = _import_rpp_bytes(content, db)
            return {
                "source": name, "kind": "rpp", "ok": True,
                "message": r["message"], "count": r["count"],
                "inserted": r["inserted"], "updated": r["updated"],
            }
        except ValueError as e:
            db.rollback()
            return {"source": name, "kind": "rpp", "ok": False, "message": str(e)}
        except Exception as e:
            db.rollback()
            return {"source": name, "kind": "rpp", "ok": False, "message": f"取込みエラー: {e}"}
    if kind == "monthly":
        try:
            r = _import_monthly_items_bytes(content, db)
            return {
                "source": name, "kind": "monthly", "ok": True,
                "message": r["message"], "count": r["count"],
                "inserted": r["inserted"], "updated": r["updated"],
                "year_month": r["year_month"],
            }
        except ValueError as e:
            db.rollback()
            return {"source": name, "kind": "monthly", "ok": False, "message": str(e)}
        except Exception as e:
            db.rollback()
            return {"source": name, "kind": "monthly", "ok": False, "message": f"取込みエラー: {e}"}
    return {
        "source": name, "kind": "unknown", "ok": False,
        "message": "RPP広告レポート・商品分析レポートのどちらの形式にも該当しませんでした",
    }


def _import_uploads(items: list[tuple[str, bytes]], db: Session) -> dict:
    """(表示名, bytes) のリストを順に取り込み、結果サマリーを返す。"""
    results: list[dict] = []
    for filename, content in items:
        if not content:
            results.append({"source": filename, "kind": "unknown", "ok": False, "message": "ファイルが空です"})
            continue
        try:
            payloads = _iter_csv_payloads(filename, content)
        except zipfile.BadZipFile:
            results.append({"source": filename, "kind": "unknown", "ok": False, "message": "zipファイルを展開できませんでした"})
            continue
        if not payloads:
            results.append({"source": filename, "kind": "unknown", "ok": False, "message": "zip内にCSVファイルが見つかりませんでした"})
            continue
        for name, data in payloads:
            results.append(_import_one(name, data, db))

    ok_count = sum(1 for r in results if r["ok"])
    return {"results": results, "ok_count": ok_count, "ng_count": len(results) - ok_count}


@router.post("/auto")
async def import_auto(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    """まとめて取込み: CSV/zipを複数受け取り、種別自動判別で一括インポートする。

    ファイル単位の失敗はエラーにせず、結果リストで返す（常にJSONを返す規約に従う）。
    """
    items: list[tuple[str, bytes]] = []
    for up in files:
        content = await up.read()

        scan_bytes(content, getattr(up, 'filename', 'upload') or 'upload')
        items.append((up.filename or "アップロードファイル", content))
    return _import_uploads(items, db)


# ─── ダウンロードフォルダからの取込み ────────────────────────────────────────

def _inbox_dir() -> Path:
    """RMSレポートの自動検出対象フォルダ。既定はユーザーのダウンロードフォルダ。

    backend/.env の RMS_INBOX_DIR で変更できる（ローカル利用専用の機能。
    DATABASE_URL等で外部DBに接続する本番構成ではフォルダが存在しないため空を返すだけ）。
    """
    d = os.environ.get("RMS_INBOX_DIR", "").strip()
    return Path(d) if d else (Path.home() / "Downloads")


def _guess_kind_from_name(name_lower: str) -> Optional[str]:
    """ファイル名からRMSレポートらしさを推定する（inbox一覧の絞り込み用）。

    確定判定はあくまで内容ベース（_detect_kind）で行い、これは候補抽出のみに使う。
    """
    # 例: rpp_item_reports_kutsugoods_20260708131719323.zip
    if "rpp" in name_lower:
        return "rpp"
    # 例: 202607_item_list.csv / itemsales系
    if "item_list" in name_lower or re.match(r"^\d{6}_item", name_lower):
        return "monthly"
    return None


@router.get("/inbox")
def list_inbox_files():
    """ダウンロードフォルダ内のRMSレポート候補ファイル一覧を返す（新しい順・最大20件）。"""
    d = _inbox_dir()
    if not d.is_dir():
        return {"dir": str(d), "files": []}

    cutoff = datetime.now() - timedelta(days=60)
    files: list[dict] = []
    try:
        entries = list(d.iterdir())
    except OSError:
        return {"dir": str(d), "files": []}

    for p in entries:
        try:
            if not p.is_file():
                continue
            low = p.name.lower()
            if not (low.endswith(".csv") or low.endswith(".zip")):
                continue
            guess = _guess_kind_from_name(low)
            if guess is None:
                continue
            st = p.stat()
            mtime = datetime.fromtimestamp(st.st_mtime)
            if mtime < cutoff:
                continue
            files.append({
                "name": p.name,
                "size": st.st_size,
                "modified": mtime.strftime("%Y-%m-%d %H:%M"),
                "kind_guess": guess,
            })
        except OSError:
            continue

    files.sort(key=lambda f: f["modified"], reverse=True)
    return {"dir": str(d), "files": files[:20]}


class InboxImportPayload(BaseModel):
    files: list[str]


@router.post("/inbox")
def import_inbox_files(payload: InboxImportPayload, db: Session = Depends(get_db)):
    """ダウンロードフォルダ内の指定ファイルを取り込む（ファイル名のみ受付・パス走査防止）。"""
    d = _inbox_dir()
    items: list[tuple[str, bytes]] = []
    results_pre: list[dict] = []
    for raw in payload.files[:20]:
        name = Path(raw).name  # パス区切りを除去し、フォルダ外参照を防ぐ
        p = d / name
        if not p.is_file():
            results_pre.append({"source": name, "kind": "unknown", "ok": False, "message": "ファイルが見つかりません"})
            continue
        try:
            items.append((name, p.read_bytes()))
        except OSError as e:
            results_pre.append({"source": name, "kind": "unknown", "ok": False, "message": f"読み取りエラー: {e}"})

    result = _import_uploads(items, db)
    result["results"] = results_pre + result["results"]
    result["ng_count"] += len(results_pre)
    return result


# ─── データ整合性チェック（二重計上の常時監視） ──────────────────────────────


@router.get("/integrity")
def check_integrity(db: Session = Depends(get_db)):
    """インポート済みデータの整合性チェック。

    現在の検出項目:
      - weekly_monthly_double_count: 週次×月次レポート混在による二重計上（自動修復可）
      - ambiguous_overlap          : 開始日が同一で自動判別不可（手動対応を案内）
      - duplicate_weekly_rows      : 同一週×同一商品管理番号の重複行（URL表記ゆれ等）
    """
    issues = detect_rpp_double_count(db)

    # 同一 (week_start, management_no) で複数行 → product_url の表記ゆれ等による重複
    from sqlalchemy import func as _f
    dup_pairs = (
        db.query(RppWeekly.week_start, RppWeekly.management_no, _f.count(RppWeekly.id))
        .filter(RppWeekly.management_no.isnot(None), RppWeekly.management_no != "")
        .group_by(RppWeekly.week_start, RppWeekly.management_no)
        .having(_f.count(RppWeekly.id) > 1)
        .all()
    )
    if dup_pairs:
        total = sum(c for _, _, c in dup_pairs)
        sample = ", ".join(f"{mno}({ws})" for ws, mno, _ in dup_pairs[:5])
        issues.append({
            "type": "duplicate_weekly_rows",
            "year_month": None,
            "rows": total,
            "fixable": False,
            "detail": f"同一週×同一商品管理番号の重複行が{len(dup_pairs)}組あります（例: {sample}）。該当週を削除して再取込みしてください。",
        })

    return {"ok": len(issues) == 0, "issues": issues}


@router.post("/integrity/fix")
def fix_integrity(db: Session = Depends(get_db)):
    """自動修復可能な整合性問題を修復する。

    週次×月次の二重計上: 月次由来の月合計行（week_start=月次レポートのdate_from、
    かつ週次レポートの開始日と重ならないもの）を RppWeekly から削除する。
    RppSales の生データは削除しない（RPP分析画面の月次表示はそのまま使える）。
    """
    issues = detect_rpp_double_count(db)
    deleted_total = 0
    fixed_months = []

    for issue in issues:
        if not issue["fixable"]:
            continue
        ym = issue["year_month"]
        monthly_from = db.query(RppSales.date_from).filter(
            RppSales.period_type == "monthly", RppSales.year_month == ym
        ).first()[0]
        deleted = db.query(RppWeekly).filter(
            RppWeekly.week_start == date.fromisoformat(monthly_from)
        ).delete()
        deleted_total += deleted
        fixed_months.append(ym)

    db.commit()

    if not fixed_months:
        return {"message": "自動修復可能な問題はありませんでした", "deleted": 0, "fixed_months": []}
    return {
        "message": f"{', '.join(fixed_months)} の月次由来の重複行{deleted_total}件を削除しました（週次データはそのまま）",
        "deleted": deleted_total,
        "fixed_months": fixed_months,
    }


# ─── インポート済みデータの個別削除・期間一覧 ────────────────────────────────
#
# 「全削除（/reset-data）しかない」問題への対応。期間（週・月）単位で
# RPPデータ・月次商品分析データを個別に削除できるようにする。


@router.get("/monthly-items/periods")
def get_monthly_items_periods(db: Session = Depends(get_db)):
    """インポート済みの月次商品分析データの年月一覧（件数付き）を返す。"""
    from sqlalchemy import func

    rows = (
        db.query(MonthlyItemSales.year_month, func.count(MonthlyItemSales.id))
        .group_by(MonthlyItemSales.year_month)
        .order_by(MonthlyItemSales.year_month.desc())
        .all()
    )
    return {"months": [{"year_month": ym, "rows": cnt} for ym, cnt in rows]}


@router.delete("/monthly-items/{year_month}")
def delete_monthly_items(year_month: str, db: Session = Depends(get_db)):
    """指定年月（YYYY-MM）の月次商品分析データを削除する。"""
    if not re.fullmatch(r"\d{4}-\d{2}", year_month):
        raise HTTPException(status_code=400, detail="year_month は YYYY-MM 形式で指定してください")

    deleted = db.query(MonthlyItemSales).filter(
        MonthlyItemSales.year_month == year_month
    ).delete()
    db.commit()
    if deleted == 0:
        return {"message": f"{year_month} のデータは見つかりませんでした", "deleted": 0}
    return {"message": f"{year_month} の商品分析データを削除しました（{deleted}件）", "deleted": deleted}


@router.delete("/rpp/period")
def delete_rpp_period(
    period_type: Literal["weekly", "monthly"] = Query(...),
    date_from: Optional[str] = Query(None, description="週次のみ必須。YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="週次のみ必須。YYYY-MM-DD"),
    year_month: Optional[str] = Query(None, description="月次のみ必須。YYYY-MM"),
    db: Session = Depends(get_db),
):
    """指定期間のRPPデータを削除する。

    - weekly : date_from / date_to で特定される週のデータを RppSales・RppWeekly の
               両テーブルから削除する（1インポートで両方に書く設計のため対で消す）。
    - monthly: year_month の RppSales（月次）を削除する。RppWeekly は同月に週次データが
               残っている場合は削除しない（週次インポート由来の行を巻き添えにしないため）。
    """
    if period_type == "weekly":
        if not date_from or not date_to:
            raise HTTPException(status_code=400, detail="週次削除には date_from / date_to が必要です")
        try:
            d_from = date.fromisoformat(date_from)
            d_to = date.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(status_code=400, detail="日付は YYYY-MM-DD 形式で指定してください")

        deleted_sales = db.query(RppSales).filter(
            RppSales.period_type == "weekly",
            RppSales.date_from == date_from,
            RppSales.date_to == date_to,
        ).delete()
        # RppWeekly は週開始日（日曜）で保持しているため、期間内の week_start を削除する
        deleted_weekly = db.query(RppWeekly).filter(
            RppWeekly.week_start >= d_from,
            RppWeekly.week_start <= d_to,
        ).delete()
        db.commit()
        return {
            "message": f"{date_from} 〜 {date_to} のRPPデータを削除しました（生データ{deleted_sales}件 / 集計{deleted_weekly}件）",
            "deleted_sales": deleted_sales,
            "deleted_weekly": deleted_weekly,
        }

    # monthly
    if not year_month or not re.fullmatch(r"\d{4}-\d{2}", year_month):
        raise HTTPException(status_code=400, detail="月次削除には year_month（YYYY-MM）が必要です")

    deleted_sales = db.query(RppSales).filter(
        RppSales.period_type == "monthly",
        RppSales.year_month == year_month,
    ).delete()

    # 同月に週次の生データが残っている場合、RppWeekly は週次インポート由来のため保持する
    weekly_remains = db.query(RppSales).filter(
        RppSales.period_type == "weekly",
        RppSales.year_month == year_month,
    ).count()

    deleted_weekly = 0
    if weekly_remains == 0:
        y, m = int(year_month[:4]), int(year_month[5:7])
        m_start = date(y, m, 1)
        m_end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        deleted_weekly = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start,
            RppWeekly.week_start < m_end,
        ).delete()

    db.commit()
    note = "" if weekly_remains == 0 else f"（同月に週次データが{weekly_remains}件あるため集計テーブルは保持）"
    return {
        "message": f"{year_month} の月次RPPデータを削除しました{note}",
        "deleted_sales": deleted_sales,
        "deleted_weekly": deleted_weekly,
    }
