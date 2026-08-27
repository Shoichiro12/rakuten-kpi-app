# 実装計画書: マスタ削除の一括化と未分類フロー

**作成**: 2026-08-28（planner）。対象コミット: `f61e565`（`git log --oneline -5` の先頭。ブランチ
`week-start-sunday-patch-3be455` のworktree上で作業。マージ先は `main`）。

## 0. 事前確認（申し送りルール7・重複調査）

- `gh pr list --state open`: オープンPRは #60（フォームid/name属性の指摘。今回と無関係）のみ
- `git log` の直近履歴・全文検索（`一括削除`/`未分類`/`bulk delete`/`uncategorized`）: 今回スコープと
  重複する未完了の作業なし
- `docs/office_map.html` QUESTS（現状）: 「lp/README.mdの陳腐化」「管理者閲覧機能（区切り3・6）」
  「四万SKU実測」「他国の目利き」の4件。いずれも本テーマと無関係
- `docs/gunrei_kouho.md`（巡回候補台帳）: 関連候補なし
- CSVインジェクション対策（`csv_safe_cell()`）は**既に実装済み**（`backend/csv_utils.py` が実在し、
  `masters.py` の `export_categories` / `export_master_products`、`item_targets.py` の
  `export_item_targets`、`export.py` が使用済み）。CLAUDE.md申し送り台帳の当該行は「次回の夜勤が実装する」
  という記述のまま更新が追いついていないだけで、**コードは既に対応済み**（`docs/office_map.html` の
  御庭番の口上でも「二十七日に無害化を施し塞ぎ申した」と確認できる）。今回の計画は完了済みのこの土台に
  乗って書く

**結論: 重複なし。着手して問題ない。**

## 1. 前提・スコープ確認

### 1.1 対象と対象外

- 対象: `product_categories`（カテゴリマスタ）・`products`（商品マスタ）の一覧に複数選択チェックボックス
  ＋一括削除。カテゴリ削除時の未分類化フローの可視化（非強制アラート）
- 対象外（今回やらないこと）:
  - `targets`（目標マスタ）・`item_targets`（アイテム別目標）・`genre_benchmarks` への一括削除の展開
    （オーナー評定は「カテゴリ・商品マスタ」の2つに限定。要望が出たら別チケット）
  - カテゴリの「復元」UI（既存どおり無し。同名で作り直せば `create_category`/`import_categories` が
    自動復元する既存挙動を維持するだけ）
  - GAP分析・ダッシュボード側のロジック変更（§2の調査結果により、原則不要と判明。詳細は§2）
  - EditableGrid（`useEditableGrid.ts`）への統合（今回はチェックボックス＋一括削除ボタンの追加のみ。
    グリッド全体をこの機能のために作り直さない）

### 1.2 守る開発規約

- `UserScopedMixin` 経由の自動絞り込みに乗る（新しいガードを書かない。§4で前提を検証済み）
- マスタCRUD規約（CLAUDE.md）: ソフトデリート・CSVは追加更新のみで削除しない・全削除系は
  `ConfirmDeleteModal` を使う
- CSV自由入力列は `csv_safe_cell()` を通す（既存規約どおり）
- ルーターの列挙値は `Literal[...]`（`Query(..., enum=[...])` は使わない）
- 全エンドポイントは常にJSONを返す

## 2. 核心の調査: 「未分類」が指す2つのデータ軸

事前調査の仮説どおり、**`Product.category_id`（FK）と、GAP分析・診断が使う「ジャンル」は完全に別のデータ
経路**であることを、対象コードの全文検索で確認した。

### 2.1 `Product.category_id` を参照している箇所（全件）

`grep -rn "category_id|ProductCategory" backend --include=*.py` の結果、参照元は以下のみ:

