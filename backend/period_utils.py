# -*- coding: utf-8 -*-
"""期間（週次・月次・年次）の共通ヘルパー（UIバックログ2026-08-03 区切りB）。

年次は【暦年固定】（1〜12月）。予算年度起点（shops.budget_year_start_month）は
年間目標プランナー側の役割のままで、年次表示には持ち込まない（オーナー承認済み）。

年次のスコープは表示系のみ（dashboard / gap / products / export）。
診断・アラート・提案系は月次のまま（母数ゲート等が月次前提のため）。
"""
from datetime import date
from typing import Optional


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
