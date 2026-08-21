from sqlalchemy import Column, Integer, Float, String, Text, Date, DateTime, Boolean, ForeignKey, UniqueConstraint, func
from database import Base
from tenancy import UserScopedMixin

# 全モデル UserScopedMixin を継承し user_id 列を持つ（マルチテナント対応）。
# クエリへの絞り込み・INSERT時のスタンプは tenancy.py のイベントが自動で行う。
# ユニーク制約は「ユーザーごとに一意」にするため user_id を含める。


class RppWeekly(Base, UserScopedMixin):
    __tablename__ = "rpp_weekly"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    week_start = Column(Date, nullable=False)  # 週開始日（日曜）
    product_url = Column(String, nullable=False)
    management_no = Column(String)
    product_name = Column(String)
    genre = Column(String)
    gross = Column(Float, default=0)       # RPP売上
    cost_of_sales = Column(Float, default=0)  # 売上原価
    ad_cost = Column(Float, default=0)     # 広告費
    cv = Column(Integer, default=0)        # 注文件数
    ct = Column(Integer, default=0)        # クリック数
    ctr = Column(Float, default=0)         # CTR(%)
    cpc = Column(Float, default=0)         # CPC(円)
    created_at = Column(DateTime, default=func.now())


class MonthlyAnalysis(Base, UserScopedMixin):
    __tablename__ = "monthly_analysis"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    year_month = Column(String, nullable=False)  # YYYY-MM
    product_url = Column(String, nullable=False)
    management_no = Column(String)
    product_name = Column(String)
    genre = Column(String)
    sales = Column(Float, default=0)        # 月次売上
    access_count = Column(Integer, default=0)  # アクセス数(UU)
    cv = Column(Integer, default=0)         # 注文件数
    created_at = Column(DateTime, default=func.now())


class Target(Base, UserScopedMixin):
    __tablename__ = "targets"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    year_month = Column(String, nullable=False)  # YYYY-MM
    target_sales = Column(Float, default=0)    # KGI売上目標
    target_access = Column(Integer, default=0) # アクセス目標
    target_cvr = Column(Float, default=0)      # CVR目標(%)
    target_av = Column(Float, default=0)       # 客単価目標
    expense_rate = Column(Float, default=0.15) # 経費率
    # 月次売上予算の手動補正（追加指示書2026-08-02 2章）。
    # null=年間売上予算からの自動按分値を採用 / 値あり=その月はこの値を優先。
    # ⚠️ routers/targets.py の既存upsert（KGIフォーム）では絶対に更新しないこと。
    #    更新は routers/revenue_plan.py の override 専用エンドポイントのみ
    #    （フォーム保存のたびに補正が消える事故を防ぐため）。
    target_sales_budget = Column(Float, nullable=True)
    created_at = Column(DateTime, default=func.now())
    # マスタCRUD規約（2026-08-22）: 削除はソフトデリート。archived_at が非nullの行は
    # 一覧・診断・提案から除外する（「月目標をクリアする」＝この月の行を削除する操作）。
    archived_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "year_month", name="uq_target_user_month"),
    )


class ActionCheck(Base, UserScopedMixin):
    __tablename__ = "action_checks"

    id = Column(Integer, primary_key=True, index=True)
    product_url = Column(String, nullable=False)
    week_key = Column(String, nullable=False)   # YYYY-MM-DD (weekly) or YYYY-MM (monthly)
    action_key = Column(String, nullable=False)
    checked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "product_url", "week_key", "action_key", name="uq_action_check"),
    )


