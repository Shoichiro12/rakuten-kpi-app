from datetime import date, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import RppWeekly, Shop, Target, MonthlyItemSales
from calculations import calc_kpis, calc_change_rate
from access_definitions import (
    MIN_ACCESS_SAMPLE_MONTHLY, MIN_ACCESS_SAMPLE_YEARLY, is_reliable, min_access_for,
)
from period_utils import parse_year, year_bounds, year_month_range
from shop_metrics import get_shop_monthly, get_shop_yearly

router = APIRouter(prefix="/api/gap", tags=["gap"])


# ---------------------------------------------------------------------------
# ジャンル階層ヘルパー
# ---------------------------------------------------------------------------

def _extract_genre_key(genre_str: Optional[str], level: str) -> str:
    """RppWeekly.genre（スラッシュ区切り文字列）を指定レベルのキーに変換する。

    level:
      u1 … 大分類（split[0]）
      u2 … 大/中分類（split[0] + "/" + split[1]）
      u3 … フル文字列（split そのまま）

    スラッシュが存在しない・階層が足りない場合は欠けた部分を "未分類" で補完する。
    genre_str が None または空文字の場合は "未分類" を返す。
    """
    raw = (genre_str or "").strip()
    if not raw:
        if level == "u1":
            return "未分類"
        if level == "u2":
            return "未分類/未分類"
        return "未分類"

    parts = raw.split("/")
    u1 = parts[0].strip() if len(parts) > 0 and parts[0].strip() else "未分類"
    u2 = parts[1].strip() if len(parts) > 1 and parts[1].strip() else "未分類"

    if level == "u1":
        return u1
    if level == "u2":
        return f"{u1}/{u2}"
    # u3: フル文字列を正規化（各要素をstrip）
    normalized = "/".join(p.strip() if p.strip() else "未分類" for p in parts)
    return normalized


def _genre_path_parts(genre_key: str, level: str) -> dict:
    """genre_key をレスポンスに付加するパス情報に変換する。"""
    parts = genre_key.split("/")
    result = {
        "genre_u1": parts[0] if len(parts) > 0 else "未分類",
        "genre_u2": parts[1] if len(parts) > 1 else None,
        "genre_u3": parts[2] if len(parts) > 2 else None,
        "genre_level": level,
        "genre_path": genre_key,
    }
    return result


def _shop_genre_key(row, level: str) -> str:
    """MonthlyItemSales の genre_u1/u2/u3 から指定レベルの集計キーを作る。

    RppWeekly.genre はスラッシュ区切りの1カラムだが、商品分析レポートは大中小が
    別カラムなので専用に組み立てる。欠損は "未分類" で補完し、RPP軸のキー形式
    （_extract_genre_key）と揃えることで、フロントの階層ドリルダウンをそのまま使う。
    """
    u1 = (row.genre_u1 or "").strip() or "未分類"
    u2 = (row.genre_u2 or "").strip() or "未分類"
    u3 = (row.genre_u3 or "").strip() or "未分類"
    if level == "u1":
        return u1
    if level == "u2":
        return f"{u1}/{u2}"
    return f"{u1}/{u2}/{u3}"


def _aggregate_shop_genre(rows, level: str, matches_parent) -> dict:
    """商品分析レポート（店舗全体）をジャンル単位に合算する。"""
    genres: dict = {}
    for r in rows:
        key = _shop_genre_key(r, level)
        if not matches_parent(key):
            continue
        g = genres.setdefault(
            key, {"gross": 0.0, "access": 0, "cv": 0, "ad_cost": 0.0, "ad_sales": 0.0}
        )
        g["gross"] += r.sales or 0
        g["access"] += r.access_uu or 0
        g["cv"] += r.cv or 0
        g["ad_cost"] += r.ad_cost or 0
        g["ad_sales"] += r.ad_sales or 0
    return genres


