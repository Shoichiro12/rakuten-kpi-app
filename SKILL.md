# Skill: rakuten-gap-analysis

## 目的
楽天EC運用において、GAP分析画面をロジックツリー＋4Pアクション形式で実装するための
設計パターンと実装手順を再利用可能な形で保存する。

出典: NATIONS_DAY3（データ分析に基づいたKPI設定とアクションの優先順位付け）

---

## 1. ロジックツリーのデータ構造

### KGI → KPI 3指標の階層定義

```
KGI: 売上目標（RPP売上 Gross）
├── KPI: アクセス（UU）     ← monthly_analysis.access_count から集計
├── KPI: 転換率（CVR）      ← rpp_weekly: cv / ct × 100
└── KPI: 客単価（Av）       ← rpp_weekly: gross / cv
```

### 各ノードの表示項目

| フィールド | 型 | 説明 |
|---|---|---|
| label | string | 指標名（例: "売上目標"） |
| key | string | 'kgi' / 'access' / 'cvr' / 'av' |
| target | float | 目標値（Targetテーブルから） |
| actual | float | 実績値（rpp_weekly集計） |
| gap | float | actual - target（負 = 未達） |
| gap_rate | float | (gap / target) × 100 (%) |
| achieve_rate | float | (actual / target) × 100 (%) |
| unit | string | 'currency' / 'number' / 'percent' |

### 差分ハイライトの閾値（SVGノード色）

```python
if achieve_rate >= 100:  # 緑 (#16a34a / #f0fdf4)
elif achieve_rate >= 80: # 黄 (#d97706 / #fffbeb)
else:                    # 赤 (#dc2626 / #fef2f2)
```

### バックエンドエンドポイント

```python
# GET /api/gap/kpi-tree?period=weekly&date=YYYY-MM-DD
# Returns: { has_target, kgi, access, cvr, av }  — 各ノードは上表の全フィールドを含む

def get_kpi_tree(period, date_str, db):
    # 1. rpp_weekly → gross / cv / ct 集計
    # 2. monthly_analysis → access_count 集計（同年月）
    # 3. Target テーブルから目標値取得
    # 4. 各ノードの gap / gap_rate / achieve_rate を計算して返す
```

---

## 2. GAP分析3ステップのUI実装パターン

### ステッパーUIのコンポーネント構成

```
StepIndicator（水平ステッパー）
  Props: currentStep: 1|2|3, onStepClick: (step) => void
  - done（完了）= 緑丸 + チェックアイコン
  - active（現在）= 黒丸 + ring
  - pending（未到達）= グレー丸、クリック不可
  - ステップ間はラインで接続（done 時に緑でアニメーション塗り）
```

### ショップ→ジャンル→商品のドリルダウン状態管理

```typescript
// pages/GapAnalysis.tsx の状態
const [step, setStep] = useState<1 | 2 | 3>(1)
const [selectedKPI, setSelectedKPI] = useState<'access'|'cvr'|'av'|null>(null)
const [selectedGenre, setSelectedGenre] = useState<string|null>(null)
const [selectedProduct, setSelectedProduct] = useState<ProductItem|null>(null)

// 遷移ルール
// KPIノードクリック → selectedKPI をセット → step=2
// ジャンルカードクリック → selectedGenre → step=3 → 商品ロード
// 商品行クリック → selectedProduct → ActionPanel表示（step変更なし）
// StepIndicator クリック → 戻りナビゲーション（下位選択をリセット）
```

### コンポーネントの表示条件

| コンポーネント | 表示条件 |
|---|---|
| LogicTree | 常時表示 |
| StepIndicator | 常時表示 |
| GenreCards | `step >= 2 || selectedKPI != null` |
| 商品テーブル | `step === 3 && selectedGenre != null` |
| ActionPanel | `selectedProduct != null && shopData != null` |

---

## 3. 4P改善アクションの判定ロジック

### 課題判定 (ActionPanel 内)

```typescript
function detectIssues(product, shopKpis, hasInventory): IssueType[] {
  if (!hasInventory) return ['inventory']   // 在庫なし優先
  const issues = []
  if (product.cvr < shopKpis.cvr * 0.85) issues.push('cvr')
  if (product.av  < shopKpis.av  * 0.85) issues.push('av')
  // 上記なし or CTRが低い → アクセス課題とみなす
  if (issues.length === 0 || product.ctr < shopKpis.ctr * 0.75) issues.push('access')
  return issues
}
```