class RppActionCheck(Base, UserScopedMixin):
    """RPP診断パネルのアクションチェック状態。

    既存 ActionCheck は product_url ベースだが、RPP（RppSales）には product_url が
    無いケースがあるため management_no（item_code）ベースの専用テーブルにする。
    period_key は既存 ActionCheck.week_key と同じ規約
    （weekly = YYYY-MM-DD（date_from） / monthly = YYYY-MM）。
    """
    __tablename__ = "rpp_action_checks"

    id = Column(Integer, primary_key=True, index=True)
    management_no = Column(String, nullable=False)
    period_key = Column(String, nullable=False)  # YYYY-MM-DD (weekly) or YYYY-MM (monthly)
    action_key = Column(String, nullable=False)
    checked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "management_no", "period_key", "action_key", name="uq_rpp_action_check"),
    )


class InventoryStatus(Base, UserScopedMixin):
    __tablename__ = "inventory_status"

    id = Column(Integer, primary_key=True, index=True)
    product_url = Column(String, nullable=False)
    has_inventory = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "product_url", name="uq_inventory_user_product"),
    )


class MonthlyItemSales(Base, UserScopedMixin):
    __tablename__ = "monthly_item_sales"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    year_month = Column(String, nullable=False)   # YYYY-MM (from file header)
    management_no = Column(String, nullable=False)
    product_url = Column(String)
    product_name = Column(String)
    genre_u1 = Column(String)   # ジャンル大分類
    genre_u2 = Column(String)   # ジャンル中分類
    genre_u3 = Column(String)   # ジャンル小分類
    price = Column(Float, default=0)
    stock_count = Column(Integer, default=0)
    access_uu = Column(Integer, default=0)       # アクセス人数(UU)
    access_count = Column(Integer, default=0)    # アクセス件数
    cvr = Column(Float, default=0)               # 転換率(%)
    cv = Column(Integer, default=0)              # 売上件数
    sales = Column(Float, default=0)             # 売上金額
    sales_qty = Column(Integer, default=0)       # 売上点数
    cart_count = Column(Integer, default=0)
    cart_rate = Column(Float, default=0)
    avg_price = Column(Float, default=0)
    ad_sales = Column(Float, default=0)
    ad_cost = Column(Float, default=0)
    roas = Column(Float, default=0)
    cpo = Column(Float, default=0)
    review_count = Column(Integer, default=0)
    review_score = Column(Float, default=0)
    fav_count = Column(Integer, default=0)
    zero_stock_days = Column(Integer, default=0)
    subscription_cv = Column(Integer, default=0)
    subscription_sales = Column(Float, default=0)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "management_no", "year_month", name="uq_monthly_item"),
    )


class RppSales(Base, UserScopedMixin):
    __tablename__ = "rpp_sales"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    period_type = Column(String, nullable=False)  # 'weekly' or 'monthly'
    year_month = Column(String, nullable=False)   # YYYY-MM
    date_from = Column(String, nullable=False)    # YYYY-MM-DD
    date_to = Column(String, nullable=False)      # YYYY-MM-DD
    item_code = Column(String)                    # 商品コード/管理番号
    item_url = Column(String)
    product_name = Column(String)
    bid_price = Column(Integer, default=0)
    ct = Column(Integer, default=0)
    ad_cost = Column(Integer, default=0)
    cpc_actual = Column(Float, default=0)
    ctr = Column(Float, default=0)
    gross_720 = Column(Float, default=0)
    cv_720 = Column(Integer, default=0)
    cvr_720 = Column(Float, default=0)
    roas_720 = Column(Float, default=0)
    cpo_720 = Column(Float, default=0)
    gross_12 = Column(Float, default=0)
    cv_12 = Column(Integer, default=0)
    cvr_12 = Column(Float, default=0)
    roas_12 = Column(Float, default=0)
    cpo_12 = Column(Float, default=0)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "period_type", "date_from", "date_to", "item_code", name="uq_rpp_sales"),
    )


