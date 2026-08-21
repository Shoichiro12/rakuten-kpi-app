import csv
import io
from datetime import datetime
from urllib.parse import quote

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import Target

router = APIRouter(prefix="/api/targets", tags=["targets"])


class TargetIn(BaseModel):
    year_month: str
    target_sales: float = 0
    target_access: int = 0
    target_cvr: float = 0
    target_av: float = 0
    expense_rate: float = 0.15


@router.get("")
def list_targets(db: Session = Depends(get_db)):
    """目標一覧（削除済み=archived_at設定は除外。マスタCRUD規約2026-08-22）。"""
    targets = (
        db.query(Target)
        .filter(Target.archived_at.is_(None))
        .order_by(Target.year_month.desc())
        .all()
    )
    return [
        {
            "year_month": t.year_month,
            "target_sales": t.target_sales,
            "target_access": t.target_access,
            "target_cvr": t.target_cvr,
            "target_av": t.target_av,
            "expense_rate": t.expense_rate,
        }
        for t in targets
    ]


# ── 目標マスタ CSV 一括入出力（商品マスタと同じ作法。マスタCRUD規約2026-08-22）────
# ⚠️ /{year_month} より前に定義すること（FastAPIはルート定義順にマッチを試みるため、
#    後ろに置くと "/export" が year_month="export" としてパスパラメータに吸われる）。
_TARGET_CSV_HEADER = ["年月", "目標売上", "目標アクセス(UU)", "目標CVR(%)", "目標客単価", "経費率(%)"]


@router.get("/export")
def export_targets(db: Session = Depends(get_db)):
    """目標マスタをCSV（BOM付きUTF-8）でエクスポートする。削除済みは含めない。"""
    rows = db.query(Target).filter(Target.archived_at.is_(None)).order_by(Target.year_month).all()
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(_TARGET_CSV_HEADER)
    for t in rows:
        writer.writerow([
            t.year_month,
            t.target_sales,
            t.target_access,
            t.target_cvr,
            t.target_av,
            round(t.expense_rate * 100, 2) if t.expense_rate is not None else "",
        ])
    buf.seek(0)
    disposition = (
        "attachment; filename=\"target_master.csv\"; "
        f"filename*=UTF-8''{quote('目標マスタ.csv')}"
    )
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


@router.post("/import")
async def import_targets(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """目標マスタCSVを一括取込みする（年月キーにupsert）。

    インポートは追加・更新のみ（マスタCRUD規約: 行の削除は絶対にしない）。
    削除済みの年月が見つかった場合は復活させる（upsert_target と同じ思想）。
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
        ym = str(row.get("年月", "")).strip()
        if len(ym) != 7 or ym[4] != "-" or not (ym[:4] + ym[5:]).isdigit():
            error_rows.append(f"{idx + 2}行目: 年月はYYYY-MM形式で指定してください")
            continue
        try:
            sales = float(row.get("目標売上") or 0)
            access = int(float(row.get("目標アクセス(UU)") or 0))
            cvr = float(row.get("目標CVR(%)") or 0)
            av = float(row.get("目標客単価") or 0)
            expense_pct = str(row.get("経費率(%)", "")).strip()
            expense_rate = float(expense_pct) / 100 if expense_pct else 0.15
        except (ValueError, TypeError):
            error_rows.append(f"{idx + 2}行目: 数値の形式が不正です")
            continue

        existing = db.query(Target).filter(Target.year_month == ym).first()
        if existing:
            existing.target_sales = sales
            existing.target_access = access
            existing.target_cvr = cvr
            existing.target_av = av
            existing.expense_rate = expense_rate
            existing.archived_at = None
            updated += 1
        else:
            db.add(Target(
                year_month=ym, target_sales=sales, target_access=access,
                target_cvr=cvr, target_av=av, expense_rate=expense_rate,
            ))
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "error_rows": error_rows}


@router.get("/{year_month}")
def get_target(year_month: str, db: Session = Depends(get_db)):
    target = db.query(Target).filter(
        Target.year_month == year_month, Target.archived_at.is_(None)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="目標が設定されていません")
    return target


@router.post("")
def upsert_target(payload: TargetIn, db: Session = Depends(get_db)):
    """目標マスタへ upsert。削除済み（archived_at設定）の月に保存すると復活する
    （ユーザーが値を入力する＝その月の目標を使う意思表示のため。カテゴリマスタの
    find-or-create再利用と同じ思想。マスタCRUD規約2026-08-22）。
    """
    existing = db.query(Target).filter(Target.year_month == payload.year_month).first()
    if existing:
        existing.target_sales = payload.target_sales
        existing.target_access = payload.target_access
        existing.target_cvr = payload.target_cvr
        existing.target_av = payload.target_av
        existing.expense_rate = payload.expense_rate
        existing.archived_at = None
    else:
        db.add(Target(**payload.model_dump()))
    db.commit()
    return {"message": f"{payload.year_month} の目標を保存しました"}


@router.delete("/{year_month}")
def delete_target(year_month: str, db: Session = Depends(get_db)):
    """月の目標をクリアする（ソフトデリート。マスタCRUD規約2026-08-22）。

    実績（過去の集計・診断結果）には影響しない。同じ年月に再度保存すれば復活する。
    """
    target = db.query(Target).filter(
        Target.year_month == year_month, Target.archived_at.is_(None)
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="目標が設定されていません")
    target.archived_at = datetime.utcnow()
    db.commit()
    return {"deleted_year_month": year_month}
