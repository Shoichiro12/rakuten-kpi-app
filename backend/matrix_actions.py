# -*- coding: utf-8 -*-
"""17パターン評価マトリクスの改善アクション動的生成（設計2-E → アクションの接続）。

evaluate_matrix() の結果（◎○△×・focus・low_sample 等）を入力に、
「見出し」＋「店舗全体の打ち手」＋「商品ページの打ち手」を動的に組み立てる。
決め打ちの17行テーブルは持たない。

生成ルール（オーナー承認済み 2026-08-02）:
  1. focus（未達KPIのウォーターフォール順: アクセス→CVR→客単価）が非空なら、
     見出しは未達KPIの列挙、打ち手は各KPIのライブラリを優先順に連結
  2. focusが空のとき: 売上未達なら「売上全体の底上げ」（特定KPIに紐づかない総合打ち手）、
     売上達成なら「維持＋強化」。
     ※売上とKPIはそれぞれ別の目標/YoYと比較して判定されるため、
       「KPIは全部達成なのに売上未達」等の組み合わせは正常に発生する
  3. 母数不足（low_sample）: アクセスの打ち手のみ提示する
     （母数が足りない段階のCVR・客単価は統計的に信用できないため、触らせない）
  4. パターン17（判定不可）: 目標設定・データ取込への案内に固定
  5. 目標もYoYも無く「未達扱い」で評価されたKPI（undetermined）が
     見出しに含まれる場合は、参考である旨の注記を付ける

文言はすべて自社作成（外部資料の言い回しは使わない。publicリポジトリのため）。
商品粒度の4Pパネル（frontend/ActionPanel.tsx）とは役割が別:
こちらは店舗・期間の総合評価に対する要約アクション、あちらは個別商品の詳細タクティクス。
DBアクセスなし・入力が同じなら出力も同じ決定的な生成のみ。
"""

from evaluation import KPI_LABELS, KPI_PRIORITY

# ─── 打ち手ライブラリ（スコープ別・自社文言） ────────────────────────────────
# "shop"    … 複数商品・ジャンル横断で効く店舗全体の打ち手
# "product" … 個別の商品ページに対する打ち手
ACTION_LIBRARY: dict = {
    # アクセス（Promotion系: 広告・検索・キャンペーン）
    "access": {
        "shop": [
            "RPP広告の入札単価と対象商品を見直し、露出が細っている商品に配分し直す",
            "売れ筋商品の商品名・キャッチコピーに、実際に検索されている語を追加する（SEO）",
            "クーポン・ポイント施策をイベント日程（お買い物マラソン等）に合わせて前倒しで仕込む",
        ],
        "product": [
            "検索結果で選ばれるよう、サムネイル1枚目の訴求（価格・特典・用途）を作り直す",
            "商品名の先頭側に検索キーワードを寄せる",
            "この階層の主力商品を対象に、RPPの個別入札を一段強化する",
        ],
    },
    # 転換率（ページ・レビュー・導線系）
    "cvr": {
        "shop": [
            "レビュー返信と購入後フォローのレビュー依頼を仕組み化して、店舗全体の安心材料を増やす",
            "購入導線（検索→ページ→カート）のつまずきを実機で一巡点検する",
            "主要ページで価格・送料・納期の見せ方を統一し、比較で負けない実質価格を明示する",
        ],
        "product": [
            "ページ最上部で価格・送料・届く日がひと目で分かる構成に直す",
            "訴求の順番を「結論→根拠→安心材料」に入れ替え、離脱ポイントを潰す",
            "レビューを増やす施策（フォローメール・特典）を対象商品に集中して当てる",
        ],
    },
    # 客単価（セット・価格・送料ライン系）
    "av": {
        "shop": [
            "セット販売・まとめ買い割引の企画を、売れ筋×消耗品の組み合わせで作る",
            "送料無料ラインを見直し、あと1点の買い足しが起きる価格帯に調整する",
            "上位グレード・大容量版の品揃えを増やして単価の受け皿を作る",
        ],
        "product": [
            "同梱・合わせ買いの提案枠をページ内に置き、1注文あたりの点数を増やす",
            "上位グレード・大容量版への誘導（比較表）をページに追加する",
            "まとめ買い割引（2点以上で割引等）を対象商品に設定する",
        ],
    },
    # 矛盾ケース（売上のみ未達）用: 特定KPIに紐づかない総合打ち手
    "sales_total": {
        "shop": [
            "前年の販促カレンダーと突き合わせ、昨年あって今年やっていない施策（イベント参加・セール）が無いか確認する",
            "検索ボリュームの推移を確認し、市場全体の要因と自店要因を切り分ける",
            "リピート導線（フォローメール・再購入クーポン）を整えて売上の土台を厚くする",
        ],
        "product": [
            "主力商品の在庫切れ・機会損失が無かったか、当月の在庫日数を確認する",
            "売上上位ページの内容が古くなっていないか（価格・写真・レビュー返信）を点検する",
        ],
    },
    # ◎（全達成）用: 維持と横展開
    "maintain": {
        "shop": [
            "成果が出ている施策（広告・企画）の要因を言語化し、他ジャンル・他商品へ横展開する",
            "次の柱になる商品を決めて、広告・ページ改善の投資を先行して当てる",
            "伸びている売れ筋の在庫を厚めに確保し、機会損失を防ぐ",
        ],
        "product": [
            "好調ページの構成（訴求順・画像の並び）を型化して、他商品のページに移植する",
            "レビューへの返信を続けて、ページの信頼材料を積み上げる",
        ],
    },
    # パターン17（判定不可）用: まず判断材料を揃える
    "setup": {
        "shop": [
            "目標設定画面でKGI（売上目標）とKPI目標（アクセス・CVR・客単価）を登録する",
            "商品分析レポート（月次）とRPPレポートを取り込み、判定材料を揃える",
        ],
        "product": [
            "前年比較ができるよう、過去分のCSVも遡って取り込む",
        ],
    },
}