class ActionLog(Base, UserScopedMixin):
    """「今日やるべきこと」の実施記録（Phase 1）＋ 学習ループの土台（Phase 2）。

    docs/VISION.md の Phase 2「提案 → 実施結果 → 売上変化 → 学習」を回すには、
    提案を実施した時点のKPIを保存しておく必要がある。後から遡って復元できないため、
    実施操作のたびにスナップショットを取る。Phase 2 ではこの行と後続期間の実績を
    突き合わせて、提案ごとの効果を定量化する。
    """

    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, index=True)
    action_key = Column(String, nullable=False)   # recommendations.py のルールキー
    period_key = Column(String, nullable=False)   # YYYY-MM-DD(週次) / YYYY-MM(月次)
    period_type = Column(String, nullable=False)  # 'weekly' | 'monthly'
    status = Column(String, nullable=False, default="done")  # 'done' | 'snoozed'
    title = Column(String)                        # 提案文のスナップショット（文言変更に耐える）

    # 実施時点のKPIスナップショット（Phase 2 の効果測定用）
    snapshot_sales = Column(Float)
    snapshot_access = Column(Integer)
    snapshot_cvr = Column(Float)
    snapshot_av = Column(Float)

    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "action_key", "period_key", name="uq_action_log"),
    )


# ─── マスタテーブル（参照レイヤー・商品の「今の状態」管理） ────────────────────
# 既存の巨大なトランザクションテーブル（rpp_weekly / monthly_item_sales / rpp_sales 等）は
# 取込CSVのスナップショットとしてそのまま残し、以下4テーブルを参照レイヤーとして追加する。
#
# 【マルチテナント方針】
# tenancy.py の規約どおり、新規モデルも必ず UserScopedMixin を継承して user_id を持たせる。
# 継承しないと全ユーザー共有（テナント間データ混線）になる。ユニーク制約も user_id 込みにし、
# migrations._USER_SCOPED_TABLES へ登録して本番Postgresでの制約張替え・RLS強制の対象にする。
# shop_id は単一店舗前提のいまは「現ユーザーのデフォルト店舗」をアプリ側で解決して入れる
# （固定の 1 は使わない。ユーザーごとに shops.id が異なるため）。


class Shop(Base, UserScopedMixin):
    """店舗マスタ。いまは単一店舗のプレースホルダー、将来のマルチモール対応の受け皿。"""
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    mall_type = Column(String, default="rakuten")   # rakuten / yahoo / amazon...（将来用、今は未使用）
    default_cost_rate = Column(Float, default=0.6)
    default_expense_rate = Column(Float, default=0.15)
    restock_lead_days = Column(Integer, default=14)  # 在庫がこの日数分を切ったら発注アラート
    # ── 売上予算プラン（設計3-G改め v2 / 第4段階）────────────────────────
    # annual_sales_budget: 年間売上予算（円）。null=未設定（売上予算プラン機能はオフ表示）。
    #   月次への按分値は保存せず、revenue_plan.py が季節指数から都度算出する
    #   （保存すると指数更新・予算変更のたびに12行の同期が必要になるため）。
    # budget_year_start_month: 予算年度の起点月（1〜12、既定1=暦年）。
    annual_sales_budget = Column(Float, nullable=True)
    budget_year_start_month = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())


class ProductCategory(Base, UserScopedMixin):
    """カテゴリマスタ（ジャンル階層の正規化）。"""
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    genre_u1 = Column(String)
    genre_u2 = Column(String)
    genre_u3 = Column(String)
    # マスタCRUD規約（2026-08-22）: 削除はソフトデリート。archived_at が非nullのカテゴリは
    # 一覧・商品マスタのカテゴリ選択肢から除外する。
    archived_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "genre_u1", "genre_u2", "genre_u3", name="uq_category"),
    )