| ファイル | 用途 |
|---|---|
| `backend/masters.py` | `get_or_create_category` / `upsert_product` / `suggest_category`（提案）/ `suggest_cost_rate`（同カテゴリ平均）/ `get_review_queue`（提案キュー）/ `inactive_management_nos`（廃盤・削除判定。category_idは無関係） |
| `backend/routers/masters.py` | 商品マスタ一覧の `category_id` 絞り込み・編集・削除連動（`delete_category`）・CSV export/import |
| `backend/routers/item_targets.py` | `_resolve_genre()`。**MonthlyItemSales の実績ジャンルが無いときだけ**のフォールバック表示（§2.3） |
| `backend/routers/import_csv.py` | 商品分析CSV取込時に `get_or_create_category` でカテゴリを紐付け（RPP取込は紐付けない） |
| `backend/sample_data.py` / `backend/scripts/backfill_products.py` | サンプル生成・バックフィルの補助 |

### 2.2 GAP分析・ダッシュボード・診断は `Product`/`ProductCategory` を一切参照しない

- `grep -n "Product\b" backend/routers/gap_analysis.py` → **0件**。`ProductCategory` も0件
- `backend/diagnosis.py`・`backend/routers/evaluation.py` も `category_id`/`ProductCategory` の参照 **0件**
- GAP分析の「未分類」補完（`backend/routers/gap_analysis.py` 65〜120行付近）は
  `RppWeekly.genre`（CSV取込時のスナップショット文字列。`"靴/靴ケア用品/靴ひも"` のような `/` 区切り）
  と `MonthlyItemSales.genre_u1/u2/u3`（商品分析CSVの列そのもの）だけを見ており、欠損は元から
  `"未分類"` で補完している（`_extract_genre_key()` / `_genre_key_for_monthly()`）。この挙動は
  **カテゴリマスタの有無・削除と一切無関係に、CSV取込のたびに独立して決まる**

### 2.3 唯一のFK参照は「実績が無い商品の表示フォールバック」1箇所だけ

`item_targets.py` の `_resolve_genre()` が `Product.category_id` を見るのは、**その商品の
`MonthlyItemSales`（月次商品分析の実績）が1件も無いとき**だけ（`latest is None` または
`genre_u1/u2/u3` が全部空のとき）。実績があるアイテムは常に実績側のジャンルが優先されるため、
カテゴリを削除しても表示は変わらない。影響を受けるのは「実績がまだ無い新商品で、カテゴリだけ手動で
割り当てていたケース」に限られ、削除後は `genre_u1/u2/u3` が全部 `null` になり、アイテム別目標一覧の
絞り込みドロップダウンにその商品のジャンルが出なくなる（除外はされない。一覧・目標入力自体はできる）。

### 2.4 結論（仕様4の実装スコープ確定）

**GAP分析・ダッシュボード側のバックエンド・フロントエンドは変更不要。** 理由:

1. KGIツリー・ジャンル別GAP・評価マトリクス・診断・アクション提案のいずれも `Product.category_id` を
   経由しない。集計対象は `RppWeekly`/`MonthlyItemSales` の生ジャンル文字列で、これらは元から
   「欠損=未分類」で扱われており、**カテゴリマスタを1件も作らなくても、削除しても、売上合計・件数は
   1円も変わらない**（構造的に自明。実装ではなく確認で満たされる要件）
2. 唯一手を入れる価値があるのは `item_targets.py` の商品マスタ経由フォールバック（§2.3）だが、
   これは「除外」ではなく「表示ジャンルが空になるだけ」で、仕様4が禁止する「未分類の商品を集計から
   除外する」動作には該当しない。積極的に「未分類」ラベルを出す改修は行わず、**現状のnull許容のまま
   据え置く**（商品マスタ側の一覧・提案キューは元々category_id=NULLの商品を「未分類」として扱う設計が
   既にあるため、そちらで十分カバーされる）
3. 商品マスタ側（`masters.py`）は元々 `category_id IS NULL` の商品を除外しない設計になっている
   （一覧APIはフィルタ未指定なら全件、提案キューは `category_id is None` の商品を明示的に拾って
   「たぶんこれ」を提案する）。**ここは現状のままで仕様4を満たしている**

**したがって仕様4の実装対応は「商品マスタ一覧・アイテム別目標一覧のUIに、category_id=NULLの商品を
明示的に『未分類』ラベルで表示する」というフロントエンドの表示強化のみで完結する**（バックエンドAPI
契約は変更しない。既存の `category_id: null` / `genre_u1: null` をフロント側で「未分類」という文字列に
変換して出すだけ）。GAP分析・診断ロジックへの変更は無い。