def _shop_genre_kpis(raw: dict) -> dict:
    """商品分析軸のジャンルKPI。

    注意: ここでの cvr は「アクセス人数(UU) → 注文」であり、RPP軸の
    「クリック → 注文」とは母数が違う。同一画面で混ぜないため、月次は
    STEP1〜STEP3すべてを商品分析軸で統一する（CLAUDE.md の注意点に対応）。
    """
    access = raw["access"]
    cv = raw["cv"]
    gross = raw["gross"]
    ad_cost = raw["ad_cost"]
    return {
        "gross": round(gross, 0),
        "access": access,
        "ct": access,  # フロント互換（アクセス母数を指す既存キー）
        "cv": cv,
        "cvr": round(cv / access * 100, 2) if access > 0 else 0,
        "av": round(gross / cv, 0) if cv > 0 else 0,
        "ad_cost": round(ad_cost, 0),
        # 広告費が未取込の場合は 0% ではなく None を返す。0%と表示すると
        # 「広告効率が最悪」と誤解されるが、実際は「データが無い」だけのため。
        # フロントの formatPercent は null を「—」として描画する。
        "roas": round(raw["ad_sales"] / ad_cost * 100, 1) if ad_cost > 0 else None,
    }


def _merge_shop_items_by_product(rows) -> list:
    """MonthlyItemSales の複数月分を商品単位に合算する（年次のSTEP3用）。

    月次は1商品=1行だが、年次は同一商品が最大12行になるため、
    _build_shop_products に渡す前に商品キーで合算する。属性（商品名・ジャンル・URL）
    は最新月の行の値を採用する。
    """
    from types import SimpleNamespace
    agg: dict = {}
    for r in rows:
        key = r.management_no or r.product_url
        a = agg.get(key)
        if a is None:
            a = agg[key] = SimpleNamespace(
                management_no=r.management_no, product_url=r.product_url,
                product_name=r.product_name,
                genre_u1=r.genre_u1, genre_u2=r.genre_u2, genre_u3=r.genre_u3,
                sales=0.0, access_uu=0, cv=0, ad_cost=0.0, ad_sales=0.0,
                _latest=r.year_month,
            )
        a.sales += r.sales or 0
        a.access_uu += r.access_uu or 0
        a.cv += r.cv or 0
        a.ad_cost += r.ad_cost or 0
        a.ad_sales += r.ad_sales or 0
        if r.year_month >= a._latest:
            a._latest = r.year_month
            a.product_url = r.product_url
            a.product_name = r.product_name
            a.genre_u1, a.genre_u2, a.genre_u3 = r.genre_u1, r.genre_u2, r.genre_u3
    return list(agg.values())


def _build_shop_products(items, prev_items, genre: Optional[str],
                         site_uu_threshold: int = MIN_ACCESS_SAMPLE_MONTHLY) -> dict:
    """商品分析レポート（店舗全体）から商品別KPIを組み立てる（月次のSTEP3用）。

    RPP軸の calc_kpis は広告費・原価が前提だが、商品分析には原価が無いため
    そのままでは Rev/ROI/Limit CPO が算出できない。ここでは店舗全体軸で意味のある
    指標（売上・アクセスUU・CVR・客単価・広告費・ROAS）だけを返し、
    広告効率の判定は limit_cpo_exceeded=False として出さない（誤判定を避ける）。
    """
    def _match(row) -> bool:
        if not genre:
            return True
        key3 = _shop_genre_key(row, "u3")
        return key3 == genre or key3.startswith(genre + "/")

    def _kpis(row) -> dict:
        access = row.access_uu or 0
        cv = row.cv or 0
        sales = row.sales or 0
        ad_cost = row.ad_cost or 0
        return {
            "gross": round(sales, 0),
            "access": access,
            "ct": access,
            "cv": cv,
            "cvr": round(cv / access * 100, 2) if access > 0 else 0,
            "av": round(sales / cv, 0) if cv > 0 else 0,
            "ad_cost": round(ad_cost, 0),
            # 広告費未取込は 0% ではなく None（「—」表示）。上の _shop_genre_kpis と同方針。
            "roas": round((row.ad_sales or 0) / ad_cost * 100, 1) if ad_cost > 0 else None,
            "limit_cpo": 0,
            "cpo": round(ad_cost / cv, 0) if cv > 0 else 0,
        }

    prev_by_key = {
        (r.management_no or r.product_url): r for r in prev_items
    }

    result = []
    for r in items:
        if not _match(r):
            continue
        key = r.management_no or r.product_url
        kpis = _kpis(r)
        prev_row = prev_by_key.get(key)
        prev_kpis = _kpis(prev_row) if prev_row else None
        changes = {}
        if prev_kpis:
            for k in ["gross", "cv", "cvr", "av", "roas", "access"]:
                # roas は広告費未取込だと None。None 同士の減算で落ちるため除外する。
                if kpis.get(k) is None or prev_kpis.get(k) is None:
                    changes[k] = None
                    continue
                changes[k] = calc_change_rate(kpis[k], prev_kpis[k])
        result.append({
            "product_url": r.product_url,
            "management_no": r.management_no,
            "product_name": r.product_name,
            "genre": _shop_genre_key(r, "u3"),
            "current": kpis,
            "prev": prev_kpis,
            "changes": changes,
            "limit_cpo_exceeded": False,
            # site_uu 軸。母数（訪問UU）が閾値未満ならCVR・客単価は参考値（要件No.5/No.6）。
            "access_axis": "site_uu",
            "reliable": is_reliable(kpis.get("access"), site_uu_threshold),
        })

    result.sort(key=lambda x: x["current"]["gross"], reverse=True)
    return {"products": result, "axis": "shop", "access_axis": "site_uu"}