class Product(Base, UserScopedMixin):
    """商品マスタ（商品の「今の状態」を管理）。"""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    management_no = Column(String, nullable=False)
    product_name = Column(String)
    product_url = Column(String)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    is_active = Column(Boolean, default=True)   # 廃盤・取扱停止フラグ（手動管理・取込で上書きしない）
    # ── アクション提案ロジックのゲート用状態（設計ドキュメント2026-08-01 2-A）──
    # launch_month: 発売月 YYYY-MM。null なら実績データの初出月から自動推定する。
    # phase_override: 'new' | 'established' | null(自動判定=発売から3ヶ月は新商品)。
    #                 担当者が様子見期間を延長・短縮するための上書き（3-A）。
    # page_ready: ページ品質ゲート。null=未回答（ゲートは通す）/ False=未完成
    #             （広告強化を止め「まずページ完成」を提案）/ True=完成。
    # investment_intent: 意図確認ゲート（2-A ゲート4）の回答保存。True=新商品への
    #                    意図的出稿として許容中（診断は変えず、見せ方の注記だけ変える）。
    launch_month = Column(String, nullable=True)
    phase_override = Column(String, nullable=True)
    page_ready = Column(Boolean, nullable=True)
    investment_intent = Column(Boolean, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    # マスタCRUD規約（2026-08-22）: ユーザー概念は「販売中／廃盤」の2値のみ（is_active）。
    # 「アーカイブ」は表に出さない内部実装で、UI上の「削除」操作がこの列を立てる。
    # archived_at が非nullの商品は一覧・診断・提案・ドリルダウンの母集団から除外する
    # （is_active=False の廃盤除外と同じ経路に載せる。実績集計・過去データは保持）。
    archived_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "shop_id", "management_no", name="uq_product"),
    )


class ProductCost(Base, UserScopedMixin):
    """原価マスタ（商品別原価率）。"""
    __tablename__ = "product_costs"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    management_no = Column(String, nullable=False)
    cost_rate = Column(Float, nullable=False)   # 0〜1
    memo = Column(String)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "management_no", name="uq_product_cost"),
    )


class ItemTarget(Base, UserScopedMixin):
    """アイテム(商品)別の目標（設計ドキュメント2026-08-01 3-B''）。

    利用者が手入力するのは target_sales（目標売上）のみ。目標CVR・目標客単価は
    EC実務の確定公式 MIN(現状値, 前年値) で自動算出し（保守的採用。売上成長は
    アクセス増加だけで実現する設計思想）、必要アクセス数を逆算する:
        目標注文件数 = 目標売上 ÷ 目標客単価
        必要アクセス数 = 目標注文件数 ÷ 目標CVR
    CVR・客単価は site_uu 軸（商品分析レポートのページ全体CVR・客単価）を使う。

    calc_basis:
      'rule'         … 確定公式で算出（実績データあり）
      'estimated'    … 実績が無い新商品等。同ジャンル・自店平均からの参考値
                       （estimated_approved=True になるまで診断・逆算には使わない）
      'insufficient' … 推定材料も無く算出不能（データ取込後に自動再計算される）
    算出値は「目標保存時」と「商品分析CSV取込時」に再計算する（target_calc.py）。
    """
    __tablename__ = "item_targets"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    management_no = Column(String, nullable=False)
    year_month = Column(String, nullable=False)      # YYYY-MM
    target_sales = Column(Float, nullable=False)     # 利用者が唯一手入力する値
    target_cvr = Column(Float, nullable=True)        # 自動算出(%)
    target_av = Column(Float, nullable=True)         # 自動算出(円)
    required_access = Column(Float, nullable=True)   # 自動算出(UU)
    calc_basis = Column(String, nullable=False, default="insufficient")
    basis_detail = Column(String)                    # 採用値の内訳・推定元の説明
    estimated_approved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "management_no", "year_month", name="uq_item_target"),
    )


