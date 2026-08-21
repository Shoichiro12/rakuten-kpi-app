# -*- coding: utf-8 -*-
"""期間（週次・月次・年次）の共通ヘルパー（UIバックログ2026-08-03 区切りB）。

年次は【暦年固定】（1〜12月）。予算年度起点（shops.budget_year_start_month）は
年間目標プランナー側の役割のままで、年次表示には持ち込まない（オーナー承認済み）。

年次のスコープは表示系のみ（dashboard / gap / products / export）。
診断・アラート・提案系は月次のまま（母数ゲート等が月次前提のため）。
"""
import calendar
from collections import Counter
from datetime import date, timedelta
from typing import Optional


def prorate_weekly_target_field(db, week_start: date, field: str) -> Optional[float]:
    """週（7日間）の目標値を、各日が属する月の目標を日割りして合算する。

    ダッシュボード段1（HeroKgi）とKPI評価マトリクス（`routers/evaluation.py`）が
    週次目標を別々に計算していた不整合（同一画面で達成率が2種類出る）を解消するため、
    週次目標按分のロジックはここに一本化する。**フロント・他エンドポイントで
    週次目標を再計算しないこと。** 新しく週次目標が要る場所はこの関数を呼ぶ。

    月をまたがない週では `target.<field> * 7 / days_in_month` という単純比率と同じ結果になる
    （evaluation.py の旧実装と同値）。月をまたぐ週は、各日が属する月の日数比率で
    合算する（例: 8/30〜9/5 なら 8月分2日 + 9月分5日をそれぞれの月の日数で日割り）。

    field: `models.Target` の属性名（例: "target_sales" / "target_access"）。
    戻り値: 対象週にかかる月のいずれにも目標が無ければ None。
    """
    from models import Target  # 遅延importで循環参照を避ける

    month_days: Counter = Counter()
    for i in range(7):
        d = week_start + timedelta(days=i)
        month_days[d.strftime("%Y-%m")] += 1

    total = 0.0
    any_target = False
    for year_month, days in month_days.items():
        target = db.query(Target).filter(Target.year_month == year_month).first()
        value = getattr(target, field, 0) if target else 0
        if not value or value <= 0:
            continue
        any_target = True
        year, month = int(year_month[:4]), int(year_month[5:7])
        days_in_month = calendar.monthrange(year, month)[1]
        total += value * days / days_in_month

    return round(total, 0) if any_target else None


def year_bounds(year: int) -> tuple[date, date]:
    """暦年の [1/1, 翌年1/1) 半開区間。RppWeekly.week_start の範囲フィルタ用。

    月次の _month_bounds と同じ方針（strftimeはSQLite専用なので日付範囲で書く）。
    月跨ぎ週は week_start の年に丸める（月次集計と同じ扱い）。
    """
    return date(year, 1, 1), date(year + 1, 1, 1)


def parse_year(date_str: Optional[str], today: date) -> int:
    """クエリの date パラメータ（'YYYY' / 'YYYY-MM-DD' 等）から対象年を取り出す。"""
    if date_str and len(date_str) >= 4 and date_str[:4].isdigit():
        return int(date_str[:4])
    return today.year


def year_month_range(year: int) -> tuple[str, str]:
    """MonthlyItemSales.year_month（'YYYY-MM' 文字列）の年内範囲。文字列比較で機能する。"""
    return f"{year}-01", f"{year}-12"