def get_week_start(d: date) -> date:
    weekday = d.isoweekday() % 7
    return d - timedelta(days=weekday)


def _weighted_ctr(rows) -> float:
    total_ct = sum(r.ct for r in rows)
    if total_ct == 0:
        return 0.0
    return sum(r.ctr * r.ct for r in rows) / total_ct


def agg_rows(rows) -> Optional[dict]:
    if not rows:
        return None
    return {
        "gross": sum(r.gross for r in rows),
        "cost_of_sales": sum(r.cost_of_sales for r in rows),
        "ad_cost": sum(r.ad_cost for r in rows),
        "cv": sum(r.cv for r in rows),
        "ct": sum(r.ct for r in rows),
        "ctr": _weighted_ctr(rows),
    }


@router.get("/shop")
def gap_shop(
    period: Literal["weekly", "monthly", "yearly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    include_inactive: bool = Query(True, description="Falseで廃盤（is_active=False）商品を集計から除外"),
    db: Session = Depends(get_db),
):
    from masters import inactive_management_nos
    # 既定(True)は従来どおり全商品込みでKGIは不変。Falseで廃盤を除外できる。
    inactive = set() if include_inactive else inactive_management_nos(db)
    today = date.today()
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        current_rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        prev_rows = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week).all()
    elif period == "yearly":
        # 年次=暦年固定。前期=前年（UIバックログ2026-08-03 区切りB）
        year = parse_year(date_str, today)
        cur_start, cur_end = year_bounds(year)
        prev_start, prev_end = year_bounds(year - 1)
        current_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end
        ).all()
        prev_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end
        ).all()
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        prev_ym = _prev_month(ym)
        cur_start, cur_end = _month_bounds(ym)
        prev_start, prev_end = _month_bounds(prev_ym)
        current_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end
        ).all()
        prev_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end
        ).all()

    if inactive:
        current_rows = [r for r in current_rows if r.management_no not in inactive]
        prev_rows = [r for r in prev_rows if r.management_no not in inactive]

    # 月次・年次はSTEP2・STEP3と同じく商品分析＝店舗全体を正とする。
    # ここだけRPP専用のままだと、RPP未取込の月に current が null になり、
    # STEP3が shopData.current.ctr を参照して画面全体がクラッシュする。
    if period != "weekly":
        if period == "yearly":
            shop_cur = get_shop_yearly(db, year, exclude_management_nos=inactive or None)
            shop_prev = get_shop_yearly(db, year - 1, exclude_management_nos=inactive or None) if shop_cur else None
        else:
            shop_cur = get_shop_monthly(db, ym, exclude_management_nos=inactive or None)
            shop_prev = get_shop_monthly(db, prev_ym, exclude_management_nos=inactive or None) if shop_cur else None
        if shop_cur:

            def _to_kpis(s: dict) -> dict:
                return {
                    "gross": s["sales"],
                    "access": s["access"],
                    "ct": s["access"],
                    "cv": s["cv"],
                    "cvr": s["cvr"],
                    "av": s["av"],
                    # 商品分析にはRPPのCTR概念が無い。0にすると「CTRが低い」判定が
                    # 誤発火するため、比較の起点にならない値として明示的に0を返し、
                    # 参照側は ctr > 0 のときだけ判定する（既存の実装と整合）。
                    "ctr": 0,
                    "ad_cost": 0,
                    "roas": 0,
                }

            cur_k = _to_kpis(shop_cur)
            prev_k = _to_kpis(shop_prev) if shop_prev else None
            ch = {}
            if prev_k:
                for k in ["gross", "cv", "cvr", "av", "access"]:
                    ch[k] = calc_change_rate(cur_k[k], prev_k[k])
            return {"current": cur_k, "prev": prev_k, "changes": ch, "axis": "shop"}

    current = agg_rows(current_rows)
    prev = agg_rows(prev_rows)
    if not current:
        return {"current": None, "prev": None, "changes": {}}

    current_kpis = calc_kpis(**current)
    prev_kpis = calc_kpis(**prev) if prev else None

    changes = {}
    if prev_kpis:
        for k in ["gross", "gp", "cv", "cvr", "av", "ad_cost", "roas", "roi"]:
            changes[k] = calc_change_rate(current_kpis[k], prev_kpis[k])

    return {
        "current": current_kpis,
        "prev": prev_kpis,
        "changes": changes,
    }