## 3. 既存実装とのマッピング（実装済み/部分実装/未実装）

| 項目 | 状態 | 詳細 |
|---|---|---|
| カテゴリ単件削除＋未分類化 | **実装済み** | `masters.py:361-377` `delete_category()`。`detached_products` を返す |
| 商品単件削除（ソフトデリート） | **実装済み** | `masters.py:138-155` `delete_master_product()` |
| `ConfirmDeleteModal`（件数つき確認ダイアログの土台） | **実装済み** | `components/ConfirmDeleteModal.tsx`。`message` propに任意の文言（件数含む）を渡せる。改修不要、そのまま再利用 |
| カテゴリ一覧の複数選択チェックボックス | **未実装** | `CategoryMaster.tsx` は行ごとの編集/削除ボタンのみ |
| 商品一覧の複数選択チェックボックス | **未実装** | `MasterSettings.tsx` の商品マスタテーブルも同様 |
| 一括削除API（カテゴリ・商品） | **未実装** | 単件DELETEのみ |
| 未分類件数の非強制アラート＋再設定導線 | **未実装** | 商品マスタ一覧に「未分類」フィルタ自体は無い（ジャンル絞り込みドロップダウンで代用は可能だが、能動的なアラート表示は無い） |
| CSVインジェクション対策 | **実装済み（対象外の変更なし）** | `csv_safe_cell()` 適用済み。「未分類」は固定文字列なので新たな対策不要 |

## 4. データモデルへの影響

**新規テーブルは無い。** `products` / `product_categories` とも既存の `UserScopedMixin` 継承・
`archived_at` ソフトデリート列を持つ（`models.py:271-303`）。一括削除は「既存の単件削除ロジックを
複数件ループで呼ぶ」だけで、スキーマ変更は不要。

`migrations._USER_SCOPED_TABLES` への追加・`sample_data.py` の更新も不要（テーブル自体は変更しない。
既に両テーブルとも `is_sample` 列を持ち、サンプル削除の対象に入っている）。

## 5. RLS/tenancy の前提確認

`backend/tenancy.py` の `do_orm_execute` イベントは **`Query.update()` / `Query.delete()` にも適用される**
（7〜9行目のコメントで明記、`delete_category()` の `db.query(Product).filter(...).update(...)` が
既にこの経路で自テナントに絞られている実績あり）。一括削除も同じ `db.query(...).filter(Model.id.in_(ids))`
の形にすれば、**新しいガードを書かなくても自動的に自テナント範囲に絞られる**。この前提は正しいと確認済み。

注意点: `.in_(ids)` で渡すIDが他テナントの行を指していても、`do_orm_execute` がクエリ自体に
`user_id = 現在ユーザー` を注入するため、該当しない行は静かに0件ヒットになる（403ではなく「対象0件」で
返る）。単件DELETEも同じ挙動（404を返す設計）なので、一括APIも「削除できた件数」を返し、
リクエストしたID数と差があれば分かるようにする（§6で設計）。

## 6. バックエンド設計: 一括削除API

### 6.1 エンドポイント設計（新設・POSTボディ方式）

既存の単件 `DELETE /api/master/products/{management_no}` / `DELETE /api/master/categories/{category_id}`
は維持する（個別削除ボタンは残す。UIバックログにも単件削除の廃止要望は無い）。一括は**新設エンドポイント**
とし、複数IDをボディで受ける。理由は「マスタCRUD規約」節にある `POST /api/item-targets/bulk` の前例
（一括保存は単発と別エンドポイント・1トランザクション）に揃えるため。DELETEメソッドでリクエストボディを
使うのはHTTP的に非推奨（キャッシュ・プロキシの扱いが不定）なので、**一括操作はPOSTにする**（これは
オーナー確認事項Q1として提示する。§9参照）。

