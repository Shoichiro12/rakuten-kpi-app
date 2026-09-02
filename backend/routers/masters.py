"""マスタ管理API。

- 商品マスタ / カテゴリ : /api/master/*
    既存の /api/products（商品別KPI集計）と衝突しないよう /api/master 名前空間に置く。
- 店舗（単一店舗前提）   : /api/shops/me
"""
import csv
import io
from datetime import datetime
from typing import Optional
from urllib.parse import quote

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from csv_utils import csv_safe_cell
from database import get_db
from malware import scan_bytes  # アップロードのマルウェアスキャン
from models import GenreBenchmark, Product, ProductCategory, ProductCost, Shop
from masters import (
    DEFAULT_COST_RATE,
    get_or_create_category,
    get_or_create_default_shop,
    get_review_queue,
    recalc_rpp_cost_of_sales,
    suggest_category,
    suggest_cost_rate,
    upsert_product,
)
from genre_master import get_genre_tree

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
    """商品マスタ一覧（フィルタ: is_active, category_id）。

    削除済み（archived_at設定）は既定で除外する。「廃盤」は分析対象として残すユーザー
    概念のため is_active=False でも一覧には出る（Q7）。
    """
    q = db.query(Product).filter(Product.archived_at.is_(None))
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
            # アクション提案ロジックのゲート用状態（2-A / 3-A）
            "launch_month": p.launch_month,
            "phase_override": p.phase_override,
            "page_ready": p.page_ready,
            "investment_intent": p.investment_intent,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        })
    return {"count": len(items), "items": items}


class ProductUpdatePayload(BaseModel):
    product_name: Optional[str] = None
    category_id: Optional[int] = None
    is_active: Optional[bool] = None
    # ゲート用状態。exclude_unset で「送られたキーだけ」更新するため、
    # None を明示的に送れば「未回答/自動判定に戻す」操作になる。
    launch_month: Optional[str] = None
    phase_override: Optional[str] = None      # 'new' | 'established' | None(自動判定)
    page_ready: Optional[bool] = None         # True/False/None(未回答)
    investment_intent: Optional[bool] = None  # True(投資として許容)/None


@router.put("/products/{management_no}")
def update_master_product(
    management_no: str,
    payload: ProductUpdatePayload,
    db: Session = Depends(get_db),
):
    """product_name / category_id / is_active を編集する。削除済み商品は編集できない。"""
    mno = (management_no or "").strip()
    prod = db.query(Product).filter(
        Product.management_no == mno, Product.archived_at.is_(None)
    ).first()
    if prod is None:
        raise HTTPException(status_code=404, detail=f"商品が見つかりません: {mno}")

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data and data["category_id"] is not None:
        # 指定カテゴリの存在チェック（現ユーザー範囲で）
        exists = db.query(ProductCategory).filter(ProductCategory.id == data["category_id"]).first()
        if exists is None:
            raise HTTPException(status_code=400, detail="指定されたカテゴリが存在しません")
    if "phase_override" in data and data["phase_override"] not in (None, "new", "established"):
        raise HTTPException(status_code=400, detail="phase_override は new / established / null のみ指定できます")
    if "launch_month" in data and data["launch_month"] is not None:
        lm = str(data["launch_month"]).strip()
        if len(lm) != 7 or lm[4] != "-" or not (lm[:4] + lm[5:]).isdigit():
            raise HTTPException(status_code=400, detail="launch_month は YYYY-MM 形式で指定してください")
        data["launch_month"] = lm
    for key, value in data.items():
        setattr(prod, key, value)
    db.commit()
    return {
        "management_no": prod.management_no,
        "product_name": prod.product_name,
        "category_id": prod.category_id,
        "is_active": prod.is_active,
        "launch_month": prod.launch_month,
        "phase_override": prod.phase_override,
        "page_ready": prod.page_ready,
        "investment_intent": prod.investment_intent,
    }


