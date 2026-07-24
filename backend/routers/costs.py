"""原価マスタAPI（/api/costs）。

7/14に決めた方針:
    解決順   : ProductCost.cost_rate（商品別）→ Shop.default_cost_rate（店舗デフォルト）→ 0.6
    焼き込み : RppWeekly.cost_of_sales = gross × resolve_rate(management_no)

率を変更したら対象の RppWeekly を掛け直す（recalc）。calc_kpis 側は一切触らない。
"""
import io
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Product, ProductCost
from masters import (
    DEFAULT_COST_RATE,
    get_or_create_default_shop,
    make_cost_resolver,
    recalc_rpp_cost_of_sales,
)

router = APIRouter(prefix="/api/costs", tags=["costs"])


class DefaultRatePayload(BaseModel):
    default_cost_rate: float  # 0〜1


class CostRatePayload(BaseModel):
    cost_rate: float  # 0〜1
    memo: Optional[str] = None


class RecalcPayload(BaseModel):
    management_no: Optional[str] = None
    management_nos: Optional[list[str]] = None


def _clamp_rate(v: float) -> float:
    """率を 0〜1 に丸める。50 のような 1 超の入力は % とみなして /100 する。"""
    try:
        r = float(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="原価率が数値ではありません")
    if r > 1:
        r = r / 100.0
    if r < 0:
        r = 0.0
    if r > 1:
        r = 1.0
    return r


@router.get("")
def list_costs(db: Session = Depends(get_db)):
    """商品一覧＋適用中の率＋「個別/デフォルト」区分を返す。"""
    shop = get_or_create_default_shop(db)
    default_rate = shop.default_cost_rate if shop.default_cost_rate is not None else DEFAULT_COST_RATE

    # 商品別に設定された率（management_no -> (rate, memo)）
    cost_map = {
        pc.management_no: (pc.cost_rate, pc.memo)
        for pc in db.query(ProductCost).all()
        if pc.management_no
    }

    items = []
    for p in db.query(Product).order_by(Product.management_no).all():
        override = cost_map.get(p.management_no)
        if override is not None:
            rate, memo, source = override[0], override[1], "product"
        else:
            rate, memo, source = default_rate, None, "default"
        items.append({
            "management_no": p.management_no,
            "product_name": p.product_name,
            "cost_rate": rate,
            "source": source,   # "product"（個別）/ "default"（店舗デフォルト）
            "memo": memo,
            "is_active": p.is_active,
        })

    # 商品マスタに未登録だが ProductCost だけ存在する管理番号も拾う
    known = {i["management_no"] for i in items}
    for mno, (rate, memo) in cost_map.items():
        if mno not in known:
            items.append({
                "management_no": mno,
                "product_name": None,
                "cost_rate": rate,
                "source": "product",
                "memo": memo,
                "is_active": None,
            })

    return {"default_cost_rate": default_rate, "count": len(items), "items": items}


@router.put("/default")
def update_default_rate(payload: DefaultRatePayload, db: Session = Depends(get_db)):
    """店舗デフォルト原価率を更新し、RppWeekly 全行を掛け直す。"""
    shop = get_or_create_default_shop(db)
    shop.default_cost_rate = _clamp_rate(payload.default_cost_rate)
    db.flush()
    changed = recalc_rpp_cost_of_sales(db)  # 全商品を対象（デフォルト適用商品が変わるため）
    db.commit()
    return {"default_cost_rate": shop.default_cost_rate, "recalculated_rows": changed}


@router.put("/{management_no}")
def set_product_rate(management_no: str, payload: CostRatePayload, db: Session = Depends(get_db)):
    """商品別原価率を設定/更新し、その商品の RppWeekly を掛け直す。"""
    mno = (management_no or "").strip()
    if not mno:
        raise HTTPException(status_code=400, detail="管理番号が空です")
    rate = _clamp_rate(payload.cost_rate)

    pc = db.query(ProductCost).filter(ProductCost.management_no == mno).first()
    if pc is None:
        pc = ProductCost(management_no=mno, cost_rate=rate, memo=payload.memo)
        db.add(pc)
    else:
        pc.cost_rate = rate
        if payload.memo is not None:
            pc.memo = payload.memo
    db.flush()
    changed = recalc_rpp_cost_of_sales(db, {mno})
    db.commit()
    return {"management_no": mno, "cost_rate": rate, "recalculated_rows": changed}


@router.post("/recalc")
def recalc(payload: Optional[RecalcPayload] = None, db: Session = Depends(get_db)):
    """RppWeekly に現在の原価率を掛け直す（対象商品指定も可）。"""
    targets: Optional[set] = None
    if payload:
        got: set[str] = set()
        if payload.management_no:
            got.add(payload.management_no.strip())
        if payload.management_nos:
            got.update(m.strip() for m in payload.management_nos if m and m.strip())
        targets = got or None
    changed = recalc_rpp_cost_of_sales(db, targets)
    db.commit()
    return {"recalculated_rows": changed, "scope": sorted(targets) if targets else "all"}


@router.post("/import")
async def import_costs(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """CSV一括登録（管理番号, 原価率 の2列）。ヘッダー有無どちらも許容する。"""
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
        df = pd.read_csv(io.StringIO(text), header=None, dtype=str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV解析エラー: {e}")
    if df.shape[1] < 2:
        raise HTTPException(status_code=400, detail="管理番号, 原価率 の2列が必要です")

    upserted = 0
    seen: set[str] = set()
    for _, row in df.iterrows():
        raw_mno = str(row.iloc[0]).strip()
        raw_rate = str(row.iloc[1]).strip()
        # 先頭行がヘッダー（"管理番号" 等・率が数値でない）ならスキップ
        try:
            rate_val = float(raw_rate.replace("%", "").replace(",", ""))
        except ValueError:
            continue
        if not raw_mno or raw_mno.lower() in ("nan", "none") or raw_mno in seen:
            continue
        seen.add(raw_mno)
        rate = _clamp_rate(rate_val)

        pc = db.query(ProductCost).filter(ProductCost.management_no == raw_mno).first()
        if pc is None:
            db.add(ProductCost(management_no=raw_mno, cost_rate=rate))
        else:
            pc.cost_rate = rate
        upserted += 1

    db.flush()
    changed = recalc_rpp_cost_of_sales(db, seen or None)
    db.commit()
    return {"upserted": upserted, "recalculated_rows": changed}
