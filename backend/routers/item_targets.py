# -*- coding: utf-8 -*-
"""アイテム別目標API（/api/item-targets。設計ドキュメント2026-08-01 3-B''・第3段階）。

- 利用者が入力するのは「アイテム別の目標売上」のみ（1件ずつ。一括入力は別チケット）
- 目標CVR・客単価・必要アクセス数は target_calc.py の確定公式で自動算出
- 実績が無い商品は推定値（参考値）＋承認フロー。承認まで診断・逆算には使わない
"""
import csv
import io
from typing import List, Optional
from urllib.parse import quote

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ItemTarget, MonthlyItemSales, Product, ProductCategory
from masters import inactive_management_nos
from target_calc import apply_calc, calc_item_target

router = APIRouter(prefix="/api/item-targets", tags=["item-targets"])


class ItemTargetIn(BaseModel):
    management_no: str
    year_month: str      # YYYY-MM
    target_sales: float


class ItemTargetBulkItem(BaseModel):
    management_no: str
    target_sales: float


class ItemTargetBulkIn(BaseModel):
    year_month: str                       # YYYY-MM（対象月は一括で共通）
    items: List[ItemTargetBulkItem]


class ItemTargetKey(BaseModel):
    management_no: str
    year_month: str


def _validate_ym(ym: str) -> str:
    ym = (ym or "").strip()
    if len(ym) != 7 or ym[4] != "-" or not (ym[:4] + ym[5:]).isdigit():
        raise HTTPException(status_code=400, detail="year_month は YYYY-MM 形式で指定してください")
    return ym


def _to_dict(t: ItemTarget) -> dict:
    return {
        "management_no": t.management_no,
        "year_month": t.year_month,
        "target_sales": t.target_sales,
        "target_cvr": t.target_cvr,
        "target_av": t.target_av,
        "required_access": t.required_access,
        "calc_basis": t.calc_basis,
        "basis_detail": t.basis_detail,
        "estimated_approved": bool(t.estimated_approved),
        # 承認済みruleは常に有効。estimatedは承認後のみ有効（診断・逆算で使ってよいか）
        "usable": t.calc_basis == "rule" or (t.calc_basis == "estimated" and bool(t.estimated_approved)),
    }