# 複数KPIが未達のときの1KPIあたり提示数（多すぎると読まれないため絞る）
_PER_KPI_WHEN_SINGLE = 3
_PER_KPI_WHEN_MULTI = 2


def _pick(keys: list, scope: str, per_kpi: int) -> list:
    out: list = []
    for k in keys:
        out.extend(ACTION_LIBRARY[k][scope][:per_kpi])
    return out


def build_matrix_actions(result: dict) -> dict:
    """evaluate_matrix() の結果から見出し・打ち手を生成する。

    Args:
        result: evaluate_matrix() の戻り値（pattern_no / rank / focus /
                low_sample / undetermined / metrics を参照する）

    Returns:
        {"headline": str, "shop": [str], "product": [str], "note": str | None}
    """
    pattern_no = result.get("pattern_no")
    focus = list(result.get("focus") or [])
    low_sample = bool(result.get("low_sample"))
    undetermined = [k for k in (result.get("undetermined") or []) if k != "sales"]
    sales = (result.get("metrics") or {}).get("sales") or {}

    # 4. 判定不可（目標未設定・データ不足）
    if pattern_no == 17:
        return {
            "headline": "まず目標とデータを揃えましょう",
            "shop": list(ACTION_LIBRARY["setup"]["shop"]),
            "product": list(ACTION_LIBRARY["setup"]["product"]),
            "note": "評価と改善提案は、目標かつ前年データが揃うと自動で表示されます。",
        }

    # 3. 母数不足: アクセス対策に固定（CVR・客単価の打ち手は出さない）
    if low_sample:
        return {
            "headline": "まずアクセスを増やして、判断材料を集めましょう",
            "shop": list(ACTION_LIBRARY["access"]["shop"]),
            "product": list(ACTION_LIBRARY["access"]["product"]),
            "note": (
                "アクセス母数が少ない間はCVR・客単価の良し悪しを判断できないため、"
                "先にアクセス対策だけを提示しています。"
            ),
        }

    # 1. 未達KPIあり: ラベル列挙の見出し＋該当ライブラリの連結（ウォーターフォール順）
    if focus:
        ordered = [k for k in KPI_PRIORITY if k in focus]
        labels = "・".join(KPI_LABELS[k] for k in ordered)
        per_kpi = _PER_KPI_WHEN_SINGLE if len(ordered) == 1 else _PER_KPI_WHEN_MULTI
        note = None
        if undetermined:
            und_labels = "・".join(KPI_LABELS[k] for k in undetermined if k in KPI_LABELS)
            if und_labels:
                note = f"※{und_labels}は目標・前年データが無いため未達扱いで評価しています（参考）。"
        return {
            "headline": f"{labels}を改善しましょう",
            "shop": _pick(ordered, "shop", per_kpi),
            "product": _pick(ordered, "product", per_kpi),
            "note": note,
        }

    # 2. 未達KPIなし
    if sales.get("achieved") is False:
        # 矛盾ケース: KPIは全達成なのに売上未達 → 特定KPIを名指ししない総合型
        return {
            "headline": "売上全体を底上げしましょう",
            "shop": list(ACTION_LIBRARY["sales_total"]["shop"]),
            "product": list(ACTION_LIBRARY["sales_total"]["product"]),
            "note": (
                "アクセス・CVR・客単価は個別目標を達成しています。"
                "特定KPIではなく、市場要因や販促量など全体の要因を確認してください。"
            ),
        }

    # ◎: 全達成
    return {
        "headline": "好調を維持し、次の柱を育てましょう",
        "shop": list(ACTION_LIBRARY["maintain"]["shop"]),
        "product": list(ACTION_LIBRARY["maintain"]["product"]),
        "note": None,
    }