@router.get("/genre")
def gap_genre(
    period: Literal["weekly", "monthly", "yearly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    level: Literal["u1", "u2", "u3"] = Query("u1"),
    parent: Optional[str] = Query(None),
    include_inactive: bool = Query(True, description="Falseで廃盤（is_active=False）商品を集計から除外"),
    db: Session = Depends(get_db),
):
    """ジャンル別GAP分析（階層ドリルダウン対応）。

    クエリパラメータ:
      level  : 集計粒度。u1=大分類（デフォルト）/ u2=大/中分類 / u3=フル
      parent : 上位ジャンルでの絞り込み。
               level=u2 のとき parent="スポーツ" → "スポーツ/*" のみ集計。
               level=u3 のとき parent="スポーツ/シューズ" → "スポーツ/シューズ/*" のみ。
               level=u1 のとき parent は無視される。
               未指定は絞り込みなし（全ジャンル）。

    レスポンス:
      既存の { genres: [ { genre, current, prev, changes }, ... ] } 構造を維持。
      各要素に genre_path / genre_level / genre_u1 / genre_u2 / genre_u3 を追加。
    """
    today = date.today()
    shop_cur_items: list = []
    shop_prev_items: list = []
    # site_uu軸のreliable判定閾値（年次は年換算値を使う。表示系の参考値フラグのみ）
    site_uu_threshold = MIN_ACCESS_SAMPLE_YEARLY if period == "yearly" else MIN_ACCESS_SAMPLE_MONTHLY
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        current_rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        prev_rows = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week).all()
    elif period == "yearly":
        # 年次=暦年。月次と同じく商品分析＝店舗全体を正とし、無ければRPPへフォールバック。
        year = parse_year(date_str, today)
        cur_start, cur_end = year_bounds(year)
        prev_start, prev_end = year_bounds(year - 1)
        ym_from, ym_to = year_month_range(year)
        prev_ym_from, prev_ym_to = year_month_range(year - 1)
        shop_cur_items = db.query(MonthlyItemSales).filter(
            MonthlyItemSales.year_month >= ym_from, MonthlyItemSales.year_month <= ym_to
        ).all()
        if shop_cur_items:
            shop_prev_items = db.query(MonthlyItemSales).filter(
                MonthlyItemSales.year_month >= prev_ym_from, MonthlyItemSales.year_month <= prev_ym_to
            ).all()
        current_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end
        ).all()
        prev_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end
        ).all()
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        prev_ym = _prev_month(ym)
        cur_start, cur_end = _month_bounds(ym)
        prev_start, prev_end = _month_bounds(prev_ym)
        # 月次は STEP1（KGIツリー・評価マトリクス）が商品分析＝店舗全体を正としている。
        # ジャンル内訳も同じ軸で出さないと、UUから絞り込んだ先がRPPクリック数になり
        # ドリルダウンの数字が繋がらない。商品分析があればそちらを優先する。
        shop_cur_items = db.query(MonthlyItemSales).filter(
            MonthlyItemSales.year_month == ym
        ).all()
        if shop_cur_items:
            shop_prev_items = db.query(MonthlyItemSales).filter(
                MonthlyItemSales.year_month == prev_ym
            ).all()
        current_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end
        ).all()
        prev_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end
        ).all()

    # 廃盤除外（既定 include_inactive=True は全込みで従来どおり）。
    from masters import inactive_management_nos
    _inactive = set() if include_inactive else inactive_management_nos(db)
    if _inactive:
        current_rows = [r for r in current_rows if r.management_no not in _inactive]
        prev_rows = [r for r in prev_rows if r.management_no not in _inactive]
        shop_cur_items = [r for r in shop_cur_items if r.management_no not in _inactive]
        shop_prev_items = [r for r in shop_prev_items if r.management_no not in _inactive]

    def _matches_parent(genre_key: str) -> bool:
        """parent フィルタとの一致判定。parent が None の場合は常に True。"""
        if not parent:
            return True
        # genre_key は level に応じた集計キー（例: "スポーツ" or "スポーツ/シューズ"）
        # parent は 1 段上のキーなので前方一致で判定する
        return genre_key == parent or genre_key.startswith(parent + "/")

    # --- 月次かつ商品分析データあり: 店舗全体軸でジャンル内訳を返す ---
    if shop_cur_items:
        cur_g = _aggregate_shop_genre(shop_cur_items, level, _matches_parent)
        prev_g = _aggregate_shop_genre(shop_prev_items, level, _matches_parent)
        shop_result = []
        for genre_key, raw in cur_g.items():
            kpis = _shop_genre_kpis(raw)
            prev_kpis = _shop_genre_kpis(prev_g[genre_key]) if genre_key in prev_g else None
            changes = {}
            if prev_kpis:
                for k in ["gross", "cv", "cvr", "av", "roas", "access"]:
                    # roas は広告費未取込だと None。None 同士の減算で落ちるため除外する。
                    if kpis.get(k) is None or prev_kpis.get(k) is None:
                        changes[k] = None
                        continue
                    changes[k] = calc_change_rate(kpis[k], prev_kpis[k])
            shop_result.append({
                "genre": genre_key,
                "current": kpis,
                "prev": prev_kpis,
                "changes": changes,
                # site_uu 軸。母数（訪問UU）が閾値未満ならCVR・客単価は参考値（要件No.5/No.6）。
                "access_axis": "site_uu",
                "reliable": is_reliable(kpis.get("access"), site_uu_threshold),
                **_genre_path_parts(genre_key, level),
            })
        shop_result.sort(key=lambda x: x["current"]["gross"], reverse=True)
        return {
            "genres": shop_result, "level": level, "parent": parent,
            "axis": "shop", "access_axis": "site_uu",
        }

    def group_by_genre(rows):
        """level・parent に基づいてジャンルキーを解決し集計する。"""
        genres: dict = {}
        genre_rows: dict = {}
        for r in rows:
            g_key = _extract_genre_key(r.genre, level)
            if not _matches_parent(g_key):
                continue
            if g_key not in genres:
                genres[g_key] = {
                    "gross": 0, "cost_of_sales": 0, "ad_cost": 0,
                    "cv": 0, "ct": 0, "ctr": 0,
                }
                genre_rows[g_key] = []
            genres[g_key]["gross"] += r.gross
            genres[g_key]["cost_of_sales"] += r.cost_of_sales
            genres[g_key]["ad_cost"] += r.ad_cost
            genres[g_key]["cv"] += r.cv
            genres[g_key]["ct"] += r.ct
            genre_rows[g_key].append(r)
        for g_key in genres:
            genres[g_key]["ctr"] = _weighted_ctr(genre_rows[g_key])
        return genres

    current_by_genre = group_by_genre(current_rows)
    prev_by_genre = group_by_genre(prev_rows)

    result = []
    for genre_key, raw in current_by_genre.items():
        kpis = calc_kpis(**raw)
        prev_raw = prev_by_genre.get(genre_key)
        prev_kpis = calc_kpis(**prev_raw) if prev_raw else None
        changes = {}
        if prev_kpis:
            for k in ["gross", "gp", "cv", "cvr", "av", "roas"]:
                changes[k] = calc_change_rate(kpis[k], prev_kpis[k])

        path_info = _genre_path_parts(genre_key, level)
        result.append({
            # --- 既存キー（互換維持） ---
            "genre": genre_key,
            "current": kpis,
            "prev": prev_kpis,
            "changes": changes,
            # rpp_click 軸。母数（クリック数）が閾値未満ならCVR・客単価は参考値（要件No.5/No.6）。
            "access_axis": "rpp_click",
            "reliable": is_reliable(kpis.get("ct"), min_access_for(period)),
            # --- 追加キー（階層情報） ---
            **path_info,
        })

    result.sort(key=lambda x: x["current"]["gross"], reverse=True)
    return {"genres": result, "level": level, "parent": parent, "access_axis": "rpp_click"}


