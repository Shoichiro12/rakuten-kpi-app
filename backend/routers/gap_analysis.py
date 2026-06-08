from datetime import date, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import RppWeekly, Target
from calculations import calc_kpis, calc_change_rate

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
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date.today()
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        current_rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        prev_rows = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week).all()
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
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    level: Literal["u1", "u2", "u3"] = Query("u1"),
    parent: Optional[str] = Query(None),
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
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        current_rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        prev_rows = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week).all()
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

    def _matches_parent(genre_key: str) -> bool:
        """parent フィルタとの一致判定。parent が None の場合は常に True。"""
        if not parent:
            return True
        # genre_key は level に応じた集計キー（例: "スポーツ" or "スポーツ/シューズ"）
        # parent は 1 段上のキーなので前方一致で判定する
        return genre_key == parent or genre_key.startswith(parent + "/")

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
            # --- 追加キー（階層情報） ---
            **path_info,
        })

    result.sort(key=lambda x: x["current"]["gross"], reverse=True)
    return {"genres": result, "level": level, "parent": parent}


@router.get("/product")
def gap_product(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    genre: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    today = date.today()
    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_week = current_week - timedelta(weeks=1)
        q_curr = db.query(RppWeekly).filter(RppWeekly.week_start == current_week)
        q_prev = db.query(RppWeekly).filter(RppWeekly.week_start == prev_week)
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        prev_ym = _prev_month(ym)
        cur_start, cur_end = _month_bounds(ym)
        prev_start, prev_end = _month_bounds(prev_ym)
        q_curr = db.query(RppWeekly).filter(RppWeekly.week_start >= cur_start, RppWeekly.week_start < cur_end)
        q_prev = db.query(RppWeekly).filter(RppWeekly.week_start >= prev_start, RppWeekly.week_start < prev_end)

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
    # 辞書への単純代入（上書き）ではなく商品URLごとに合算する。
    # 週次モードでも安全に動作する（同一週に同一URLは1件のみのため合算しても同値）。
    def _build_prev_agg(rows) -> dict:
        """product_url をキーに gross/cost_of_sales/ad_cost/cv/ct を合算した辞書を返す。
        ctr は ct 加重平均で算出する。"""
        agg: dict = {}
        for r in rows:
            url = r.product_url
            if url not in agg:
                agg[url] = {
                    "gross": 0.0, "cost_of_sales": 0.0,
                    "ad_cost": 0.0, "cv": 0, "ct": 0,
                    "_ctr_sum": 0.0,  # ctr × ct の累計（加重平均用）
                }
            agg[url]["gross"] += r.gross
            agg[url]["cost_of_sales"] += r.cost_of_sales
            agg[url]["ad_cost"] += r.ad_cost
            agg[url]["cv"] += r.cv
            agg[url]["ct"] += r.ct
            agg[url]["_ctr_sum"] += r.ctr * r.ct
        # 加重平均 ctr を確定し、内部フィールドを除去
        for url, v in agg.items():
            v["ctr"] = v["_ctr_sum"] / v["ct"] if v["ct"] > 0 else 0.0
            del v["_ctr_sum"]
        return agg

    prev_map = _build_prev_agg(prev_rows)

    result = []
    for r in current_rows:
        kpis = calc_kpis(r.gross, r.cost_of_sales, r.ad_cost, r.cv, r.ct, ctr=r.ctr)
        prev_agg = prev_map.get(r.product_url)
        prev_kpis = calc_kpis(
            prev_agg["gross"], prev_agg["cost_of_sales"], prev_agg["ad_cost"],
            prev_agg["cv"], prev_agg["ct"], ctr=prev_agg["ctr"]
        ) if prev_agg else None
        changes = {}
        if prev_kpis:
            for k in ["gross", "gp", "cv", "cvr", "roas"]:
                changes[k] = calc_change_rate(kpis[k], prev_kpis[k])

        result.append({
            "product_url": r.product_url,
            "management_no": r.management_no,
            "product_name": r.product_name,
            "genre": r.genre,
            "current": kpis,
            "prev": prev_kpis,
            "changes": changes,
            "limit_cpo_exceeded": kpis["cpo"] > kpis["limit_cpo"] if kpis["limit_cpo"] > 0 else False,
        })

    result.sort(key=lambda x: x["current"]["gross"], reverse=True)
    return {"products": result}


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
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date.today()

    if period == "weekly":
        current_week = get_week_start(date.fromisoformat(date_str) if date_str else today)
        rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        year_month = current_week.strftime("%Y-%m")
    else:
        year_month = date_str[:7] if date_str else today.strftime("%Y-%m")
        m_start, m_end = _month_bounds(year_month)
        rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
        ).all()

    target = db.query(Target).filter(Target.year_month == year_month).first()

    # KGI分解ツリーはすべて rpp_weekly を母数とする RPP軸で統一する。
    # actual_access = RppWeekly.ct（RPPクリック数）
    # actual_cvr   = cv / ct * 100  （RPP経由CVR）
    # actual_av    = gross / cv      （RPP経由客単価）
    # → actual_access × (actual_cvr/100) × actual_av ≈ actual_gross が成立する。
    # ※ MonthlyAnalysis.access_count（店舗全体UU）は母数が異なるため使用しない。
    actual_gross = sum(r.gross for r in rows)
    actual_cv = sum(r.cv for r in rows)
    actual_ct = sum(r.ct for r in rows)   # RPPクリック数（アクセス代替）
    actual_access = actual_ct             # RPP軸ではクリック数をアクセス指標とする
    actual_cvr = round((actual_cv / actual_ct * 100) if actual_ct > 0 else 0, 2)
    actual_av = round((actual_gross / actual_cv) if actual_cv > 0 else 0, 0)

    t_sales = target.target_sales if target else 0
    t_access = target.target_access if target else 0
    t_cvr = target.target_cvr if target else 0
    t_av = target.target_av if target else 0

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
        "has_target": target is not None,
        "kgi": node("売上目標", "kgi", actual_gross, t_sales, "currency"),
        "access": node("クリック数（RPP）", "access", actual_access, t_access, "number"),
        "cvr": node("転換率（CVR）", "cvr", actual_cvr, t_cvr, "percent"),
        "av": node("客単価（Av）", "av", actual_av, t_av, "currency"),
    }
