# -*- coding: utf-8 -*-
"""アイテム別目標API（/api/item-targets。設計ドキュメント2026-08-01 3-B''・第3段階）。

- 利用者が入力するのは「アイテム別の目標売上」のみ（1件ずつ。一括入力は別チケット）
- 目標CVR・客単価・必要アクセス数は target_calc.py の確定公式で自動算出
- 実績が無い商品は推定値（参考値）＋承認フロー。承認まで診断・逆算には使わない
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ItemTarget, MonthlyItemSales, Product
from masters import inactive_management_nos
from target_calc import apply_calc, calc_item_target

router = APIRouter(prefix="/api/item-targets", tags=["item-targets"])


class ItemTargetIn(BaseModel):
    management_no: str
    year_month: str      # YYYY-MM
    target_sales: float


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


@router.post("")
def upsert_item_target(payload: ItemTargetIn, db: Session = Depends(get_db)):
    """アイテム別目標売上の保存。目標CVR・客単価・必要アクセスは自動算出される。"""
    ym = _validate_ym(payload.year_month)
    mno = (payload.management_no or "").strip()
    if not mno:
        raise HTTPException(status_code=400, detail="management_no は必須です")
    if payload.target_sales <= 0:
        raise HTTPException(status_code=400, detail="target_sales は 0 より大きい値を指定してください")

    row = db.query(ItemTarget).filter(
        ItemTarget.management_no == mno, ItemTarget.year_month == ym,
    ).first()
    if row is None:
        row = ItemTarget(management_no=mno, year_month=ym, target_sales=payload.target_sales)
        db.add(row)
    else:
        row.target_sales = payload.target_sales
        # 目標売上を入れ直したら承認状態はリセット（推定値の前提が変わるため再承認）
        row.estimated_approved = False

    # 自動算出（保存時に導出して保存する。バッチは使わない）
    calc = calc_item_target(db, mno, ym, payload.target_sales)
    row.target_cvr = calc["target_cvr"]
    row.target_av = calc["target_av"]
    row.required_access = calc["required_access"]
    row.calc_basis = calc["calc_basis"]
    row.basis_detail = calc["basis_detail"]

    db.commit()
    return _to_dict(row)


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