@router.delete("/products/{management_no}")
def delete_master_product(management_no: str, db: Session = Depends(get_db)):
    """商品マスタから削除する（ソフトデリート。マスタCRUD規約2026-08-22）。

    ユーザー概念は「販売中／廃盤」の2値のみ（Q7）。「削除」はこの2値とは別軸で、
    一覧・診断・提案・ドリルダウンの母集団から完全に除外する（masters.inactive_management_nos
    が is_active=False と同じ経路で判定する）。実績データ（RppWeekly等）は保持され、
    集計・過去の分析結果は変わらない。復元UIは無い（要望が出たら別チケット）。
    """
    mno = (management_no or "").strip()
    prod = db.query(Product).filter(Product.management_no == mno).first()
    if prod is None:
        raise HTTPException(status_code=404, detail=f"商品が見つかりません: {mno}")
    if prod.archived_at is not None:
        raise HTTPException(status_code=400, detail="この商品は既に削除されています")
    prod.archived_at = datetime.utcnow()
    db.commit()
    return {"deleted_management_no": mno}


class BulkDeleteProductsPayload(BaseModel):
    management_nos: list[str] = []


@router.post("/products/bulk-delete")
def bulk_delete_products(payload: BulkDeleteProductsPayload, db: Session = Depends(get_db)):
    """商品マスタの一括ソフトデリート（1トランザクション。マスタ削除一括化計画書 §6.1）。

    存在しない・既に削除済みの管理番号は黙ってスキップし、削除できた分だけ返す
    （一括操作のUXとして、404で失敗にするより自然なため）。フロントは requested と
    deleted_management_nos の件数差から「一部は既に削除済みでした」等の表示ができる。
    """
    mnos = [m.strip() for m in payload.management_nos if (m or "").strip()]
    if not mnos:
        raise HTTPException(status_code=400, detail="management_nos が空です")
    prods = (
        db.query(Product)
        .filter(Product.management_no.in_(mnos), Product.archived_at.is_(None))
        .all()
    )
    now = datetime.utcnow()
    deleted: list[str] = []
    for p in prods:
        p.archived_at = now
        deleted.append(p.management_no)
    db.commit()
    return {"requested": len(mnos), "deleted_management_nos": deleted}


# ── 商品マスタ入力支援（自動提案キュー）────────────────────────────────────
class ApprovePayload(BaseModel):
    approve_category: bool = False
    approve_cost_rate: bool = False


class ApproveAllPayload(BaseModel):
    management_nos: list[str] = []


@router.get("/suggestions")
def list_suggestions(db: Session = Depends(get_db)):
    """カテゴリ・原価率が未確定の商品に「たぶんこれ」提案を付けて返す（廃盤は除外）。"""
    shop = get_or_create_default_shop(db)
    items = get_review_queue(db, shop.id)
    return {"count": len(items), "items": items}


@router.post("/suggestions/{management_no}/approve")
def approve_suggestion(management_no: str, payload: ApprovePayload, db: Session = Depends(get_db)):
    """提案どおり category_id / ProductCost を確定登録する（個別承認）。

    cost を確定した場合はその商品の RppWeekly を掛け直す。
    """
    mno = (management_no or "").strip()
    shop = get_or_create_default_shop(db)
    prod = (
        db.query(Product)
        .filter(Product.shop_id == shop.id, Product.management_no == mno)
        .first()
    )
    if prod is None:
        raise HTTPException(status_code=404, detail=f"商品が見つかりません: {mno}")

    applied = {"category": False, "cost_rate": False}
    if payload.approve_category and prod.category_id is None:
        sug = suggest_category(db, shop.id, mno)
        if sug is not None:
            prod.category_id = sug["category_id"]
            applied["category"] = True

    if payload.approve_cost_rate:
        sug = suggest_cost_rate(db, shop.id, mno)
        rate = sug["suggested_rate"]
        pc = db.query(ProductCost).filter(ProductCost.management_no == mno).first()
        if pc is None:
            db.add(ProductCost(management_no=mno, cost_rate=rate))
        else:
            pc.cost_rate = rate
        applied["cost_rate"] = True

    db.flush()
    recalculated = recalc_rpp_cost_of_sales(db, {mno}) if applied["cost_rate"] else 0
    db.commit()
    return {"management_no": mno, "applied": applied, "recalculated_rows": recalculated}