```python
# backend/routers/masters.py に追加

class BulkDeletePayload(BaseModel):
    ids: list[int] = []          # カテゴリは category_id、商品はここに management_no を使わず id で統一するか要検討（§9 Q1補足）

@router.post("/categories/bulk-delete")
def bulk_delete_categories(payload: BulkDeletePayload, db: Session = Depends(get_db)):
    """カテゴリの一括ソフトデリート（1トランザクション）。参照商品は未分類化。"""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="ids が空です")
    cats = (
        db.query(ProductCategory)
        .filter(ProductCategory.id.in_(payload.ids), ProductCategory.archived_at.is_(None))
        .all()
    )
    deleted_ids: list[int] = []
    detached_total = 0
    for cat in cats:
        detached = db.query(Product).filter(Product.category_id == cat.id).update(
            {Product.category_id: None}
        )
        cat.archived_at = datetime.utcnow()
        deleted_ids.append(cat.id)
        detached_total += detached
    db.commit()
    return {
        "requested": len(payload.ids),
        "deleted_ids": deleted_ids,
        "detached_products": detached_total,
    }


class BulkDeleteProductsPayload(BaseModel):
    management_nos: list[str] = []

@router.post("/products/bulk-delete")
def bulk_delete_products(payload: BulkDeleteProductsPayload, db: Session = Depends(get_db)):
    """商品マスタの一括ソフトデリート（1トランザクション）。"""
    mnos = [m.strip() for m in payload.management_nos if (m or "").strip()]
    if not mnos:
        raise HTTPException(status_code=400, detail="management_nos が空です")
    prods = (
        db.query(Product)
        .filter(Product.management_no.in_(mnos), Product.archived_at.is_(None))
        .all()
    )
    now = datetime.utcnow()
    deleted: list[str] = []
    for p in prods:
        p.archived_at = now
        deleted.append(p.management_no)
    db.commit()
    return {"requested": len(mnos), "deleted_management_nos": deleted}
```

設計判断のメモ:

- **既存の単件削除ロジックをそのまま複数件ループで呼ぶ**（コード重複を避けるため単件関数を内部で
  呼び出すことも検討したが、単件はHTTPExceptionで404を投げる作りのため、一括では「見つからない/
  既に削除済みのIDは黙ってスキップし、削除できた分だけ返す」方が一括操作のUXとして自然。単件用の
  `delete_category`/`delete_master_product` はそのまま残し、一括用は独立した実装にする（重複は
  20行程度で許容範囲。無理に共通化すると単件のエラーハンドリング方針と一括のスキップ方針が
  衝突する）
- カテゴリは主キー `id`（int）、商品は自然キー `management_no`（str）を使う。既存の単件エンドポイント
  の識別子とそれぞれ揃える（`DELETE /categories/{category_id}` は `id`、`DELETE /products/{management_no}`
  は `management_no`）
- 1トランザクション・1コミット（`item_targets.py` の `bulk_upsert_item_targets` に揃える）。ただし
  一括保存が「1件でも検証エラーなら全体ロールバック」なのに対し、一括削除は**検証エラーという概念が
  薄い**（存在しないID・削除済みIDは単に対象外にするだけで失敗ではない）ため、全体ロールバックの
  対象は「DBエラー（制約違反等）が起きたとき」のみで良い。ここはシンプルにfor文の外でcommitする形で足りる
- レスポンスは「要求件数」と「実際に削除できた件数/ID」を両方返す。フロントの確認ダイアログで
  「N件削除しました」の実数表示に使う（要求件数と食い違えば「一部は既に削除済みでした」等の
  補足も出せる）
- **【評定確定・必須】要求件数と実削除件数が一致しない場合、フロントは黙って成功扱いにしてはいけない。**
  `requested`（要求件数）と実際に削除できた件数（`deleted_ids.length` / `deleted_management_nos.length`）
  を比較し、不一致なら「◯件中◯件を削除しました（他のタブ等で先に削除されていた可能性があります）」の
  ように**実数を明示して**表示する（§7.1参照）。一致していれば通常どおり「◯件削除しました」でよい

### 6.2 CSVへの影響確認