class GenreBenchmark(Base, UserScopedMixin):
    """ジャンル別ベンチマークの手入力値（設計ドキュメント2026-08-01 3-B / 3-B'）。

    RMS画面に表示される「同ジャンル・同規模店舗のベンチマーク値」は取込CSVに
    含まれないため、利用者が見た値を任意で入力して保存する（オーナー確認済みの方針）。
    ベンチマーク解決の優先順位（benchmarks.py）:
      ①この手入力値 → ②自店ジャンル集計 → ③汎用デフォルト（7% / 3〜5% / 2%）

    metric は指標の種類:
      'page_cvr' … ページ全体CVR（site_uu軸、全流入経路）
      'ad_cvr'   … RPP広告経由CVR（rpp_click軸）
      'ctr'      … RPP広告CTR
    genre_u2 / genre_u3 は null 可（大分類だけの入力も許す。詳細な階層が優先される）。
    """
    __tablename__ = "genre_benchmarks"

    id = Column(Integer, primary_key=True, index=True)
    # サンプルデータ由来の行か（2026-08-20）。サンプル生成が付け、サンプル削除がこの行だけを消す。
    # 実データは False/NULL。削除系の判定は必ず is_(True) で行う（NULL を巻き込まない）
    is_sample = Column(Boolean, default=False)
    genre_u1 = Column(String, nullable=False)
    genre_u2 = Column(String, nullable=True)
    genre_u3 = Column(String, nullable=True)
    metric = Column(String, nullable=False)   # 'page_cvr' | 'ad_cvr' | 'ctr'
    value = Column(Float, nullable=False)     # %値（例: 7.52）
    memo = Column(String)                     # 出典メモ（例: RMS 2026-07 表示値）
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "genre_u1", "genre_u2", "genre_u3", "metric",
                         name="uq_genre_benchmark"),
    )


class Subscription(Base, UserScopedMixin):
    """Stripe サブスクリプションの契約状態（ユーザー単位・1件）。

    課金状態を保持するだけで、プラン別の機能ロックは行わない（別途）。
    Webhook（customer.subscription.*）で status を同期する。テストモード運用。
    ユニーク制約は張らず、upsert（ユーザーの1件を取得→無ければ作成）で1件を担保する。
    """
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    stripe_customer_id = Column(String, index=True)
    stripe_subscription_id = Column(String, index=True)
    plan = Column(String)          # 常に "standard"（単一プラン化。"consult" は旧契約のみ）
    status = Column(String)        # trialing / active / past_due / canceled / incomplete 等
    trial_end = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ConsultingInquiry(Base, UserScopedMixin):
    """ECコンサルの問い合わせ（アプリ課金には乗せず個別契約にするため）。

    ログイン中のユーザーからの問い合わせとして記録が残る。一次通知チャネルは
    NOTIFY_EMAIL 宛のメール（notifications.send_inquiry_notification）で、
    閲覧用の管理画面は用意していない（過去分の確認はDBを直接見る運用）。
    """
    __tablename__ = "consulting_inquiries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    scale_hint = Column(String)              # 自由記述（月商目安・店舗数など）
    contact_email = Column(String, nullable=False)
    contact_phone = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String, default="new")   # new / contacted / closed（今は new 固定・将来の管理用）
    created_at = Column(DateTime, default=func.now())


class Feedback(Base, UserScopedMixin):
    """アプリ内の不具合報告・要望（フィードバック窓口）。

    利用者の声を拾うための窓口。一次通知チャネルは NOTIFY_EMAIL 宛のメール
    （notifications.send_feedback_notification）。閲覧用の管理画面は作らない
    （件数が増えたら検討。過去分はDBを直接見る運用）。
    user_email はフロントから送らせず、JWT（AuthUser.email）から入れる。
    """
    __tablename__ = "feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False, default="bug")  # bug / request / other
    message = Column(Text, nullable=False)
    page = Column(String)                    # 送信時に開いていた画面のパス（例: /gap）
    user_email = Column(String)              # JWT由来（返信用）
    user_agent = Column(String)              # ブラウザ情報（不具合の再現用）
    status = Column(String, default="new")   # new / triaged / done（今は new 固定・将来の管理用）
    created_at = Column(DateTime, default=func.now())
