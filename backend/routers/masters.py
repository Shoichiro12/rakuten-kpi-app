"""マスタ管理API。

- 商品マスタ / カテゴリ : /api/master/*
    既存の /api/products（商品別KPI集計）と衝突しないよう /api/master 名前空間に置く。
- 店舗（単一店舗前提）   : /api/shops/me
"""
import csv
import io
from typing import Optional
from urllib.parse import quote

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Product, ProductCategory, ProductCost, Shop
from masters import (
    DEFAULT_COST_RATE,
    get_or_create_category,
    get_or_create_default_shop,
    recalc_rpp_cost_of_sales,
    upsert_product,
)

# ── 商品マスタ・カテゴリ ────────────────────────────────────────────────
router = APIRouter(prefix="/api/master", tags=["master"])


def _category_map(db: Session) -> dict[int, ProductCategory]:
    return {c.id: c for c in db.query(ProductCategory).all()}


@router.get("/products")
def list_master_products(
    is_active: Optional[bool] = Query(None, description="true/false で絞り込み"),
    category_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """商品マスタ一覧（フィルタ: is_active, category_id）。"""
    q = db.query(Product)
    if is_active is not None:
        q = q.filter(Product.is_active == is_active)
    if category_id is not None:
        q = q.filter(Product.category_id == category_id)

    cats = _category_map(db)
    items = []
    for p in q.order_by(Product.management_no).all():
        cat = cats.get(p.category_id) if p.category_id else None
        items.append({
            "id": p.id,
            "management_no": p.management_no,
            "product_name": p.product_name,
            "product_url": p.product_url,
            "shop_id": p.shop_id,
            "category_id": p.category_id,
            "genre_u1": cat.genre_u1 if cat else None,
            "genre_u2": cat.genre_u2 if cat else None,
            "genre_u3": cat.genre_u3 if cat else None,
            "is_active": p.is_active,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        })
    return {"count": len(items), "items": items}


class ProductUpdatePayload(BaseModel):
    product_name: Optional[str] = None
    category_id: Optional[int] = None
    is_active: Optional[bool] = None


@router.put("/products/{management_no}")
def update_master_product(
    management_no: str,
    payload: ProductUpdatePayload,
    db: Session = Depends(get_db),
):
    """product_name / category_id / is_active を編集する。"""
    mno = (management_no or "").strip()
    prod = db.query(Product).filter(Product.management_no == mno).first()
    if prod is None:
        raise HTTPException(status_code=404, detail=f"商品が見つかりません: {mno}")

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data and data["category_id"] is not None:
        # 指定カテゴリの存在チェック（現ユーザー範囲で）
        exists = db.query(ProductCategory).filter(ProductCategory.id == data["category_id"]).first()
        if exists is None:
            raise HTTPException(status_code=400, detail="指定されたカテゴリが存在しません")
    for key, value in data.items():
        setattr(prod, key, value)
    db.commit()
    return {
        "management_no": prod.management_no,
        "product_name": prod.product_name,
        "category_id": prod.category_id,
        "is_active": prod.is_active,
    }


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    """カテゴリ一覧。"""
    rows = db.query(ProductCategory).order_by(
        ProductCategory.genre_u1, ProductCategory.genre_u2, ProductCategory.genre_u3
    ).all()
    return {
        "count": len(rows),
        "items": [
            {
                "id": c.id,
                "genre_u1": c.genre_u1,
                "genre_u2": c.genre_u2,
                "genre_u3": c.genre_u3,
            }
            for c in rows
        ],
    }


class CategoryPayload(BaseModel):
    genre_u1: Optional[str] = None
    genre_u2: Optional[str] = None
    genre_u3: Optional[str] = None


def _norm(v: Optional[str]) -> Optional[str]:
    """空文字・空白のみは None に正規化する。"""
    if v is None:
        return None
    s = v.strip()
    return s or None


def _cat_dict(c: ProductCategory) -> dict:
    return {"id": c.id, "genre_u1": c.genre_u1, "genre_u2": c.genre_u2, "genre_u3": c.genre_u3}


def _find_category(db: Session, u1, u2, u3) -> Optional[ProductCategory]:
    return (
        db.query(ProductCategory)
        .filter(
            ProductCategory.genre_u1 == u1,
            ProductCategory.genre_u2 == u2,
            ProductCategory.genre_u3 == u3,
        )
        .first()
    )


@router.post("/categories")
def create_category(payload: CategoryPayload, db: Session = Depends(get_db)):
    """カテゴリを作成する（同一階層が既にあれば既存を返す＝find-or-create）。"""
    u1, u2, u3 = _norm(payload.genre_u1), _norm(payload.genre_u2), _norm(payload.genre_u3)
    if not any([u1, u2, u3]):
        raise HTTPException(status_code=400, detail="大/中/小のいずれかを入力してください")
    existing = _find_category(db, u1, u2, u3)
    if existing:
        return _cat_dict(existing)
    cat = ProductCategory(genre_u1=u1, genre_u2=u2, genre_u3=u3)
    db.add(cat)
    db.commit()
    return _cat_dict(cat)


@router.put("/categories/{category_id}")
def update_category(category_id: int, payload: CategoryPayload, db: Session = Depends(get_db)):
    """カテゴリの階層名をリネームする。"""
    cat = db.query(ProductCategory).filter(ProductCategory.id == category_id).first()
    if cat is None:
        raise HTTPException(status_code=404, detail="カテゴリが見つかりません")
    u1, u2, u3 = _norm(payload.genre_u1), _norm(payload.genre_u2), _norm(payload.genre_u3)
    if not any([u1, u2, u3]):
        raise HTTPException(status_code=400, detail="大/中/小のいずれかを入力してください")
    dup = _find_category(db, u1, u2, u3)
    if dup and dup.id != category_id:
        raise HTTPException(status_code=400, detail="同じ階層のカテゴリが既に存在します")
    cat.genre_u1, cat.genre_u2, cat.genre_u3 = u1, u2, u3
    db.commit()
    return _cat_dict(cat)


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    """カテゴリを削除する。参照している商品は未分類（category_id=None）に戻す。"""
    cat = db.query(ProductCategory).filter(ProductCategory.id == category_id).first()
    if cat is None:
        raise HTTPException(status_code=404, detail="カテゴリが見つかりません")
    # 参照商品を先に未分類化（user_id スコープは自動適用）
    detached = db.query(Product).filter(Product.category_id == category_id).update(
        {Product.category_id: None}
    )
    db.delete(cat)
    db.commit()
    return {"deleted_id": category_id, "detached_products": detached}


# ── 商品マスタ CSV 一括入出力 ─────────────────────────────────────────────
_MASTER_CSV_HEADER = ["管理番号", "商品名", "ジャンル大", "ジャンル中", "ジャンル小", "原価率(%)", "状態"]
_INACTIVE_WORDS = {"廃盤", "無効", "停止", "取扱停止", "false", "0", "no", "off"}


@router.get("/products/export")
def export_master_products(db: Session = Depends(get_db)):
    """商品マスタをCSV（BOM付きUTF-8）でエクスポートする。

    原価率(%)は「商品別に個別設定された率」のみ出力し、未設定は空欄（店舗デフォルト適用）。
    往復（エクスポート→編集→インポート）で個別/既定の区別が保たれる。
    """
    cats = {c.id: c for c in db.query(ProductCategory).all()}
    cost_map = {pc.management_no: pc.cost_rate for pc in db.query(ProductCost).all() if pc.management_no}

    rows: list[list] = []
    for p in db.query(Product).order_by(Product.management_no).all():
        cat = cats.get(p.category_id) if p.category_id else None
        rate = cost_map.get(p.management_no)
        rows.append([
            p.management_no,
            p.product_name or "",
            (cat.genre_u1 if cat else "") or "",
            (cat.genre_u2 if cat else "") or "",
            (cat.genre_u3 if cat else "") or "",
            round(rate * 100) if rate is not None else "",
            "稼働中" if p.is_active else "廃盤",
        ])

    buf = io.StringIO()
    buf.write("﻿")  # Excel が UTF-8 と認識するための BOM
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(_MASTER_CSV_HEADER)
    writer.writerows(rows)
    buf.seek(0)
    disposition = (
        "attachment; filename=\"product_master.csv\"; "
        f"filename*=UTF-8''{quote('商品マスタ.csv')}"
    )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


@router.post("/products/import")
async def import_master_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """商品マスタCSVを一括取込みする（管理番号キーにupsert）。

    - 商品名: 空でなければ更新
    - 状態: 「廃盤/無効」等なら is_active=False、それ以外(稼働中等)は True。空欄は据え置き
    - ジャンル大/中/小: いずれか入力があればカテゴリを find-or-create して割当。全て空欄は未分類
    - 原価率(%): 入力があれば商品別原価率(ProductCost)を設定。空欄は据え置き
    最後に現在の原価率でRppWeeklyを再計算する。
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
    if "管理番号" not in df.columns:
        raise HTTPException(status_code=400, detail="「管理番号」列が必要です（エクスポートしたCSVをご利用ください）")

    def cell(row, name: str) -> str:
        return str(row.get(name, "")).strip() if name in df.columns else ""

    shop = get_or_create_default_shop(db)
    updated = created = cost_set = 0
    touched: set = set()
    for _, row in df.iterrows():
        mno = cell(row, "管理番号")
        if not mno or mno.lower() in ("nan", "none"):
            continue
        touched.add(mno)
        prod = db.query(Product).filter(Product.management_no == mno).first()
        is_new = prod is None

        # カテゴリ（大/中/小のいずれか入力があれば find-or-create、全空欄は未分類）
        u1, u2, u3 = cell(row, "ジャンル大"), cell(row, "ジャンル中"), cell(row, "ジャンル小")
        cat = get_or_create_category(db, u1 or None, u2 or None, u3 or None)
        cat_id = cat.id if cat else None

        name = cell(row, "商品名")
        prod = upsert_product(
            db, mno, shop_id=shop.id,
            product_name=name or None,
            category_id=cat_id,
        )
        if prod is None:
            continue
        # upsert_product は category を「値があるときのみ」更新するため、
        # 全空欄で未分類に戻したいケースは明示的に None を入れる
        if not any([u1, u2, u3]):
            prod.category_id = None
        else:
            prod.category_id = cat_id

        # 状態（空欄は据え置き）
        status = cell(row, "状態")
        if status:
            prod.is_active = status.lower() not in _INACTIVE_WORDS

        created += 1 if is_new else 0
        updated += 0 if is_new else 1

        # 原価率（入力があれば個別率を設定）
        rate_s = cell(row, "原価率(%)").replace("%", "")
        if rate_s:
            try:
                pct = float(rate_s)
            except ValueError:
                pct = None
            if pct is not None:
                rate = min(max(pct / 100.0, 0.0), 1.0)
                pc = db.query(ProductCost).filter(ProductCost.management_no == mno).first()
                if pc is None:
                    db.add(ProductCost(management_no=mno, cost_rate=rate))
                else:
                    pc.cost_rate = rate
                cost_set += 1

    db.flush()
    recalculated = recalc_rpp_cost_of_sales(db)  # 率変更を全RppWeeklyへ反映
    db.commit()
    return {
        "updated": updated,
        "created": created,
        "cost_set": cost_set,
        "recalculated_rows": recalculated,
        "processed": len(touched),
    }


# ── 店舗（単一店舗前提: id=1 相当を "me" として返す） ─────────────────────
shops_router = APIRouter(prefix="/api/shops", tags=["shops"])


def _shop_to_dict(s: Shop) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "mall_type": s.mall_type,
        "default_cost_rate": s.default_cost_rate if s.default_cost_rate is not None else DEFAULT_COST_RATE,
        "default_expense_rate": s.default_expense_rate if s.default_expense_rate is not None else 0.15,
        "restock_lead_days": s.restock_lead_days if s.restock_lead_days is not None else 14,
        "is_active": s.is_active,
    }


@shops_router.get("/me")
def get_my_shop(db: Session = Depends(get_db)):
    """単一店舗前提なので現ユーザーのデフォルト店舗を返す（無ければ遅延生成）。"""
    return _shop_to_dict(get_or_create_default_shop(db))


class ShopUpdatePayload(BaseModel):
    name: Optional[str] = None
    default_cost_rate: Optional[float] = None
    default_expense_rate: Optional[float] = None
    restock_lead_days: Optional[int] = None


@shops_router.put("/me")
def update_my_shop(payload: ShopUpdatePayload, db: Session = Depends(get_db)):
    """name / default_cost_rate / default_expense_rate を更新する。"""
    shop = get_or_create_default_shop(db)
    data = payload.model_dump(exclude_unset=True)
    cost_rate_changed = False
    if "name" in data and data["name"] is not None:
        shop.name = data["name"]
    if "default_cost_rate" in data and data["default_cost_rate"] is not None:
        r = float(data["default_cost_rate"])
        shop.default_cost_rate = min(max(r / 100.0 if r > 1 else r, 0.0), 1.0)
        cost_rate_changed = True
    if "default_expense_rate" in data and data["default_expense_rate"] is not None:
        r = float(data["default_expense_rate"])
        shop.default_expense_rate = min(max(r / 100.0 if r > 1 else r, 0.0), 1.0)
    if "restock_lead_days" in data and data["restock_lead_days"] is not None:
        shop.restock_lead_days = max(1, int(data["restock_lead_days"]))
    # デフォルト原価率が変わったら、それを適用している商品の RppWeekly を掛け直す
    # （/api/costs/default と挙動を揃え、KPIが古い原価のまま残らないようにする）。
    if cost_rate_changed:
        db.flush()
        recalc_rpp_cost_of_sales(db)
    db.commit()
    return _shop_to_dict(shop)