@router.get("/product")
def gap_product(
    period: Literal["weekly", "monthly", "yearly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    genre: Optional[str] = Query(None),
    include_inactive: bool = Query(False, description="Trueで廃盤（is_active=False）商品も含める"),
    db: Session = Depends(get_db),
):
    from masters import inactive_management_nos
    today = date.today()
    # 商品別ドリルダウンからは廃盤商品を既定で除外する。
    inactive = set() if include_inactive else inactive_management_nos(db)
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        q_curr = db.query(RppWeekly).filter(RppWeekly.week_start == current_week)
        q_prev = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week)
    elif period == "yearly":
        # 年次=暦年。月次と同じく商品分析を正とし、商品単位に合算してから組み立てる。
        year = parse_year(date_str, today)
        cur_start, cur_end = year_bounds(year)
        prev_start, prev_end = year_bounds(year - 1)
        q_curr = db.query(RppWeekly).filter(RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end)
        q_prev = db.query(RppWeekly).filter(RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end)

        ym_from, ym_to = year_month_range(year)
        prev_from, prev_to = year_month_range(year - 1)
        shop_items = db.query(MonthlyItemSales).filter(
            MonthlyItemSales.year_month >= ym_from, MonthlyItemSales.year_month <= ym_to
        ).all()
        if shop_items:
            shop_prev = db.query(MonthlyItemSales).filter(
                MonthlyItemSales.year_month >= prev_from, MonthlyItemSales.year_month <= prev_to
            ).all()
            if inactive:
                shop_items = [r for r in shop_items if r.management_no not in inactive]
                shop_prev = [r for r in shop_prev if r.management_no not in inactive]
            return _build_shop_products(
                _merge_shop_items_by_product(shop_items),
                _merge_shop_items_by_product(shop_prev),
                genre,
                site_uu_threshold=MIN_ACCESS_SAMPLE_YEARLY,
            )
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        prev_ym = _prev_month(ym)
        cur_start, cur_end = _month_bounds(ym)
        prev_start, prev_end = _month_bounds(prev_ym)
        q_curr = db.query(RppWeekly).filter(RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end)
        q_prev = db.query(RppWeekly).filter(RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end)

        # STEP2（ジャンル別）と同じく、月次は商品分析＝店舗全体を正とする。
        # RPPしか見ないと、RPP未取込の月にドリルダウンした先が空になる。
        shop_items = db.query(MonthlyItemSales).filter(MonthlyItemSales.year_month == ym).all()
        if shop_items:
            shop_prev = db.query(MonthlyItemSales).filter(
                MonthlyItemSales.year_month == prev_ym
            ).all()
            if inactive:
                shop_items = [r for r in shop_items if r.management_no not in inactive]
                shop_prev = [r for r in shop_prev if r.management_no not in inactive]
            return _build_shop_products(shop_items, shop_prev, genre)

    if genre:
        # ジャンルは階層キー（大分類 "スポーツ" / 大中 "スポーツ/シューズ"）で渡される。
        # RppWeekly.genre はフル文字列（"スポーツ/シューズ" 等）なので完全一致だと
        # 上位キー（u1/u2）では決して一致せず 0 件になる。指定キー自身＋その配下を
        # 前方一致で拾う（gap/genre の階層絞り込みと整合）。
        genre_filter = (RppWeekly.genre == genre) | (RppWeekly.genre.like(genre + "/%"))
        q_curr = q_curr.filter(genre_filter)
        q_prev = q_prev.filter(genre_filter)

    current_rows = q_curr.all()
    prev_rows = q_prev.all()

    # 月次モードでは同一商品が複数週レコードとして存在するため、
    # 商品管理番号（無ければ商品URL）をキーに1商品=1行へ合算する。
    # 商品名・ジャンル・URLは最新週（week_start が最大）のレコードの値を採用する
    # （週によって商品名が変更されるため、常に最新の名称で表示する）。
    # 週次モードでも安全に動作する（同一週に同一商品は1件のみのため合算しても同値）。
    def _agg_key(r) -> str:
        return r.management_no or r.product_url

    def _build_agg(rows) -> dict:
        """商品キーごとに gross/cost_of_sales/ad_cost/cv/ct を合算した辞書を返す。
        ctr は ct 加重平均。商品名等の属性は最新週のレコードから採用する。"""
        agg: dict = {}
        for r in rows:
            key = _agg_key(r)
            if key not in agg:
                agg[key] = {
                    "gross": 0.0, "cost_of_sales": 0.0,
                    "ad_cost": 0.0, "cv": 0, "ct": 0,
                    "_ctr_sum": 0.0,  # ctr × ct の累計（加重平均用）
                    "_latest_week": r.week_start,
                    "product_url": r.product_url,
                    "management_no": r.management_no,
                    "product_name": r.product_name,
                    "genre": r.genre,
                }
            a = agg[key]
            a["gross"] += r.gross
            a["cost_of_sales"] += r.cost_of_sales
            a["ad_cost"] += r.ad_cost
            a["cv"] += r.cv
            a["ct"] += r.ct
            a["_ctr_sum"] += r.ctr * r.ct
            # 最新週の属性（商品名・ジャンル・URL）で上書き
            if r.week_start >= a["_latest_week"]:
                a["_latest_week"] = r.week_start
                a["product_url"] = r.product_url
                a["management_no"] = r.management_no
                a["product_name"] = r.product_name
                a["genre"] = r.genre
        for key, v in agg.items():
            v["ctr"] = v["_ctr_sum"] / v["ct"] if v["ct"] > 0 else 0.0
            del v["_ctr_sum"]
            del v["_latest_week"]
        return agg

    current_map = _build_agg(current_rows)
    prev_map = _build_agg(prev_rows)

    result = []
    for key, a in current_map.items():
        # 廃盤商品を除外（include_inactive=True のときは inactive が空なので通過）
        if a["management_no"] and a["management_no"] in inactive:
            continue
        kpis = calc_kpis(a["gross"], a["cost_of_sales"], a["ad_cost"], a["cv"], a["ct"], ctr=a["ctr"])
        prev_agg = prev_map.get(key)
        prev_kpis = calc_kpis(
            prev_agg["gross"], prev_agg["cost_of_sales"], prev_agg["ad_cost"],
            prev_agg["cv"], prev_agg["ct"], ctr=prev_agg["ctr"]
        ) if prev_agg else None
        changes = {}
        if prev_kpis:
            for k in ["gross", "gp", "cv", "cvr", "roas"]:
                changes[k] = calc_change_rate(kpis[k], prev_kpis[k])

        result.append({
            "product_url": a["product_url"],
            "management_no": a["management_no"],
            "product_name": a["product_name"],
            "genre": a["genre"],
            "current": kpis,
            "prev": prev_kpis,
            "changes": changes,
            "limit_cpo_exceeded": kpis["cpo"] > kpis["limit_cpo"] if kpis["limit_cpo"] > 0 else False,
            # rpp_click 軸。母数（クリック数）が閾値未満ならCVR・客単価は参考値（要件No.5/No.6）。
            "access_axis": "rpp_click",
            "reliable": is_reliable(kpis.get("ct"), min_access_for(period)),
        })

    result.sort(key=lambda x: x["current"]["gross"], reverse=True)
    return {"products": result, "access_axis": "rpp_click"}