一括削除機能自体はエクスポートに何も追加しない（既存の `export_categories`/`export_master_products`
は `archived_at IS NULL` で削除済みを除外する既存ロジックのまま）。フロント側で「未分類」ラベルを
新たに表示する変更（§2.4）は、CSVエクスポートの `genre_u1/u2/u3` 列には影響しない
（CSVは元々空欄を出力しており、そこに新しく文字列を書き込むわけではない。「未分類」は画面表示専用の
UI文字列に留め、CSVの列には書き込まない。書き込むと空欄との対応が取れなくなり、往復保証
（エクスポート→無編集で再取込→同じ状態）が崩れるため）。

## 7. フロントエンド設計

### 7.1 チェックボックスUI・一括削除ボタン

`CategoryMaster.tsx` と `MasterSettings.tsx`（商品マスタ部分）両方に以下を追加:

- 各行の先頭にチェックボックス列を追加（既存の列は右にずれる）
- ヘッダーに全選択チェックボックス。**【評定確定】対象は現在のページのみ。ラベルは「全選択」ではなく
  「このページを全選択」と明記する**（絞り込み結果全体が選ばれたと誤解して大量削除する事故を、
  文言で防ぐ。商品マスタは50件/ページのページングがあるため特に重要）
- 選択件数が1件以上のとき、テーブル上部（既存の検索・CSVボタンの並び）に「選択した◯件を削除」
  ボタンを表示（0件のときは非表示、既存ツールバーを圧迫しない）
- クリックで `ConfirmDeleteModal` を開く。`message` に選択件数を埋め込む
  （例: `「3件のカテゴリ」を削除します。割り当てられている商品は「未分類」に戻ります。`）
- 確定後、一括削除APIを呼ぶ。**【評定確定】レスポンスの要求件数と実削除件数を比較し、一致すれば
  「◯件削除しました」、不一致なら「◯件中◯件を削除しました（他のタブ等で先に削除されていた
  可能性があります）」と実数で表示する**（§6.1参照。黙って全件成功したように見せない）。
  成功したら選択状態をクリアして一覧を再取得（既存の `load()` を再利用）

`ConfirmDeleteModal` コンポーネント自体の改修は不要（`message` propで件数を渡すだけで対応できる）。

### 7.2 未分類アラート（非強制バナー）

商品マスタ画面（`MasterSettings.tsx`）の「商品マスタ」セクション上部に、`category_id IS NULL` の
商品件数が1件以上のときだけ薄いバナーを表示する:

```
未分類の商品が◯件あります。カテゴリを再設定しますか？ [ジャンルで絞り込む]
```

- 表示条件・閉じたときの挙動は§9 Q3で確認（オーナー確認事項）
- 「ジャンルで絞り込む」リンクは、既存のジャンルドロップダウン（`itemGenre` state）を
  「未設定のみ」相当の状態にする（既存の商品一覧に `category_id === null` フィルタを追加する形。
  アイテム別目標画面には既に「未設定のみ」チェックボックスの実装例があるので同じ作法を踏襲）
- 件数自体は一覧APIのレスポンス（`items` 配列）をクライアント側で `category_id === null` の数を
  数えるだけで取得できる。**新しいバックエンドAPIは不要**

### 7.3 未分類ラベルの表示（§2.4対応）

- 商品マスタ一覧のジャンル列: `category_id === null` の行に、GenrePickerの代わりに
  グレーの「未分類」バッジを添える（既存の空のGenrePicker表示のままでも操作はできるが、
  意図が伝わらないため軽微な表示改善として追加）
- アイテム別目標一覧（`TargetSetting.tsx` のアイテム別目標セクション）: `genre_u1` が `null` の行は
  現状ジャンル列が空欄のはずなので、同様に「未分類」バッジに置き換える

## 8. 区切り（マイルストーン）

各区切りは独立してPR化でき、夜勤（無人・定期実行）に流せる粒度にした。判断が必要な区切りは
「対話セッション専任」と明記する。

### 区切り0: オーナー確認事項の確定（対話セッション専任）

§9のQ1〜Q4の回答を得る。**この区切りが終わるまで実装に着手しない。**

### 区切り1: バックエンド一括削除API（夜勤可）

- `backend/routers/masters.py` に `POST /master/categories/bulk-delete` / `POST /master/products/bulk-delete`
  を追加（§6.1のコード）
