import io
import re
import calendar
from datetime import date
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import pandas as pd

from database import get_db
from models import RppWeekly, MonthlyAnalysis, MonthlyItemSales, RppSales, InventoryStatus

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
        existing = db.query(RppWeekly).filter(
            RppWeekly.week_start == rec["week_start"],
            RppWeekly.product_url == rec["product_url"],
        ).first()
        if existing:
            for k, v in rec.items():
                setattr(existing, k, v)
        else:
            db.add(RppWeekly(**rec))


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
    if not content:
        raise HTTPException(status_code=400, detail="ファイルが空です")

    # --- RMS実ファイル形式（メイン処理） ---
    parse_error: Optional[str] = None
    try:
        rpp_sales_recs, rpp_weekly_recs = parse_rpp_real_file(content)
    except ValueError as e:
        parse_error = str(e)
        rpp_sales_recs, rpp_weekly_recs = [], []
    except Exception as e:
        parse_error = f"パース中にエラーが発生しました: {str(e)}"
        rpp_sales_recs, rpp_weekly_recs = [], []

    if rpp_sales_recs:
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
        inserted, updated = _upsert_rpp_sales(db, rpp_sales_recs)
        _upsert_rpp_weekly(db, rpp_weekly_recs)
        # 商品分析データがあればジャンル・商品名を補完（RPPには両列が無いため）
        _sync_rpp_from_monthly(db)
        db.commit()

        period_types = sorted({r["period_type"] for r in rpp_sales_recs})
        year_months = sorted({r["year_month"] for r in rpp_sales_recs})
        return {
            "message": (
                f"{len(rpp_sales_recs)}件をインポートしました"
                f"（{'/'.join(period_types)} / {', '.join(year_months)}）"
            ),
            "count": len(rpp_sales_recs),
            "inserted": inserted,
            "updated": updated,
            "period_types": period_types,
            "year_months": year_months,
            "format": "rms_rpp",
        }

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


@router.post("/monthly-items")
async def import_monthly_items(
    file: UploadFile = File(...),
    overwrite: bool = False,
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        year_month, records = parse_monthly_items_file(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not records:
        raise HTTPException(status_code=400, detail="有効なデータが見つかりませんでした")

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
    db.commit()
    return {
        "message": f"{year_month}のデータをインポートしました（新規: {inserted}件 / 更新: {updated}件）",
        "year_month": year_month,
        "count": len(records),
        "inserted": inserted,
        "updated": updated,
    }
