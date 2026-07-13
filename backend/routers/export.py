"""レポート・CSVエクスポート（要件No.9）

経営者・マネージャーへの共有を前提に、集計済みのKPIをCSVで出力する。
集計ロジックは重複実装せず、dashboard / products の既存ハンドラをそのまま呼び出して
出力の一貫性を保つ（calc_kpis を単一の真実とする方針を踏襲）。

- Excel（日本語環境）で文字化けしないよう UTF-8 BOM 付きで出力する。
- ファイル名は ASCII に固定し、日本語名は RFC 5987 の filename* で付与する。
"""
from datetime import date
from typing import Literal, Optional
from urllib.parse import quote
import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from routers.dashboard import get_dashboard
from routers.products import list_products

router = APIRouter(prefix="/api/export", tags=["export"])


def _csv_response(header: list[str], rows: list[list], ascii_name: str, jp_name: str) -> StreamingResponse:
    """行データを BOM付きUTF-8 CSV の StreamingResponse に変換する。"""
    buf = io.StringIO()
    buf.write("﻿")  # Excel が UTF-8 と認識するための BOM
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(header)
    for r in rows:
        writer.writerow(r)
    buf.seek(0)

    disposition = (
        f"attachment; filename=\"{ascii_name}\"; "
        f"filename*=UTF-8''{quote(jp_name)}"
    )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


def _fmt(v, digits: int = 2):
    """数値を丸めて返す。None は空文字にする。"""
    if v is None:
        return ""
    if isinstance(v, float):
        return round(v, digits)
    return v


# ── サマリKPIのラベル定義（表示順もこれで固定） ──────────────
_SUMMARY_ROWS: list[tuple[str, str, str]] = [
    # (key, ラベル, 単位)
    ("gross", "RPP売上(Gross)", "円"),
    ("gp", "売上総利益(GP)", "円"),
    ("gpr", "売上総利益率(GPR)", "%"),
    ("ad_cost", "広告費(AdCost)", "円"),
    ("rev", "営業利益(Rev)", "円"),
    ("roi", "ROI(投資利益率)", "%"),
    ("roas", "ROAS(売上回収率)", "%"),
    ("cpo", "CPO(注文獲得単価)", "円"),
    ("limit_cpo", "Limit CPO(限界CPO)", "円"),
    ("av", "客単価(Av)", "円"),
    ("cv", "注文件数(CV)", "件"),
    ("ct", "クリック数(CT)", "回"),
    ("cvr", "CVR(注文率)", "%"),
    ("ctr", "CTR(平均クリック率)", "%"),
    ("cpc", "CPC(平均クリック単価)", "円"),
]


@router.get("/summary")
def export_summary(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    """ダッシュボードのKPIサマリをCSV出力する。

    各KPIについて 実績 / 前期比 / YoY を1行にまとめ、末尾に売上目標・達成率を付ける。
    """
    data = get_dashboard(period=period, date_str=date_str, db=db)
    kpis = data.get("kpis")
    changes = data.get("changes") or {}
    period_label = data.get("period_label", "")

    header = ["指標", "実績値", "単位", "前期比(%)", "前年比YoY(%)"]
    rows: list[list] = []

    if kpis:
        for key, label, unit in _SUMMARY_ROWS:
            rows.append([
                label,
                _fmt(kpis.get(key)),
                unit,
                _fmt(changes.get(f"{key}_wow")),
                _fmt(changes.get(f"{key}_yoy")),
            ])

    # KGI（店舗全体売上・目標・達成率）
    shop = data.get("shop")
    kgi_sales = shop.get("sales") if shop else (kpis.get("gross") if kpis else None)
    rows.append(["KGI売上(店舗全体)", _fmt(kgi_sales), "円", "", ""])
    rows.append(["売上目標(KGI)", _fmt(data.get("target_sales")), "円", "", ""])
    rows.append(["目標達成率", _fmt(data.get("achievement_rate")), "%", "", ""])

    period_type = "週次" if period == "weekly" else "月次"
    ascii_name = f"kpi_summary_{period}_{(date_str or date.today().isoformat())[:10]}.csv"
    jp_name = f"KPIサマリ_{period_type}_{period_label}.csv"
    return _csv_response(header, rows, ascii_name, jp_name)


@router.get("/products")
def export_products(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    genre: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """商品別KPI一覧をCSV出力する（売上降順）。"""
    data = list_products(period=period, date_str=date_str, genre=genre, db=db)
    products = data.get("products", [])

    header = [
        "商品管理番号", "商品名", "ジャンル",
        "RPP売上", "売上総利益", "売上総利益率(%)", "広告費",
        "営業利益", "ROI(%)", "ROAS(%)", "客単価",
        "注文件数", "クリック数", "CVR(%)", "CTR(%)", "CPC",
        "CPO", "Limit CPO", "Limit CPO超過",
    ]
    rows: list[list] = []
    for p in products:
        rows.append([
            p.get("management_no", ""),
            p.get("product_name", ""),
            p.get("genre", ""),
            _fmt(p.get("gross")),
            _fmt(p.get("gp")),
            _fmt(p.get("gpr")),
            _fmt(p.get("ad_cost")),
            _fmt(p.get("rev")),
            _fmt(p.get("roi")),
            _fmt(p.get("roas")),
            _fmt(p.get("av")),
            _fmt(p.get("cv")),
            _fmt(p.get("ct")),
            _fmt(p.get("cvr")),
            _fmt(p.get("ctr")),
            _fmt(p.get("cpc")),
            _fmt(p.get("cpo")),
            _fmt(p.get("limit_cpo")),
            "超過" if p.get("limit_cpo_exceeded") else "",
        ])

    period_type = "週次" if period == "weekly" else "月次"
    ascii_name = f"products_kpi_{period}_{(date_str or date.today().isoformat())[:10]}.csv"
    jp_name = f"商品別KPI_{period_type}.csv"
    return _csv_response(header, rows, ascii_name, jp_name)
