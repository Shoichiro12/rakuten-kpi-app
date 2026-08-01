# -*- coding: utf-8 -*-
"""CVR/CTRベンチマークの3段フォールバック（設計ドキュメント2026-08-01 3-B / 3-B'）。

優先順位（オーナー確認済み・確定）:
  ① ジャンル別ベンチマーク … RMS画面で見た値の手入力（GenreBenchmark）。
     詳細な階層（u1/u2/u3 完全一致）ほど優先。手入力が無ければ自店の同ジャンル集計。
  ② 自店内比較             … 店舗全体平均（呼び出し側が算出して渡す）
  ③ 汎用ベースライン        … ページ全体CVR 7% / 広告経由CVR 3〜5%（判定は下限3%）/ CTR 2%

どの段の値を使ったかを必ず source として返し、フロントで根拠表示できるようにする。
しきい値定数は calculations.py が単一の真実。

自店ジャンル集計（①の代用）が「参考になる母数」を持つかは呼び出し側が判断せず、
このモジュールが集計行数・母数合計で判定する（母数不足の集計値をベンチマークに
使うと、それ自体が統計ノイズになるため）。
"""
from typing import Literal, Optional

from sqlalchemy.orm import Session

from models import GenreBenchmark
from calculations import (
    AD_CVR_BASELINE,
    AD_CVR_BASELINE_LABEL,
    CTR_BASELINE,
    PAGE_CVR_BASELINE,
)

BenchmarkMetric = Literal["page_cvr", "ad_cvr", "ctr"]

METRIC_LABELS = {
    "page_cvr": "ページ全体CVR",
    "ad_cvr": "RPP広告経由CVR",
    "ctr": "CTR",
}

# ③汎用ベースライン（最終フォールバック）
DEFAULTS: dict = {
    "page_cvr": {"value": PAGE_CVR_BASELINE, "label": f"{PAGE_CVR_BASELINE:.0f}%"},
    "ad_cvr": {"value": AD_CVR_BASELINE, "label": AD_CVR_BASELINE_LABEL},
    "ctr": {"value": CTR_BASELINE, "label": f"{CTR_BASELINE:.0f}%"},
}

# 自店ジャンル集計をベンチマークとして採用する最低商品数。
# 1〜2商品の平均を「ジャンル基準」と呼ぶのは無理があるため。
MIN_GENRE_SAMPLE_PRODUCTS = 3


def find_manual_benchmark(
    db: Session,
    metric: BenchmarkMetric,
    genre_u1: Optional[str],
    genre_u2: Optional[str] = None,
    genre_u3: Optional[str] = None,
) -> Optional[GenreBenchmark]:
    """手入力ベンチマーク（GenreBenchmark）を詳細階層優先で探す。

    u1/u2/u3 完全一致 → u1/u2 一致 → u1 のみ一致 の順。ジャンル不明（u1 None）は対象外。
    """
    if not genre_u1:
        return None
    candidates = (
        db.query(GenreBenchmark)
        .filter(GenreBenchmark.metric == metric, GenreBenchmark.genre_u1 == genre_u1)
        .all()
    )
    if not candidates:
        return None

    def _rank(b: GenreBenchmark) -> int:
        # 一致の詳細度（高いほど優先）
        if genre_u3 and b.genre_u3 == genre_u3 and b.genre_u2 == genre_u2:
            return 3
        if genre_u2 and b.genre_u2 == genre_u2 and not b.genre_u3:
            return 2
        if not b.genre_u2 and not b.genre_u3:
            return 1
        return 0

    best = max(candidates, key=_rank)
    return best if _rank(best) > 0 else None


def resolve_benchmark(
    db: Session,
    metric: BenchmarkMetric,
    *,
    genre_u1: Optional[str] = None,
    genre_u2: Optional[str] = None,
    genre_u3: Optional[str] = None,
    genre_avg: Optional[float] = None,
    genre_sample_products: int = 0,
    shop_avg: Optional[float] = None,
) -> dict:
    """3段フォールバックでベンチマーク値を解決する。

    Args:
        genre_avg / genre_sample_products :
            自店の同ジャンル集計値と、その集計に含まれる商品数（呼び出し側で算出）。
            商品数が MIN_GENRE_SAMPLE_PRODUCTS 未満なら①としては採用しない。
        shop_avg : 店舗全体平均（②）。0以下は「データなし」として扱う。

    Returns:
        {"metric", "metric_label", "value", "source", "source_label", "detail"}
        source: 'manual_genre' | 'shop_genre' | 'shop_avg' | 'default'
    """
    label = METRIC_LABELS[metric]

    # ① 手入力のジャンル別ベンチマーク（RMS画面の値）
    manual = find_manual_benchmark(db, metric, genre_u1, genre_u2, genre_u3)
    if manual is not None:
        genre_label = "/".join([g for g in (manual.genre_u1, manual.genre_u2, manual.genre_u3) if g])
        return {
            "metric": metric,
            "metric_label": label,
            "value": manual.value,
            "source": "manual_genre",
            "source_label": f"ジャンル別ベンチマーク（手入力: {genre_label}）",
            "detail": manual.memo or "RMS表示値の手入力",
        }

    # ① 代用: 自店の同ジャンル集計（十分な商品数がある場合のみ）
    if (
        genre_avg is not None and genre_avg > 0
        and genre_sample_products >= MIN_GENRE_SAMPLE_PRODUCTS
    ):
        genre_label = "/".join([g for g in (genre_u1, genre_u2, genre_u3) if g]) or "同ジャンル"
        return {
            "metric": metric,
            "metric_label": label,
            "value": round(genre_avg, 2),
            "source": "shop_genre",
            "source_label": f"自店ジャンル集計（{genre_label}・{genre_sample_products}商品）",
            "detail": "自店の同ジャンル商品の加重平均",
        }

    # ② 自店内比較（店舗全体平均）
    if shop_avg is not None and shop_avg > 0:
        return {
            "metric": metric,
            "metric_label": label,
            "value": round(shop_avg, 2),
            "source": "shop_avg",
            "source_label": "自店全体平均",
            "detail": "同期間の自店全商品の加重平均",
        }

    # ③ 汎用ベースライン
    d = DEFAULTS[metric]
    return {
        "metric": metric,
        "metric_label": label,
        "value": d["value"],
        "source": "default",
        "source_label": f"汎用ベースライン（{d['label']}）",
        "detail": "ジャンル・自店データが無い場合の最終フォールバック値",
    }
