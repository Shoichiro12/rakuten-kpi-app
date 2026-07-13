from sqlalchemy import Column, Integer, Float, String, Date, DateTime, Boolean, UniqueConstraint, func
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