def _prev_month(ym: str) -> str:
    year, month = int(ym[:4]), int(ym[5:])
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _month_bounds(ym: str) -> tuple[date, date]:
    """'YYYY-MM' から [月初, 翌月初) の半開区間を返す。

    月次フィルタは元々 func.strftime("%Y-%m", week_start) を使っていたが、strftime は
    SQLite 専用のSQL関数で PostgreSQL(本番=Supabase)には存在せず実行時エラーになる。
    week_start は Date 型なので、この半開区間で範囲フィルタすれば SQLite / Postgres
    双方で同一に動く（月跨ぎ週は week_start の月に丸める従来仕様も維持される）。
    """
    year, month = int(ym[:4]), int(ym[5:7])
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


@router.get("/kpi-tree")
def get_kpi_tree(
    period: Literal["weekly", "monthly", "yearly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date.today()
    year: Optional[int] = None

    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        year_month = current_week.strftime("%Y-%m")
    elif period == "yearly":
        year = parse_year(date_str, today)
        y_start, y_end = year_bounds(year)
        rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= y_start, RppWeekly.week_start < y_end
        ).all()
        year_month = None
    else:
        year_month = date_str[:7] if date_str else today.strftime("%Y-%m")
        m_start, m_end = _month_bounds(year_month)
        rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
        ).all()

    target = (
        db.query(Target).filter(Target.year_month == year_month).first()
        if year_month else None
    )

    # KGI分解ツリーはすべて rpp_weekly を母数とする RPP軸で統一する。
    # actual_access = RppWeekly.ct（RPPクリック数）
    # actual_cvr   = cv / ct * 100  （RPP経由CVR）
    # actual_av    = gross / cv      （RPP経由客単価）
    # → actual_access × (actual_cvr/100) × actual_av ≈ actual_gross が成立する。
    # ※ MonthlyAnalysis.access_count（店舗全体UU）は母数が異なるため使用しない。
    # 月次は商品分析レポート（店舗全体売上・UU）を正とする。
    # KGI = アクセスUU × 転換率 × 客単価 が同一データ軸で成立する。
    # データが無い月・週次はRPP軸（クリック数ベース）へフォールバック。
    if period == "monthly":
        shop = get_shop_monthly(db, year_month)
    elif period == "yearly":
        shop = get_shop_yearly(db, year)
    else:
        shop = None
    if shop:
        actual_gross = shop["sales"]
        actual_access = shop["access"]
        actual_cvr = shop["cvr"]
        actual_av = shop["av"]
        access_label = "アクセス人数（UU）"
    else:
        actual_gross = sum(r.gross for r in rows)
        actual_cv = sum(r.cv for r in rows)
        actual_ct = sum(r.ct for r in rows)   # RPPクリック数（アクセス代替）
        actual_access = actual_ct             # RPP軸ではクリック数をアクセス指標とする
        actual_cvr = round((actual_cv / actual_ct * 100) if actual_ct > 0 else 0, 2)
        actual_av = round((actual_gross / actual_cv) if actual_cv > 0 else 0, 0)
        access_label = "クリック数（RPP）"

    # アクセス軸を明示する（要件No.5）。shop=訪問UU / rpp=RPPクリック数。
    access_axis = "site_uu" if shop else "rpp_click"

    if period == "yearly":
        # 年次のKGI目標: 年間売上予算（暦年固定）→ 無ければ月次targetsの年内合算。
        # アクセス・CVR・客単価の年次目標は定義しない（月次目標の単純合算・平均は
        # 意味が壊れるため0=未設定扱い。KGIのみ目標比較する）。
        shop_row = db.query(Shop).first()
        annual = shop_row.annual_sales_budget if shop_row else None
        if annual and annual > 0:
            t_sales = annual
        else:
            t_sales = sum(
                t.target_sales or 0
                for t in db.query(Target).filter(
                    Target.year_month >= f"{year}-01", Target.year_month <= f"{year}-12"
                ).all()
            )
        t_access = 0
        t_cvr = 0
        t_av = 0
        has_target = t_sales > 0
    else:
        t_sales = target.target_sales if target else 0
        t_access = target.target_access if target else 0
        t_cvr = target.target_cvr if target else 0
        t_av = target.target_av if target else 0
        has_target = target is not None

    def node(label: str, key: str, actual: float, target_val: float, unit: str) -> dict:
        gap = actual - target_val
        gap_rate = round((gap / target_val * 100) if target_val > 0 else 0, 1)
        achieve = round((actual / target_val * 100) if target_val > 0 else 0, 1)
        return {
            "label": label, "key": key,
            "target": target_val, "actual": actual,
            "gap": round(gap, 1), "gap_rate": gap_rate,
            "achieve_rate": achieve, "unit": unit,
        }

    return {
        "has_target": has_target,
        "axis": "shop" if shop else "rpp",
        "access_axis": access_axis,
        # アクセス母数が信用に足るか（要件No.6）。false ならCVR・客単価は参考値。
        "reliable": is_reliable(actual_access, min_access_for(period)),
        "kgi": node("売上目標", "kgi", actual_gross, t_sales, "currency"),
        "access": node(access_label, "access", actual_access, t_access, "number"),
        "cvr": node("転換率（CVR）", "cvr", actual_cvr, t_cvr, "percent"),
        "av": node("客単価（Av）", "av", actual_av, t_av, "currency"),
    }
