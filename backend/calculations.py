from typing import Optional


def safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator == 0:
        return default
    return numerator / denominator


def calc_kpis(
    gross: float,
    cost_of_sales: float,
    ad_cost: float,
    cv: int,
    ct: int,
    expense_rate: float = 0.15,
    ctr: float = 0.0,
) -> dict:
    gp = gross - cost_of_sales
    gpr = safe_div(gp, gross) * 100
    av = safe_div(gross, cv)
    cvr = safe_div(cv, ct) * 100
    roas = safe_div(gross, ad_cost) * 100
    cpo = safe_div(ad_cost, cv)
    limit_cpo = safe_div(gp, cv)
    cpc = safe_div(ad_cost, ct)
    steady_cost = gross * expense_rate
    rev = gp - (ad_cost + steady_cost)
    roi = safe_div(gp, ad_cost) * 100

    return {
        "gross": gross,
        "cost_of_sales": cost_of_sales,
        "ad_cost": ad_cost,
        "cv": cv,
        "ct": ct,
        "gp": gp,
        "gpr": round(gpr, 2),
        "av": round(av, 0),
        "cvr": round(cvr, 2),
        "ctr": round(ctr, 2),
        "roas": round(roas, 1),
        "cpo": round(cpo, 0),
        "limit_cpo": round(limit_cpo, 0),
        "cpc": round(cpc, 0),
        "steady_cost": round(steady_cost, 0),
        "rev": round(rev, 0),
        "roi": round(roi, 1),
    }


def calc_change_rate(current: float, previous: float) -> Optional[float]:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)
