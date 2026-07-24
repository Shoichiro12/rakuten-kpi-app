from sqlalchemy import Column, Integer, Float, String, Date, DateTime, Boolean, ForeignKey, UniqueConstraint, func
from database import Base
from tenancy import UserScopedMixin

# 全モデル UserScopedMixin を継承し user_id 列を持つ（マルチテナント対応）。
# クエリへの絞り込み・INSERT時のスタンプは tenancy.py のイベントが自動で行う。
# ユニーク制約は「ユーザーごとに一意」にするため user_id を含める。


class RppWeekly(Base, UserScopedMixin):
    __tablename__ = "rpp_weekly"

    id = Column(Integer, primary_key=True, index=True)
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
    year_month = Column(String, nullable=False)  # YYYY-MM
    target_sales = Column(Float, default=0)    # KGI売上目標
    target_access = Column(Integer, default=0) # アクセス目標
    target_cvr = Column(Float, default=0)      # CVR目標(%)
    target_av = Column(Float, default=0)       # 客単価目標
    expense_rate = Column(Float, default=0.15) # 経費率
    created_at = Column(DateTime, default=func.now())

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
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())


class ProductCategory(Base, UserScopedMixin):
    """カテゴリマスタ（ジャンル階層の正規化）。"""
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    genre_u1 = Column(String)
    genre_u2 = Column(String)
    genre_u3 = Column(String)

    __table_args__ = (
        UniqueConstraint("user_id", "genre_u1", "genre_u2", "genre_u3", name="uq_category"),
    )


class Product(Base, UserScopedMixin):
    """商品マスタ（商品の「今の状態」を管理）。"""
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id"), nullable=True)
    management_no = Column(String, nullable=False)
    product_name = Column(String)
    product_url = Column(String)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    is_active = Column(Boolean, default=True)   # 廃盤・取扱停止フラグ（手動管理・取込で上書きしない）
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "shop_id", "management_no", name="uq_product"),
    )


class ProductCost(Base, UserScopedMixin):
    """原価マスタ（商品別原価率）。"""
    __tablename__ = "product_costs"

    id = Column(Integer, primary_key=True, index=True)
    management_no = Column(String, nullable=False)
    cost_rate = Column(Float, nullable=False)   # 0〜1
    memo = Column(String)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "management_no", name="uq_product_cost"),
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
    plan = Column(String)          # "standard" / "consult"
    status = Column(String)        # trialing / active / past_due / canceled / incomplete 等
    trial_end = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