- 検証コマンド:
  - `cd backend && py -3 -c "from main import app"`（import確認）
  - ローカルuvicorn起動 → `curl -X POST http://127.0.0.1:8000/api/master/categories/bulk-delete -H "Content-Type: application/json" -d "{\"ids\":[1,2]}"` で200・`deleted_ids`/`detached_products` を確認
  - 同様に `products/bulk-delete` を `management_nos` で確認
  - 既存の単件削除・一覧APIが壊れていないこと（`curl` で `GET /api/master/categories`・`GET /api/master/products` を確認）
- オーナー判断は不要（§9で確定した仕様どおりに実装するだけ）。**夜勤対象**

### 区切り2: フロントエンド チェックボックス・一括削除ボタン（夜勤可、区切り1完了後）

- `CategoryMaster.tsx` / `MasterSettings.tsx` にチェックボックス列・全選択・一括削除ボタン・
  `ConfirmDeleteModal` 連携を追加
- 検証コマンド: `cd frontend && npm run build`（型エラー0）。ヘッドレスChromeで
  チェックボックス選択→件数表示→確認ダイアログ→削除→一覧更新の一連の動作を実測
- **夜勤対象**（区切り1のAPI契約が固まっていれば、UIの実装自体に新しい判断は生じない）

### 区切り3: 未分類アラート・未分類ラベル表示（夜勤可、区切り2と並行可）

- §7.2・§7.3の実装
- 検証コマンド: `npm run build`。ヘッドレスChromeでカテゴリ削除→対象商品が「未分類」表示になる→
  バナーが出る→絞り込みリンクで該当商品だけ表示、を一連で実測
- **夜勤対象**

### 区切り4: kpi-analystレビュー（対話セッション専任）

§2の調査結果（「GAP分析・診断はバックエンド変更不要」という結論）を kpi-analyst にレビューさせる。
**実装（区切り1〜3）の前に行うか後に行うかは§9 Q4で確認するが、いずれにせよレビュー自体は
自動実行に投げず対話セッションで依頼する**（判断のレビューであり、コード変更を伴わない作業のため
夜勤である必然性が無く、レビュー結果次第でGAP分析側の追加調査が必要になる可能性がある）。

### 区切り5: 本番検証（対話セッション専任）

- 本番デプロイ後、実アカウントでカテゴリ・商品それぞれ数件を一括削除し、
  `GET /api/security-status` の `ok:true` を確認
- カテゴリ一括削除→紐づいていた商品が一覧で「未分類」表示になる→GAP分析・ダッシュボードの
  売上合計が削除前後で変わらないことを実画面で確認（§2の結論の最終検証）

## 9. オーナーへの確認事項

**Q1. 一括削除APIのエンドポイント設計は「新設・POSTボディ方式」（§6.1）でよいか。**
回答案: はい。DELETEメソッドでリクエストボディを使うのは標準外の挙動になり、`item_targets.py` の
一括保存も同じ理由でPOSTを使っている前例があるため、これに揃えるのが自然だと考える。

**Q2. 商品マスタの「全選択」チェックボックスの範囲は、現在のページ（50件）だけか、絞り込み結果全体か。**
回答案: 現在のページのみに限定する。絞り込み結果全体（数千件になり得る）を1クリックで選択できると、
「うっかり全商品を削除してしまう」事故の入口になりやすい。1000件超を一括削除したいケースが
実際に出てきたら、そのときに「絞り込み結果全体を選択」ボタンを別途追加する（初期実装では作らない）。

**Q3. 未分類アラートの表示条件・閉じたときの挙動を確定してほしい。** 候補:
- (a) 未分類が1件以上ある間、画面を開くたびに毎回表示する（閉じるボタンは無し、または閉じても
  次回アクセス時に再表示）
- (b) 一度閉じたら、その画面滞在中は再表示しない（リロード・再訪問で復活）
- (c) 一度閉じたら二度と出さない（`localStorage` 等で永続化）

回答案: (b) を推奨。(a) は「非強制」という仕様の趣旨に反して押しつけがましくなる。(c) は
未分類が何件も溜まっているのに誰も気づけなくなるリスクがある。(b) なら「毎回画面を開けば思い出せるが、
作業中はうるさくない」のバランスが取れる。