@router.post("/suggestions/approve-all")
def approve_all_suggestions(payload: ApproveAllPayload, db: Session = Depends(get_db)):
    """一括承認。安全弁として confidence="high" の提案のみを対象にする。

    店舗デフォルトへのフォールバック等の低信頼提案は一括承認では確定せず、個別承認に委ねる。
    """
    shop = get_or_create_default_shop(db)
    approved: list[dict] = []
    touched_cost: set = set()
    for raw in payload.management_nos:
        mno = (raw or "").strip()
        if not mno:
            continue
        prod = (
            db.query(Product)
            .filter(Product.shop_id == shop.id, Product.management_no == mno)
            .first()
        )
        if prod is None:
            continue
        applied = {"category": False, "cost_rate": False}

        if prod.category_id is None:
            cs = suggest_category(db, shop.id, mno)
            if cs and cs["confidence"] == "high":
                prod.category_id = cs["category_id"]
                applied["category"] = True

        has_cost = db.query(ProductCost).filter(ProductCost.management_no == mno).first() is not None
        if not has_cost:
            rs = suggest_cost_rate(db, shop.id, mno)
            if rs and rs["confidence"] == "high":
                db.add(ProductCost(management_no=mno, cost_rate=rs["suggested_rate"]))
                touched_cost.add(mno)
                applied["cost_rate"] = True

        if applied["category"] or applied["cost_rate"]:
            approved.append({"management_no": mno, "applied": applied})

    db.flush()
    recalculated = recalc_rpp_cost_of_sales(db, touched_cost) if touched_cost else 0
    db.commit()
    return {"approved_count": len(approved), "approved": approved, "recalculated_rows": recalculated}