@router.get("")
def list_item_targets(
    year_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    """対象月のアイテム別目標一覧。

    商品の並びは「商品マスタの稼働中商品 ＋ 実績データに存在する商品」の和集合。
    目標未設定の商品も target=null で返し、画面側でそのまま入力できるようにする。
    """
    ym = _validate_ym(year_month)

    targets = {t.management_no: t for t in db.query(ItemTarget).filter(ItemTarget.year_month == ym).all()}
    inactive = inactive_management_nos(db)

    # 商品名と直近実績（参考表示用）
    products = {p.management_no: p for p in db.query(Product).all() if p.management_no}
    latest_by_mno: dict[str, MonthlyItemSales] = {}
    for r in db.query(MonthlyItemSales).order_by(MonthlyItemSales.year_month.asc()).all():
        if r.management_no:
            latest_by_mno[r.management_no] = r  # 昇順で回して最後に残るのが最新月

    # 商品マスタのカテゴリ（ジャンル絞り込みのフォールバック用）
    categories = {c.id: c for c in db.query(ProductCategory).all()}

    def _resolve_genre(latest: Optional[MonthlyItemSales], p: Optional[Product]) -> dict:
        """ジャンル絞り込み用。直近実績（商品分析）優先、無ければ商品マスタのカテゴリ。"""
        if latest is not None and (latest.genre_u1 or latest.genre_u2 or latest.genre_u3):
            return {"genre_u1": latest.genre_u1, "genre_u2": latest.genre_u2, "genre_u3": latest.genre_u3}
        if p is not None and p.category_id and p.category_id in categories:
            c = categories[p.category_id]
            return {"genre_u1": c.genre_u1, "genre_u2": c.genre_u2, "genre_u3": c.genre_u3}
        return {"genre_u1": None, "genre_u2": None, "genre_u3": None}

    mnos = (set(products) | set(latest_by_mno) | set(targets)) - inactive
    items = []
    for mno in sorted(mnos):
        t = targets.get(mno)
        latest = latest_by_mno.get(mno)
        p = products.get(mno)
        items.append({
            "management_no": mno,
            "product_name": (
                (p.product_name if p else None)
                or (latest.product_name if latest is not None else None)
            ),
            **_resolve_genre(latest, p),
            "target": _to_dict(t) if t else None,
            # 参考表示: 直近実績（site_uu軸）。実績が無い商品は null（推定＋承認フロー対象）
            "latest_actual": {
                "year_month": latest.year_month,
                "access_uu": latest.access_uu or 0,
                "cvr": latest.cvr or 0,
                "av": round((latest.sales or 0) / latest.cv, 0) if (latest.cv or 0) > 0 else 0,
            } if latest is not None else None,
        })

    return {"year_month": ym, "count": len(items), "items": items}


def _upsert_one(db: Session, management_no: str, year_month: str, target_sales: float) -> ItemTarget:
    """アイテム別目標1件のupsert＋自動算出（commitは呼び出し側）。

    単発保存(POST "")と一括保存(POST "/bulk")で確定公式のコードパスを共有し、
    算出式が二重実装で食い違わないようにするための共通関数。入力検証もここで行う。
    """
    mno = (management_no or "").strip()
    if not mno:
        raise HTTPException(status_code=400, detail="management_no は必須です")
    if target_sales <= 0:
        raise HTTPException(status_code=400, detail=f"target_sales は 0 より大きい値を指定してください（{mno}）")

    row = db.query(ItemTarget).filter(
        ItemTarget.management_no == mno, ItemTarget.year_month == year_month,
    ).first()
    if row is None:
        row = ItemTarget(management_no=mno, year_month=year_month, target_sales=target_sales)
        db.add(row)
    else:
        row.target_sales = target_sales
        # 目標売上を入れ直したら承認状態はリセット（推定値の前提が変わるため再承認）
        row.estimated_approved = False

    # 自動算出（保存時に導出して保存する）
    calc = calc_item_target(db, mno, year_month, target_sales)
    row.target_cvr = calc["target_cvr"]
    row.target_av = calc["target_av"]
    row.required_access = calc["required_access"]
    row.calc_basis = calc["calc_basis"]
    row.basis_detail = calc["basis_detail"]
    return row


@router.post("")
def upsert_item_target(payload: ItemTargetIn, db: Session = Depends(get_db)):
    """アイテム別目標売上の保存（1件）。目標CVR・客単価・必要アクセスは自動算出される。"""
    ym = _validate_ym(payload.year_month)
    row = _upsert_one(db, payload.management_no, ym, payload.target_sales)
    db.commit()
    return _to_dict(row)


@router.post("/bulk")
def bulk_upsert_item_targets(payload: ItemTargetBulkIn, db: Session = Depends(get_db)):
    """アイテム別目標売上の一括保存（対象月は共通・複数件を1トランザクションで保存）。

    編集した行だけをまとめて送る前提。各件は単発保存と同じ確定公式で自動算出する。
    1件でも検証エラー（management_no空・target_sales<=0）があれば全体をロールバックして
    400を返す（部分保存で画面と実データが食い違わないようにする）。
    """
    ym = _validate_ym(payload.year_month)
    if not payload.items:
        raise HTTPException(status_code=400, detail="items が空です")

    # 同一management_noが複数回来たら最後の値を採用（画面の重複送信対策）
    dedup: dict[str, float] = {}
    for it in payload.items:
        mno = (it.management_no or "").strip()
        if not mno:
            raise HTTPException(status_code=400, detail="management_no は必須です")
        dedup[mno] = it.target_sales

    saved = []
    try:
        for mno, target_sales in dedup.items():
            row = _upsert_one(db, mno, ym, target_sales)
            db.flush()  # 各件をここでINSERT/UPDATE確定（採番・DB制約エラーを件ごとに検知）
            saved.append(row)
        db.commit()
    except HTTPException:
        db.rollback()
        raise

    return {"year_month": ym, "saved_count": len(saved), "items": [_to_dict(r) for r in saved]}


@router.post("/approve")
def approve_item_target(payload: ItemTargetKey, db: Session = Depends(get_db)):
    """推定値（参考値）の承認。承認後は診断・逆算で利用可能になる。"""
    ym = _validate_ym(payload.year_month)
    row = db.query(ItemTarget).filter(
        ItemTarget.management_no == payload.management_no,
        ItemTarget.year_month == ym,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="アイテム別目標が見つかりません")
    if row.calc_basis != "estimated":
        raise HTTPException(status_code=400, detail="承認対象は推定値（参考値）の目標のみです")
    row.estimated_approved = True
    db.commit()
    return _to_dict(row)


@router.post("/recalc")
def recalc_item_target(payload: ItemTargetKey, db: Session = Depends(get_db)):
    """1件を明示的に再計算する（承認済み推定値を最新の実績・推定で洗い直す場合）。"""
    ym = _validate_ym(payload.year_month)
    row = db.query(ItemTarget).filter(
        ItemTarget.management_no == payload.management_no,
        ItemTarget.year_month == ym,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="アイテム別目標が見つかりません")
    # 明示的な再計算では承認済み推定値の保護を外す（利用者の意思による洗い直し）
    row.estimated_approved = False
    apply_calc(db, row)
    db.commit()
    return _to_dict(row)


@router.delete("/{management_no}")
def delete_item_target(
    management_no: str,
    year_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    """アイテム別目標の削除。"""
    ym = _validate_ym(year_month)
    row = db.query(ItemTarget).filter(
        ItemTarget.management_no == management_no,
        ItemTarget.year_month == ym,
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="アイテム別目標が見つかりません")
    db.delete(row)
    db.commit()
    return {"deleted": management_no, "year_month": ym}


# ── アイテム別目標 CSV 一括入出力（商品マスタと同じ作法。マスタCRUD規約2026-08-22）────
# 行に「対象月」列を持たせ、複数月を1ファイルで扱える（エクスポートは選択中の月のみ出力）。
_ITEM_TARGET_CSV_HEADER = [
    "対象月", "管理番号", "商品名", "目標売上", "目標CVR(%)", "目標客単価", "必要アクセス(参考)",
]


@router.get("/export")
def export_item_targets(
    year_month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    """アイテム別目標をCSV（BOM付きUTF-8）でエクスポートする。指定月のみ・削除済み商品は除外。

    目標CVR/客単価/必要アクセスは算出済みの参考値として出力する。インポート時は
    無視して常に再算出する（手入力は目標売上のみという既存方針を維持するため）。
    """
    ym = _validate_ym(year_month)
    inactive = inactive_management_nos(db)
    rows = db.query(ItemTarget).filter(ItemTarget.year_month == ym).all()
    products = {p.management_no: p for p in db.query(Product).all() if p.management_no}

    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(_ITEM_TARGET_CSV_HEADER)
    for t in rows:
        if t.management_no in inactive:
            continue
        p = products.get(t.management_no)
        writer.writerow([
            ym,
            t.management_no,
            (p.product_name if p else "") or "",
            t.target_sales,
            t.target_cvr if t.target_cvr is not None else "",
            t.target_av if t.target_av is not None else "",
            t.required_access if t.required_access is not None else "",
        ])
    buf.seek(0)
    disposition = (
        "attachment; filename=\"item_target_master.csv\"; "
        f"filename*=UTF-8''{quote(f'アイテム別目標_{ym}.csv')}"
    )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


@router.post("/import")
async def import_item_targets(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """アイテム別目標CSVを一括取込みする（対象月列を持つため複数月を1ファイルで扱える）。

    確定公式の算出は _upsert_one を通し、単発・一括保存と同じコードパスを共有する。
    1行の検証エラーは SAVEPOINT でその行だけロールバックし、他行の取込は継続する
    （商品マスタと違い target_sales<=0 等の厳密な検証があるため、1行の不備で
    ファイル全体が巻き戻ると大きいCSVで実用的でない）。
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="ファイルが空です")
    text = None
    for enc in ["utf-8-sig", "utf-8", "cp932", "shift_jis"]:
        try:
            text = content.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        raise HTTPException(status_code=400, detail="ファイルのエンコードを判別できませんでした")

    try:
        df = pd.read_csv(io.StringIO(text), dtype=str).fillna("")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV解析エラー: {e}")
    df.columns = [str(c).strip() for c in df.columns]

    created = updated = 0
    error_rows: list[str] = []
    for idx, row in df.iterrows():
        ym = str(row.get("対象月", "")).strip()
        mno = str(row.get("管理番号", "")).strip()
        if len(ym) != 7 or ym[4] != "-" or not (ym[:4] + ym[5:]).isdigit():
            error_rows.append(f"{idx + 2}行目: 対象月はYYYY-MM形式で指定してください")
            continue
        if not mno:
            error_rows.append(f"{idx + 2}行目: 管理番号が空です")
            continue
        try:
            sales = float(row.get("目標売上") or 0)
        except (ValueError, TypeError):
            error_rows.append(f"{idx + 2}行目: 目標売上が数値ではありません")
            continue

        existed = db.query(ItemTarget.id).filter(
            ItemTarget.management_no == mno, ItemTarget.year_month == ym,
        ).first() is not None
        try:
            with db.begin_nested():
                _upsert_one(db, mno, ym, sales)
        except HTTPException as e:
            error_rows.append(f"{idx + 2}行目: {e.detail}")
            continue
        if existed:
            updated += 1
        else:
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "error_rows": error_rows}