**Q4. kpi-analystレビュー（§8区切り4）は実装前・実装後どちらのタイミングで行うか。**
回答案: 実装前を推奨。§2の結論（GAP分析・診断はバックエンド変更不要）はこの計画全体の前提に
なっており、もしレビューでこの結論に異論が出れば区切り1〜3の設計そのものが変わる可能性がある。
先にレビューを通してから実装に入る方が手戻りが無い。レビューポイントとして kpi-analyst には
「§2.1〜2.4の調査結果（category_idとGAP分析ロジックの独立性）が正しいか」「仕様4（集計から除外せず
未分類グループとして出す）の実装スコープが商品マスタ・アイテム別目標一覧の表示強化のみで足りているか」
の2点を確認してもらう想定。

## 10. 評定結果（確定・2026-08-28）

Q1〜Q4、すべて推奨案どおりで確定。うち3件（Q1・Q2・Q4）はオーナーが実装条件・注意点を追加した。

| # | 確定内容 | 推奨案からの追加・変更 |
|---|---|---|
| Q1 | **新設・POSTボディ方式で確定。** | **追加条件**: 一括削除のレスポンスは「要求件数」だけでなく**実際に削除できた件数**を返し（§6.1のレスポンス設計は既に対応済み）、フロントは要求件数と実削除件数が一致しない場合（他タブで先に削除済み等）に**「◯件中◯件を削除しました」と正直に表示する**。黙って全件成功したかのように見せない。§7.1のトースト/結果表示にこの分岐を明記する |
| Q2 | **現在のページのみで確定。** | **追加条件**: 「全選択」ではなく**「このページを全選択」**とボタンラベルに明記する。絞り込み結果全体が選択されたと誤解して数百件を削除する事故は典型パターンのため、ラベルで誤解を防ぐ。§7.1のUI文言に反映する |
| Q3 | **(b) 画面滞在中は再表示しない、で確定。** | 変更なし |
| Q4 | **実装前で確定。** | **追加条件**: kpi-analystには§2の結論を鵜呑みにせず**実測の追試**をさせる。特に①**カテゴリ削除後も`RppWeekly.genre`のスナップショット文字列は変更されないため、過去の集計値が不変であること**（§2.2の「CSV取込のたびに独立して決まる」を裏付ける実測）②**`Product.category_id`に依存する箇所が`item_targets.py`の`_resolve_genre()`フォールバック1箇所だけであること**（§2.1の全件表の見落としが無いかの再確認）の2点を重点的に検算させる |

## 11. 区切り4（kpi-analystレビュー）結果（2026-08-28）

オーナー指定の2点を実測で追試し、**§2の結論を両点とも追認**。修正すべき穴は見つからなかった。

**① `RppWeekly.genre`のスナップショット不変性・過去集計の不変性**: `delete_category()`
（`masters.py:361-377`）が`RppWeekly`/`MonthlyItemSales`を一切更新しないことをコードで確認。加えて
**ローカルSQLite・サンプルデータで実際に手を動かして裏付けを取った**: `GET /api/gap/kpi-tree`・
`GET /api/gap/genre`の数値（`kgi.actual=1709275.0`等）を控えたうえでカテゴリを1件削除（4商品を
未分類化）し、同じ2エンドポイントを再実行して**JSON全体が完全一致**することを実測確認。

**② `Product.category_id`依存は`item_targets.py`の`_resolve_genre()`1箇所のみ**: 診断・提案系
5ファイル（`diagnosis.py`/`evaluation.py`/`matrix_actions.py`/`product_recommendations.py`/
`recommendations.py`）を個別に確認し、いずれも参照0件。`genre_master.py`にdocstring上の言及が1件
あったが実コードでの参照ではなく実害なし。`_resolve_genre()`が「実績が1件も無いときだけのフォールバック」
という説明も、ガード条件（`if latest is not None and (...)`）どおり正確と確認。

**結論: §2の実装スコープ縮小は正しい。区切り1〜3は設計変更なしで夜勤（無人・定期実行）に流してよい。**