@router.get("/genre-tree")
def genre_tree():
    """楽天公式ジャンルマスタ（大/中/小の3階層ツリー）。カテゴリ選択ピッカー用の参照データ。

    形: {"tree": {U1: {U2: [U3, ...]}}}。テナント非依存の公開データなのでDBは介さない。
    """
    return {"tree": get_genre_tree()}


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    """カテゴリ一覧（削除済みは除外）。"""
    rows = db.query(ProductCategory).filter(ProductCategory.archived_at.is_(None)).order_by(
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
    """カテゴリを作成する（同一階層が既にあれば既存を返す＝find-or-create）。

    削除済み（archived_at設定）の同一階層が見つかった場合は復活させて再利用する
    （user_id, genre_u1/2/3 のユニーク制約があるため、削除済み行を残したまま同じ
    キーで新規作成すると制約違反になる。復元UIは無いが、同名再作成は自然に復元される）。
    """
    u1, u2, u3 = _norm(payload.genre_u1), _norm(payload.genre_u2), _norm(payload.genre_u3)
    if not any([u1, u2, u3]):
        raise HTTPException(status_code=400, detail="大/中/小のいずれかを入力してください")
    existing = _find_category(db, u1, u2, u3)
    if existing:
        if existing.archived_at is not None:
            existing.archived_at = None
            db.commit()
        return _cat_dict(existing)
    cat = ProductCategory(genre_u1=u1, genre_u2=u2, genre_u3=u3)
    db.add(cat)
    db.commit()
    return _cat_dict(cat)


@router.put("/categories/{category_id}")
def update_category(category_id: int, payload: CategoryPayload, db: Session = Depends(get_db)):
    """カテゴリの階層名をリネームする。削除済みカテゴリは編集できない。"""
    cat = db.query(ProductCategory).filter(
        ProductCategory.id == category_id, ProductCategory.archived_at.is_(None)
    ).first()
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
    """カテゴリを削除する（ソフトデリート。マスタCRUD規約2026-08-22）。
    参照している商品は未分類（category_id=None）に戻す。
    """
    cat = db.query(ProductCategory).filter(ProductCategory.id == category_id).first()
    if cat is None:
        raise HTTPException(status_code=404, detail="カテゴリが見つかりません")
    if cat.archived_at is not None:
        raise HTTPException(status_code=400, detail="このカテゴリは既に削除されています")
    # 参照商品を先に未分類化（user_id スコープは自動適用）
    detached = db.query(Product).filter(Product.category_id == category_id).update(
        {Product.category_id: None}
    )
    cat.archived_at = datetime.utcnow()
    db.commit()
    return {"deleted_id": category_id, "detached_products": detached}


class BulkDeleteCategoriesPayload(BaseModel):
    ids: list[int] = []


@router.post("/categories/bulk-delete")
def bulk_delete_categories(payload: BulkDeleteCategoriesPayload, db: Session = Depends(get_db)):
    """カテゴリの一括ソフトデリート（1トランザクション。マスタ削除一括化計画書 §6.1）。
    参照している商品は先に未分類（category_id=None）へ戻してからカテゴリを削除する。

    存在しない・既に削除済みのIDは黙ってスキップし、削除できた分だけ返す
    （単件DELETEは404で失敗にするが、一括操作では「対象外」として扱う方が自然なため）。
    """
    if not payload.ids:
        raise HTTPException(status_code=400, detail="ids が空です")
    cats = (
        db.query(ProductCategory)
        .filter(ProductCategory.id.in_(payload.ids), ProductCategory.archived_at.is_(None))
        .all()
    )
    now = datetime.utcnow()
    deleted_ids: list[int] = []
    detached_total = 0
    for cat in cats:
        detached = db.query(Product).filter(Product.category_id == cat.id).update(
            {Product.category_id: None}
        )
        cat.archived_at = now
        deleted_ids.append(cat.id)
        detached_total += detached
    db.commit()
    return {
        "requested": len(payload.ids),
        "deleted_ids": deleted_ids,
        "detached_products": detached_total,
    }


# ── カテゴリマスタ CSV 一括入出力（商品マスタと同じ作法。マスタCRUD規約2026-08-22）────
_CATEGORY_CSV_HEADER = ["ジャンル大", "ジャンル中", "ジャンル小"]


@router.get("/categories/export")
def export_categories(db: Session = Depends(get_db)):
    """カテゴリマスタをCSV（BOM付きUTF-8）でエクスポートする。削除済みは含めない。"""
    rows = db.query(ProductCategory).filter(ProductCategory.archived_at.is_(None)).order_by(
        ProductCategory.genre_u1, ProductCategory.genre_u2, ProductCategory.genre_u3
    ).all()
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(_CATEGORY_CSV_HEADER)
    for c in rows:
        writer.writerow([
            csv_safe_cell(c.genre_u1 or ""),
            csv_safe_cell(c.genre_u2 or ""),
            csv_safe_cell(c.genre_u3 or ""),
        ])
    buf.seek(0)
    disposition = (
        "attachment; filename=\"category_master.csv\"; "
        f"filename*=UTF-8''{quote('カテゴリマスタ.csv')}"
    )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


@router.post("/categories/import")
async def import_categories(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """カテゴリマスタCSVを一括取込みする（ジャンル大/中/小の組み合わせキーにupsert）。

    インポートは追加・更新のみ（マスタCRUD規約: 行の削除は絶対にしない）。
    削除済みの同一階層が見つかった場合は復活させる（create_category と同じ思想）。
    """
    content = await file.read()
    scan_bytes(content, getattr(file, "filename", "upload") or "upload")
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
        u1 = _norm(str(row.get("ジャンル大", "")))
        u2 = _norm(str(row.get("ジャンル中", "")))
        u3 = _norm(str(row.get("ジャンル小", "")))
        if not any([u1, u2, u3]):
            error_rows.append(f"{idx + 2}行目: ジャンル大/中/小のいずれかが必要です")
            continue
        existing = _find_category(db, u1, u2, u3)
        if existing:
            if existing.archived_at is not None:
                existing.archived_at = None
            updated += 1
        else:
            db.add(ProductCategory(genre_u1=u1, genre_u2=u2, genre_u3=u3))
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "error_rows": error_rows}


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
    for p in db.query(Product).filter(Product.archived_at.is_(None)).order_by(Product.management_no).all():
        cat = cats.get(p.category_id) if p.category_id else None
        rate = cost_map.get(p.management_no)
        rows.append([
            p.management_no,
            csv_safe_cell(p.product_name or ""),
            csv_safe_cell((cat.genre_u1 if cat else "") or ""),
            csv_safe_cell((cat.genre_u2 if cat else "") or ""),
            csv_safe_cell((cat.genre_u3 if cat else "") or ""),
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
    scan_bytes(content, getattr(file, "filename", "upload") or "upload")
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


# ── ジャンル別ベンチマーク手入力（アクション提案ロジック 3-B / 3-B'）──────────
# RMS画面に表示される「同ジャンル・同規模店舗のベンチマーク値」は取込CSVに含まれない
# ため、利用者が見た値を任意で登録する。ベンチマーク解決（benchmarks.py）の①として
# 最優先で使われ、無ければ自店集計→汎用デフォルトへフォールバックする。

_BENCHMARK_METRICS = ("page_cvr", "ad_cvr", "ctr")

_BENCHMARK_METRIC_LABELS = {
    "page_cvr": "ページ全体CVR",
    "ad_cvr": "RPP広告経由CVR",
    "ctr": "CTR",
}


class BenchmarkPayload(BaseModel):
    genre_u1: str
    genre_u2: Optional[str] = None
    genre_u3: Optional[str] = None
    metric: str          # 'page_cvr' | 'ad_cvr' | 'ctr'
    value: float         # %値（例: 7.52）
    memo: Optional[str] = None


def _benchmark_to_dict(b: GenreBenchmark) -> dict:
    return {
        "id": b.id,
        "genre_u1": b.genre_u1,
        "genre_u2": b.genre_u2,
        "genre_u3": b.genre_u3,
        "metric": b.metric,
        "metric_label": _BENCHMARK_METRIC_LABELS.get(b.metric, b.metric),
        "value": b.value,
        "memo": b.memo,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


@router.get("/benchmarks")
def list_benchmarks(db: Session = Depends(get_db)):
    """手入力ベンチマークの一覧。"""
    rows = db.query(GenreBenchmark).order_by(
        GenreBenchmark.genre_u1, GenreBenchmark.genre_u2, GenreBenchmark.genre_u3,
        GenreBenchmark.metric,
    ).all()
    return {"count": len(rows), "items": [_benchmark_to_dict(b) for b in rows]}


@router.post("/benchmarks")
def upsert_benchmark(payload: BenchmarkPayload, db: Session = Depends(get_db)):
    """手入力ベンチマークの登録・更新（ジャンル階層×指標で一意）。"""
    if payload.metric not in _BENCHMARK_METRICS:
        raise HTTPException(status_code=400, detail="metric は page_cvr / ad_cvr / ctr のみ指定できます")
    u1 = (payload.genre_u1 or "").strip()
    if not u1:
        raise HTTPException(status_code=400, detail="genre_u1（大分類）は必須です")
    if payload.value <= 0 or payload.value > 100:
        raise HTTPException(status_code=400, detail="value は 0 より大きく 100 以下の%値で指定してください")
    u2 = (payload.genre_u2 or "").strip() or None
    u3 = (payload.genre_u3 or "").strip() or None
    if u3 and not u2:
        raise HTTPException(status_code=400, detail="小分類（u3）を指定する場合は中分類（u2）も指定してください")

    row = db.query(GenreBenchmark).filter(
        GenreBenchmark.genre_u1 == u1,
        GenreBenchmark.genre_u2 == u2,
        GenreBenchmark.genre_u3 == u3,
        GenreBenchmark.metric == payload.metric,
    ).first()
    if row is None:
        row = GenreBenchmark(genre_u1=u1, genre_u2=u2, genre_u3=u3, metric=payload.metric)
        db.add(row)
    row.value = payload.value
    row.memo = payload.memo
    db.commit()
    return _benchmark_to_dict(row)


@router.delete("/benchmarks/{benchmark_id}")
def delete_benchmark(benchmark_id: int, db: Session = Depends(get_db)):
    """手入力ベンチマークの削除（削除後は自店集計→デフォルトへフォールバック）。"""
    row = db.query(GenreBenchmark).filter(GenreBenchmark.id == benchmark_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="ベンチマークが見つかりません")
    db.delete(row)
    db.commit()
    return {"deleted": benchmark_id}


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
        # 売上予算プラン（第4段階v2）: 年間売上予算（null=未設定）と予算年度の起点月
        "annual_sales_budget": s.annual_sales_budget,
        "budget_year_start_month": s.budget_year_start_month if s.budget_year_start_month is not None else 1,
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
    # 売上予算プラン（第4段階v2）。annual_sales_budget は 0 以下・null で「未設定に戻す」
    annual_sales_budget: Optional[float] = None
    budget_year_start_month: Optional[int] = None


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
    # 年間売上予算: 明示的に送られたときだけ更新する。0以下・null は「未設定に戻す」
    # （按分値は保存していないので、ここを消せば売上予算プランは即 no_budget 表示に戻る）
    if "annual_sales_budget" in data:
        v = data["annual_sales_budget"]
        shop.annual_sales_budget = float(v) if v is not None and float(v) > 0 else None
    if "budget_year_start_month" in data and data["budget_year_start_month"] is not None:
        shop.budget_year_start_month = min(max(int(data["budget_year_start_month"]), 1), 12)
    # デフォルト原価率が変わったら、それを適用している商品の RppWeekly を掛け直す
    # （/api/costs/default と挙動を揃え、KPIが古い原価のまま残らないようにする）。
    if cost_rate_changed:
        db.flush()
        recalc_rpp_cost_of_sales(db)
    db.commit()
    return _shop_to_dict(shop)