### アクセス課題 → Promotion アクション

| action_key | テキスト |
|---|---|
| rpp_bid | RPP広告のCPC・入札単価を見直す |
| seo_keyword | 商品名にキーワードを追加（SEO対策） |
| thumbnail | CTRが低い場合：サムネイル・バナーを改善 |
| coupon | キャンペーン・クーポンでアクセス増加 |
| rmp | 楽天市場内の広告枠（RMP）を活用 |

### CVR課題 → Price / Product / Place アクション

| action_key | カテゴリ | テキスト |
|---|---|---|
| price_review | Price | 販売価格・クーポンを見直す |
| point_rate | Price | ポイント還元率を上げる |
| lp_review | Product | 商品ページLP・レビューを改善する |
| image_improve | Product | 商品説明・画像を充実させる |
| shipping | Place | 出荷リードタイム・送料を確認 |
| delivery_info | Place | 在庫表示・配送日時を見直す |

### 客単価課題 → Product / Price アクション

| action_key | カテゴリ | テキスト |
|---|---|---|
| bundle | Product | セット販売・まとめ買いプランを作成 |
| cross_sell | Product | 関連商品のクロスセルを設定 |
| bundle_price | Price | バンドル価格を見直す |
| free_shipping | Price | 送料無料ラインを調整 |

### 在庫なし → 仕入れ調整アクション（最優先）

| action_key | テキスト |
|---|---|
| restock | 入荷スケジュールを見直す |
| qty_adjust | 仕入れ数量を調整する |
| alt_product | 代替商品への切り替えを検討 |
| pause_ads | 在庫切れ商品の広告を一時停止 |

### チェックボックス状態のDB保存スキーマ

```python
class ActionCheck(Base):
    __tablename__ = "action_checks"
    id = Column(Integer, primary_key=True)
    product_url = Column(String, nullable=False)
    week_key = Column(String, nullable=False)   # YYYY-MM-DD or YYYY-MM
    action_key = Column(String, nullable=False)
    checked = Column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("product_url","week_key","action_key"),)

class InventoryStatus(Base):
    __tablename__ = "inventory_status"
    id = Column(Integer, primary_key=True)
    product_url = Column(String, unique=True, nullable=False)
    has_inventory = Column(Boolean, default=True)
```

APIエンドポイント:
```
GET  /api/actions?product_url=X&week_key=Y       → {action_key: bool, ...}
POST /api/actions/toggle                          → {action_key, checked}
GET  /api/actions/inventory?product_url=X         → {has_inventory}
POST /api/actions/inventory/toggle                → {has_inventory}
```

---

## 4. 実装ファイル一覧

| ファイル | 役割 |
|---|---|
| `backend/models.py` | ActionCheck, InventoryStatus モデル追加 |
| `backend/routers/gap_analysis.py` | `/api/gap/kpi-tree` エンドポイント追加 |
| `backend/routers/actions.py` | アクション・在庫CRUD |
| `frontend/src/components/gap/LogicTree.tsx` | SVGツリー（viewBox 960×295） |
| `frontend/src/components/gap/StepIndicator.tsx` | 3ステップ水平インジケーター |
| `frontend/src/components/gap/GenreCards.tsx` | 横スクロールジャンルカード |
| `frontend/src/components/gap/ActionPanel.tsx` | 右サイドパネル・4Pアクション |
| `frontend/src/pages/GapAnalysis.tsx` | メインページ（全面書き直し） |

---

## 5. テストケース

### TC1: kpi-tree エンドポイント
```bash
curl "http://localhost:8000/api/gap/kpi-tree?period=weekly"
# 期待: has_target=true, kgi.achieve_rate が達成率%, gap_rate が差分%
```

### TC2: アクション toggle の冪等性
```bash
# 同じ action_key を2回 POST → checked が True→False→True と切り替わること
```

### TC3: 在庫なし時のアクション判定
```python
# hasInventory=False の場合、detectIssues() が ['inventory'] のみ返すこと
# Promotionアクションは表示されないこと
```

### TC4: ジャンルカードの「最大GAP」ハイライト
```
# 前期比で最も悪化したジャンルに「最大GAP」バッジが付くこと
# selectedGenre がそのジャンルと一致するとき、青枠になること
```
