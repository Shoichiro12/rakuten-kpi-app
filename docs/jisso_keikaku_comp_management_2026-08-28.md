# 実装計画: 管理画面からの無償提供（comp）管理 2026-08-28

対象コミット: `b0e20af`（`git log --oneline -3` で確認。直前は `fc9d89c` 管理者閲覧機能の全区切り完了クローズ）。

**未評定。オーナー確認事項（§10）の回答待ち。実装には未着手。**

## 0. 背景・要件（オーナー原文の整理）

社内の検証・デモ用アカウントを無料で使わせる仕組みは現状 `EXEMPT_TEST_EMAILS`（環境変数、カンマ区切りメール）しかなく、追加・削除に Render ダッシュボードでの手作業とデプロイが必要。これを `/admin` 画面（管理者閲覧機能。計画書 `docs/jisso_keikaku_admin_viewer_2026-08-26.md`、区切り1〜6すべて完了・本番稼働中）から直接操作できるようにする。

1. `/admin` から無償提供を付与・解除できる。付与されたアカウントは Stripe のカード登録（Checkout）を一切通らずに全機能を利用できる（現行 EXEMPT と同じ動作）。付与は既存アカウントへの操作に加え、未登録メールへの先行登録も可能にする
2. 既存の `EXEMPT_TEST_EMAILS` との関係を整理する（一本化案／併存案の利害得失を提案。一本化する場合は demo@ の移行手順を計画に含める）
3. 変更時は対象・変更内容つきの確認ダイアログ必須。すべての変更を監査ログに記録（誰が・いつ・誰を・何から何へ）。`AdminViewSession` と同じ作法
4. 一覧の課金状態列に「無償提供」と区別して表示する。顧客側の請求・プラン画面でも矛盾しない表示にする（無償の人に「トライアル残り◯日」や課金導線が出ない）
5. Stripe整合: 付与対象に既存のStripe契約（有料・トライアル・past_due）がある場合の扱いを設計する。推奨は「警告して拒否し、先にStripe側の解約を促す」方向
6. 解除時の挙動も設計する: 解除されたアカウントは通常の未契約状態に戻り、課金導線が再表示されること
7. 閲覧モード（読み取り専用）中はこの操作も403

### 今回やらないこと（スコープ外）

- 複数管理者オペレーターの権限分離（`admin_guard.py` は現状 `ADMIN_USER_ID` 単数形。管理者閲覧機能の計画書が既に「複数人の役割分離はスコープ外」としており、今回も踏襲する）
- 無償提供の「一部機能だけ無料」のような段階的プラン（現行 EXEMPT と同じく「全機能無料」の1種類のみ）
- 一括CSVでの付与・解除（1件ずつの操作のみ。マスタCRUD規約の「全削除系のみ`ConfirmDeleteModal`必須・1件ずつはここまで要求しない」の考え方に近いが、comp付与・解除は影響が大きいので**1件ずつでも確認ダイアログを必須にする**＝要件3の指定どおり）
- 付与理由・利用目的の入力を必須項目にするかどうかの厳密な運用ルール化（自由記述欄は用意するが、必須/任意は§10で確認）
- 管理者自身（`admin@ureshiru.com`）への comp 付与（管理者アカウントはそもそも `_paid` の対象外＝契約と無関係に動くため、comp という概念が成立しない）

### 守る既存の開発規約（前提として確認済み）

- 新しいモデルは `UserScopedMixin` 継承＋ `migrations._USER_SCOPED_TABLES` 登録が必須
- RLSは起動時 `migrations._enforce_rls_pg()` が自動で塞ぐ（新テーブルも自動保護対象）
- 新しいルーターは `_paid` に乗らない限り未契約者に開放される。今回追加する comp 管理エンドポイントは「管理者専用・契約状態と無関係」という点で `/api/admin/*`（区切り1で新設済みの第3グループ）に属する
- **生SQL（`text()`）はtenancyの自動絞り込みを受けない。** `GET /api/security-status`・`GET /api/admin/accounts` と同じ「全ユーザー横断集計」の逃げ道を、comp 一覧・先行登録の解決処理でも使う
- **JWT検証済みの値でのみ判定する。** `EXEMPT_TEST_EMAILS` / `admin_guard` の原則を踏襲し、comp 付与のリクエストボディに書かれたメールは「操作対象の指定」としては使うが、「誰が操作したか」の判定には絶対に使わない（`AuthUser.id`/`AuthUser.email` のみ）

---

## 1. 設計 × 既存実装のマッピング表

ゼロから作るものと、既存資産を組み合わせれば足りるものを最初に切り分ける。

| 項目 | 状態 | 根拠・備考 |
|---|---|---|
| メール単位で無料アクセスを許可する仕組み | **実装済み（別方式）** | `backend/billing.py` の `_EXEMPT_TEST_EMAILS` / `is_exempt_test_email()`。ただし env ベースで DB化されていない |
| Checkoutをスキップして `trialing` を直接作成するコードパス | **実装済み** | `routers/billing.py::create_checkout()` の `_skip_reason` 分岐。comp 機能もこのパスの隣に実装する（Checkoutを通さない、という核心ロジックは流用できる） |
| 管理者判定（UUID方式） | **実装済み** | `backend/admin_guard.py`（`ADMIN_USER_ID` env、`require_admin` 依存関係） |
| 管理者専用ルーターの枠組み（`/api/admin/*`、第3グループ `_admin`） | **実装済み** | `backend/routers/admin.py` + `main.py` 187〜188行 |
| アカウント一覧API（メール・登録日・課金状態・最終ログイン・データ取込有無） | **実装済み** | `GET /api/admin/accounts`。**このAPIの課金状態列（`subscription_status`）は生SQLで `subscriptions.status` をそのまま返しているだけなので、comp を新しいstatus値として作れば追加改修なしでこの一覧に出てくる**（表示ラベルのマッピングだけフロントに追加すればよい） |
| 監査ログ（誰が・いつ・誰を・何をしたか）の実装パターン | **実装済み（参考実装）** | `AdminViewSession`（`UserScopedMixin`、開始時点のスナップショット保存、`ended_at` で状態遷移を表現）。comp 機能でも同じ設計思想を流用する（§5） |
| 「対象ユーザーとして書き込む」ときの tenancy コンテキスト切り替え | **実装済み（参考実装）** | `routers/billing.py::_sync_subscription()`（Stripe Webhookが対象ユーザーの `Subscription` 行を書くために `current_user_id.set(uid)` する）。**comp 付与が既存アカウントに対して行う「対象ユーザーの `Subscription` 行を書く」処理はこれと全く同じパターン**なので新規に発明する必要がない |
| 「JWT検証済みの値で判定する・ローカル開発は無効」という管理者機能共通の前提 | **実装済み** | `admin_guard.require_admin`（`AUTH_ENABLED` が False なら403） |
| 閲覧モード中の書き込み403強制 | **実装済み・ただし `/api/admin/*` は対象外という穴がある** | `auth.py::UserContextMiddleware`。**§2で詳述。新設する comp 管理APIをそのまま `/api/admin/comp*` に置くと要件7が自動的には満たされない** |
| comp 専用のDBテーブル（`CompGrant`） | **未実装（新規）** | §5 |
| comp 付与・解除・一覧のAPI | **未実装（新規）** | §7 |
| `Subscription.status` に comp 相当の値を持たせる仕組み | **未実装（新規）** | §4 |
| 未登録メールへの先行登録・解決ロジック | **未実装（新規）** | §6 |
| Stripe整合チェック（既存契約があれば拒否） | **未実装（新規）** | §8 |
| フロント（`AdminAccounts.tsx` の付与UI・確認ダイアログ・`Billing.tsx` の comp 表示分岐） | **未実装（新規）** | §9 |
| `EXEMPT_TEST_EMAILS` との統合方針 | **未確定（比較検討中）** | §3 |

**結論: ゼロから作るのは「comp というメール単位の状態を DB で管理する仕組み」と「それを既存の Checkout スキップ・アカウント一覧・監査ログの3つの既存資産に接続する配線」であって、既存資産そのものは作り直さない。**

---

## 2. 最重要論点: `/api/admin/*` 配下だと閲覧モード中の403が自動で効かない（実測検証つき）

### 2-1. 何が起きるか

`backend/auth.py` の `UserContextMiddleware`（177〜248行）で、読み取り専用の403強制は次の条件でのみ発動する。

```python
view_token = raw_view_session.decode("latin-1").strip()
path = scope.get("path", "")
if view_token and not path.startswith("/api/admin"):
    ...（管理者資格の再チェック → セッション解決 → GET以外なら403）
```

**`path.startswith("/api/admin")` が真の場合、この読み取り専用チェック全体がスキップされる。** これは意図的な設計で、`POST /api/admin/view-sessions/{id}/end`（閲覧終了）自体が閲覧モード中でも動かないとデッドロックするための除外（コメント168〜171行）。

**したがって、comp 管理エンドポイントを素直に `/api/admin/comp` のような `/api/admin/*` 配下に置くと、要件7（閲覧モード中は403）が自動的には満たされない。** 既存の除外は「管理者自身の閲覧セッション管理操作だけは常に許可する」という意図であり、これから作る**書き込み系のcomp管理操作**まで免除してよい理由にはならない。

### 2-2. 実測で確認した

`backend/auth.py` を一切変更せず、実際の `UserContextMiddleware` に生の ASGI リクエストを流して検証した（有効な閲覧セッションを持つ管理者JWTで、①既存の閲覧終了API ②仮想の `POST /api/admin/comp/grant` ③対照として通常の `_paid` エンドポイント `/api/targets` の3パターンを送った）。

```
[既存] POST /api/admin/view-sessions/{id}/end -> status=200 reached_app=True  effective_user_id=admin-uuid-1234
[仮想] POST /api/admin/comp/grant             -> status=200 reached_app=True  effective_user_id=admin-uuid-1234
[対照] POST /api/targets                       -> status=403 reached_app=False effective_user_id=None
```

**確認できたこと**: 既存の閲覧終了APIは意図どおりアプリ本体まで到達する（デッドロック回避が機能している）。一方、`/api/admin/comp/grant` という仮想の書き込みエンドポイントも**同じ理由でアプリ本体まで到達してしまう**（＝ミドルウェアだけでは止まらない）。対照の `/api/targets` は想定どおり403で止まる。**これで問題を実機で再現できた。**

### 2-3. 対処方針: 案A（comp管理専用の依存関係で明示的に拒否）を採用する

| 案 | 内容 | 採否 |
|---|---|---|
| 案A: comp管理エンドポイント専用の依存関係で拒否 | `backend/admin_guard.py` に `require_admin_write()` を新設。`require_admin` を内包しつつ、リクエストヘッダ `X-Admin-View-Session` の有無を明示的にチェックし、付いていれば理由に関わらず403にする（HTTPメソッドを問わない。comp操作はそもそも常に「変更」を意味するため） | **採用** |
| 案B: comp管理エンドポイントを `/api/admin/` 配下に置かず、別プレフィックスにする | ミドルウェアの `path.startswith("/api/admin")` 除外の対象外になるので自動的に効く | **不採用**。既存の管理者API（アカウント一覧・閲覧セッション）との一貫性が崩れる（同じ管理画面の機能なのにURL体系だけ変わる）。`main.py` の `_admin` グループ登録・フロントの `api.admin.*` 名前空間もすべて分岐が増える |

**`require_admin_write` の実装イメージ（§7で正式版を示す）:**

```python
def require_admin_write(
    request: Request,
    admin: AuthUser = Depends(require_admin),
) -> AuthUser:
    """comp管理など、管理者の「書き込み」操作専用のガード。

    UserContextMiddleware は /api/admin/* を読み取り専用強制の対象外にしている
    （閲覧セッション自体の終了APIがデッドロックしないため）。この除外は
    「閲覧セッション管理そのもの」にだけ許されるもので、comp付与のような
    別の書き込み操作まで免除する意図ではない。ここで明示的に閲覧モード中かを
    再チェックする。
    """
    if request.headers.get("x-admin-view-session"):
        raise HTTPException(
            status_code=403,
            detail="閲覧モード中は無償提供の操作はできません。閲覧を終了してから操作してください。",
        )
    return admin
```

- comp の**書き込み系**（付与・解除）エンドポイントは `Depends(require_admin_write)` を使う
- comp の**一覧（読み取り）**は既存のアカウント一覧と同じ `Depends(require_admin)` のままでよい（閲覧モード中でも一覧が見えること自体は問題ではない。要件7が指しているのは「操作」＝書き込み）
- 既存の閲覧セッション管理API（開始・終了・履歴）は**変更しない**（`require_admin` のまま）。これにより閲覧モード中でも「閲覧を終了」操作は引き続き動く（デッドロック再発防止）

### 2-4. なぜこれで両立するか（機構の説明）

`UserContextMiddleware` の除外は ASGI ミドルウェア層（リクエストがルーティングされる前）で、`path` 文字列だけを見て決まる。一方 `require_admin_write` は FastAPI の `Depends`（ルーティング後・ハンドラ実行前）で、リクエストの**中身**（ヘッダ）を見て決まる。この2つは独立したレイヤーなので、「ミドルウェアは `/api/admin/*` 全体を通す」→「その後、書き込み系エンドポイントだけが `Depends` で改めて閲覧モードを検知して弾く」という二段構えが成立する。§2-2 で実測した「ミドルウェアだけでは止まらない」という事実は変わらないが、エンドポイント側の `Depends` が確実に止める。**実際の403検証（`require_admin_write` を組み込んだ状態での再測定）は実装フェーズで行う**（今回は計画段階のため既存コードは変更していない）。

---

## 3. `EXEMPT_TEST_EMAILS` との関係: 一本化 vs 併存

| 観点 | 一本化（envを廃止し管理画面へ集約） | 併存（envは残し、新規追加は管理画面を主とする） |
|---|---|---|
| 追加・削除の手間 | 画面操作のみ（Renderデプロイ不要） | 併存する2経路（env＋管理画面）を両方触る運用が残る |
| 記録漏れ・棚卸しリスク | 一覧が画面に出る＝棚卸しが容易。`docs/unyou_exempt_test_emails.md` の台帳とRender設定値の突合という**過去に実際に事故（既定値`test@gmail.com`の3週間放置）を起こしたパターン**を根本的に減らせる | 2つの記録（env台帳＋DBのcomp一覧）を突き合わせる作業が残り、同種の記録漏れリスクを温存する |
| ローカル開発（認証無効）での使い勝手 | **失われる。** `is_exempt_test_email()` はDB非依存・env読み取りのみで完結する軽量な判定だが、`CompGrant` はDBテーブル前提の管理者機能で、`admin_guard.require_admin` は「認証無効（ローカル開発）は常に403」という既存の明示的な制約を持つ。ローカル開発者が自分用のテストメールをサクッと追加する用途には使えなくなる | 維持される。開発者は引き続き `.env` に自分のメールを1行足すだけで動く |
| 本番の障害時フォールバック | 無い。DB・管理画面経路が何らかの理由で機能しない場合、無償提供の付与・解除手段が完全に失われる | ある。過去に `TRIAL_WITHOUT_CARD`（Stripe決済停止時の一時措置）が `EXEMPT_TEST_EMAILS` と同じコードパスを再利用した実績があり、「envで即座に切り替えられる最終手段」には実際の使いどころがあった |
| 移行作業の要否 | 要る（demo@の移行手順が発生。下記参照） | 不要（コード変更なしで共存できる） |
| 課金状態列の表示（要件4） | comp化された分だけ「無償提供」と明確に区別できる。EXEMPT分は残らないので一覧の表示がシンプルになる | EXEMPT由来のアカウントは引き続き `status="trialing"` のままなので、一覧上で「本物のトライアル」と「EXEMPTの無償トライアル」を区別できない状態が残る（demo@を移行すればこの1件は解消するが、将来また env に追加されれば同じ問題が起きる） |

**推奨: 併存（ただし運用を縮小する）。**

- **理由1**: ローカル開発の使い勝手と、本番の障害時フォールバックという「DBに依存しない最終手段」の価値は、一本化のメリット（棚卸しの容易さ）と比べて失うには惜しい。特に本番フォールバックは過去に実際に使われた実績（`TRIAL_WITHOUT_CARD`）がある
- **理由2**: 一本化の主目的（記録漏れの防止）は、「今後の新規追加は原則すべて管理画面のcomp機能を使う」という運用ルールに変えるだけで、コードを変えなくても達成できる。env側は「既存のdemo@を維持するだけの凍結された経路」にする
- **運用ルール（推奨）**: `docs/unyou_exempt_test_emails.md` に「2026-08-28以降、新規の無償提供は `/admin` の comp 機能を使う。`EXEMPT_TEST_EMAILS` は既存のdemo@のみ維持し、新規追加は原則行わない（ローカル開発用の一時追加を除く）」を追記する

### demo@ の移行手順（一本化を選ばなくても、この機能ができ次第、実行を推奨する）

現状 `demo@ureshiru.com` は `EXEMPT_TEST_EMAILS` 経由で `status="trialing"`（期限つき）のまま無料利用している。comp機能が完成したら、これを comp（無期限・明示的な区別）へ切り替えることを推奨する。

1. `/admin` の comp 管理画面から `demo@ureshiru.com` に comp を付与する（§8のStripe整合チェックは通る。demo@は `stripe_customer_id` を持たないため）
2. 動作確認（`GET /api/billing/status` が `status: "comp"` を返すこと、ダッシュボード等が引き続き使えること）
3. Render の `EXEMPT_TEST_EMAILS` から `demo@ureshiru.com` を削除して再デプロイ
4. `docs/unyou_exempt_test_emails.md` の台帳に削除日を記入し、「以後は `/admin` の comp 一覧が正の記録」と注記を追加
5. 万一 comp への切り替えで問題が起きた場合、Render の `EXEMPT_TEST_EMAILS` に戻すだけで即座にロールバックできる（既存コードは触っていないため）

**この移行は必須要件ではなく推奨**（§10 Q2で確認）。

---

## 4. `Subscription.status` に `"comp"` を追加する設計の要否と影響範囲

### 4-1. 要否

**追加が必要。** 理由: 既存の「カード登録なしでtrialingを作る」方式（EXEMPT/TRIAL_WITHOUT_CARD）をそのまま流用すると、`status="trialing"` になり `trial_end` が設定される。これは要件4「トライアル残り◯日が出ない」と正面から矛盾する現状の実装（実際に `Billing.tsx` は `status === 'trialing'` のとき `trial_end` を「トライアル終了」として表示する）。**comp は概念的に「トライアルではない・期限のない無償提供」なので、専用のstatus値が要る。**

`Subscription.status` は `Column(String)` で、DB側にENUM制約は無い（コメント「trialing / active / past_due / canceled / incomplete 等」という自由記述の運用）。**新しい文字列値を1つ増やすだけなので、DBスキーマの変更・マイグレーションは不要**（列の型がStringのため）。影響はコード側の分岐箇所に限られる。

### 4-2. 影響範囲（洗い出し済み）

| ファイル | 箇所 | 変更内容 |
|---|---|---|
| `backend/routers/billing.py` | `_ACTIVE_STATUSES = ("trialing", "active")`（34行目） | `"comp"` を追加。`is_active` 判定（`_sub_dict`）と `billing_status()` に影響し、comp アカウントは `is_active: true` になる |
| `backend/subscription_guard.py` | `ACTIVE_STATUSES = ("trialing", "active")`（29行目。コメントで「`routers/billing.py` の `_ACTIVE_STATUSES` と同義。循環importを避けるためここに持つ」と明記された重複定義） | 同様に `"comp"` を追加。`require_active_subscription()` がcompアカウントを402にしないために必須 |
| `backend/routers/account.py` | `_BLOCKING_SUB_STATUSES = ("trialing", "active", "past_due", "unpaid")`（43行目。契約中は退会をブロックする判定） | **§10 Q5で確認**。comp を含めるかどうかは設計判断が要る（§4-3参照） |
| `frontend/src/pages/Billing.tsx` | `STATUS_LABEL`（11〜17行目。`unpaid`が無い等、元々やや不完全）、`trial_end`/`current_period_end` の出し分け（200〜204行目）、「解約をご希望の場合」カードの表示条件（246行目 `active && status`） | `comp: '無償提供'` を追加。`status === 'comp'` のとき日付欄を「無償提供中（期間の定めなし）」に、解約カードを非表示に |
| `frontend/src/pages/AdminAccounts.tsx` | `STATUS_LABEL`（18〜24行目） | `comp: '無償提供'` を追加（要件4の一覧表示） |
| `backend/routers/billing.py` | `_diagnose()` の `db_vs_stripe` 突き合わせ | comp アカウントは `stripe_subscription_id` が無いため、既存の「DBに subscription ID がありません」warn がそのまま出る（EXEMPTと同じ仕様どおりの挙動。変更不要） |

**この4〜5箇所以外に `"trialing"`/`"active"` の文字列比較を行っている箇所が無いかは実装フェーズで再度 `grep` して確認する**（今回の調査では上記が全量と考えられるが、実装時の最終確認は必須）。

### 4-3. `account.py` の退会ブロックとの整合（設計上の論点）

`_BLOCKING_SUB_STATUSES` の趣旨は「退会APIはStripe契約に触れないため、契約中に退会を通すと『ログイン不可なのに課金継続』事故になる」（コメント原文）。**comp アカウントは `stripe_customer_id` を持たない（Stripe契約が存在しない）ため、この事故のリスクが原理的に無い。**

一方で、現状すでに `EXEMPT_TEST_EMAILS`／`TRIAL_WITHOUT_CARD` が作る `status="trialing"` は `_BLOCKING_SUB_STATUSES` に含まれるため、**Stripe契約が無いにもかかわらず退会がブロックされる**という既存の見過ごされていた挙動がある（今回の調査で判明。既存の不具合ではなく「安全側に倒れている」状態だが、事故のリスクが無いのにブロックしている点で過剰）。

comp について、退会ブロックに含めるかどうかは2案ある。

| 案 | 内容 | トレードオフ |
|---|---|---|
| 含める（trialingと同じ扱い） | `_BLOCKING_SUB_STATUSES` に `"comp"` も追加 | 安全側。ただし comp は「管理者が意図的に無償で使わせているアカウント」なので、本人の意思だけで退会されると管理者側の記録（`CompGrant`）と実態がズレる（本人が消えたのに comp 台帳には残る）。退会前に管理者へ問い合わせる、という運用が必要になる |
| 含めない（Stripe契約なしとして扱う） | `_BLOCKING_SUB_STATUSES` に追加しない | comp アカウントは自由に退会できる。ただし退会時に `CompGrant` 側の掃除（`revoked_at` セット）を退会処理に組み込まないと、台帳に「有効な comp」として残り続ける（本人はもう存在しないのに一覧に出る、次に同じメールでサインアップしたら即座に comp が復活する等） |

**推奨: 含めない。ただし退会処理（`routers/account.py` の削除フロー）に「対象ユーザーの `CompGrant` が有効なら `revoked_at` をセットする」処理を追加する。** 理由: comp はそもそもStripe契約が存在しないため「ログイン不可なのに課金継続」という`_BLOCKING_SUB_STATUSES`の本来の目的には該当しない。退会をブロックする理由が無い以上、ブロックしない案のほうが自然。ただし台帳の整合性は別途手当てする必要があり、これを退会APIの一部として実装する。**この設計判断はオーナー確認事項に含める（§10 Q5）。**

---

## 5. データモデル: `CompGrant`（新規）

```python
class CompGrant(Base, UserScopedMixin):
    """無償提供（comp）の付与状態。メールをキーに管理者が付与・解除する。

    UserScopedMixin の user_id は「付与操作を行った管理者自身のID」を表す
    （AdminViewSession と同じ意味）。対象は email 列で持つ（target_user_id では
    なく email をキーにするのは、Supabase側にアカウントがまだ無い状態＝
    先行登録でも保存できるようにするため）。実際に紐付く Supabase ユーザーが
    判明した時点で target_user_id を埋める（解決タイミングは §6 参照）。

    1つの email につき複数回の 付与→解除→再付与 が起こり得るため、行を
    使い回さず、都度 INSERT する（マスタCRUD規約の archived_at 復活方式とは
    異なる。あちらは「削除済み行の復元」だが、こちらは「独立した1回の意思
    決定の記録」を毎回積み重ねる監査ログの性質が強いため）。「現在有効な
    付与」は revoked_at IS NULL の行で判定する。
    """
    __tablename__ = "comp_grants"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)       # 正規化: strip().lower()
    target_user_id = Column(String, index=True, nullable=True)  # 解決後に埋まる（§6）
    granted_by_email = Column(String)      # 付与した管理者のメール（読みやすさのため保存）
    granted_at = Column(DateTime, default=func.now())
    revoked_at = Column(DateTime, nullable=True)   # 解除済みならセット
    revoked_by_email = Column(String, nullable=True)
    # 付与理由の自由記述。【評定確定・Q6】必須（nullable=False）。短文でよいが、
    # 「なぜ無償か」を後から追えなくする放置事故（EXEMPT_TEST_EMAILSと同じ教訓）を防ぐため
    note = Column(String, nullable=False)
```

- `migrations._USER_SCOPED_TABLES["comp_grants"] = []`（ユニーク制約なし。同じメールで複数回の付与・解除サイクルを許すため、DB制約では一意性を強制しない。「同一メールへの重複した有効な付与」の防止はアプリケーション層で行う＝§7の付与APIが「既存の有効な付与」を先にチェックする、`AdminViewSession` の「同じ管理者の既存セッションを自動終了してから新規作成」と同じ考え方）
- 起動時 `_enforce_rls_pg()` が自動でRLSを有効化する（他の新テーブルと同様。ポリシーは作らず、Data API経由のアクセスは全拒否のまま）
- `sample_data.py` は更新しない。`AdminViewSession` と同じ理由（店舗のKPIデータではなく管理者の運用ログのため。§10 Q6の一部として明記しておく）
- **監査ログ要件（誰が・いつ・誰を・何から何へ）との対応**: 誰が=`granted_by_email`/`revoked_by_email`、いつ=`granted_at`/`revoked_at`、誰を=`email`/`target_user_id`、何から何へ=1行のライフサイクル自体が表現する（`granted_at` が「未契約 → comp」、`revoked_at` が「comp → 未契約」）。`AdminViewSession` が「開始・終了」の1テーブルで状態と監査ログの両方を兼ねているのと同じ設計判断を踏襲し、**別テーブルの `CompGrantLog` は作らない**（1テーブルで要件を満たせるため、テーブル数を無用に増やさない）

---

## 6. 未登録メールへの先行登録: 永続化方式と解決タイミング

### 6-1. 2つの付与パターン

| パターン | 対象 | 付与時にできること |
|---|---|---|
| A. 既存アカウントへの付与 | Supabase Auth に既にユーザーが存在（`GET /api/admin/accounts` の一覧に出ている） | **即時解決できる。** `target_user_id` が最初から分かっているので、付与操作の中でその場で対象ユーザーの `Subscription` 行を `status="comp"` に書き換えられる |
| B. 先行登録（未登録メール） | まだ誰もサインアップしていないメールアドレス | `target_user_id` が存在しないため、`CompGrant` 行を `target_user_id = NULL` のまま保存するしかない。**実際に comp を有効化するのは、そのメールでサインアップした「あと」** |

### 6-2. パターンAの実装（即時解決）

対象ユーザーの `Subscription` 行を書くには、tenancy のコンテキストを一時的に対象ユーザーへ切り替える必要がある。**これは新しい仕組みではなく、`routers/billing.py::_sync_subscription()`（Stripe Webhookが対象ユーザーのSubscription行を書くために使っている `current_user_id.set(uid)` の手法）と全く同じパターン**を再利用する。

```python
token = current_user_id.set(target_user_id)
try:
    s = db.query(Subscription).first()  # tenancyにより target_user_id の行に自動スコープ
    if s is None:
        s = Subscription()
        db.add(s)
    s.plan = B.STANDARD_PLAN
    s.status = "comp"
    s.trial_end = None
    s.current_period_end = None
    db.commit()
finally:
    current_user_id.reset(token)
```

### 6-3. パターンBの実装（先行登録の解決）

対象ユーザーがまだ存在しないため、「そのユーザー自身が初めて認証済みリクエストを送ってきたとき」に解決するしかない。解決ポイントの候補を検討した。

| 候補 | 内容 | 採否 |
|---|---|---|
| `require_active_subscription()`（`subscription_guard.py`） | 全ての `_paid` エンドポイントで毎回呼ばれる | **不採用**。comp解決が必要なのは「先行登録された新規ユーザーが初めてログインした直後」という稀なタイミングだけなのに、全ユーザー・全リクエストに毎回1回分の余分な問い合わせ（インデックス付きSELECTとはいえ）を持たせるのは過剰。既に402→`/billing`へのリダイレクトという既存の導線があるため、そちらで十分間に合う |
| `billing_status()`（`GET /api/billing/status`） | `Billing.tsx` がマウント時に必ず呼ぶ。新規サインアップ直後のユーザーは、`_paid` エンドポイントで402を受けて `/billing` にリダイレクトされる既存の流れ（CLAUDE.md記載）で、遅くともここには来る | **採用** |
| `create_checkout()`（`POST /api/billing/checkout`） | 「トライアルを始める」ボタンを押したときに呼ばれる | **採用（保険として併用）**。`billing_status()` で解決済みならこちらは何もしない（冪等）。仮に `billing_status()` を経由せず直接 `create_checkout()` が呼ばれる経路があっても取りこぼさないための二重化 |

**実装イメージ（`backend/billing.py` に共通ヘルパーを追加し、両エンドポイントから呼ぶ）:**

```python
def resolve_pending_comp_grant(db: Session, user: AuthUser) -> None:
    """先行登録されたcomp付与を、本人の初回リクエストで確定させる。

    対象は「まだ target_user_id が確定していない、有効な CompGrant」のみ。
    見つからなければ何もしない（毎回のコストは email 完全一致のインデックス
    付きSELECT 1本のみ）。
    """
    if not user.email:
        return
    email = user.email.strip().lower()
    row = db.execute(text(
        "SELECT id FROM comp_grants WHERE email = :email "
        "AND revoked_at IS NULL AND target_user_id IS NULL "
        "ORDER BY granted_at DESC LIMIT 1"
    ), {"email": email}).fetchone()
    if row is None:
        return
    grant_id = row[0]
    db.execute(text(
        "UPDATE comp_grants SET target_user_id = :uid WHERE id = :id"
    ), {"uid": user.id, "id": grant_id})

    s = db.query(Subscription).first()  # 実行中のリクエストは本人自身のコンテキストなので
                                          # tenancy が自動で本人の行に絞り込む（切り替え不要）
    if s is None:
        s = Subscription()
        db.add(s)
    s.plan = STANDARD_PLAN
    s.status = "comp"
    s.trial_end = None
    s.current_period_end = None
    db.commit()
```

**ポイント**: パターンBの解決は「本人自身のリクエスト」の中で起きるため、パターンAのような tenancy コンテキストの切り替え（`current_user_id.set()`）は**不要**。`CompGrant` テーブル自体への読み書きだけ生SQLで tenancy を迂回する（このテーブルの行は「付与した管理者」の所有物として保存されているため、本人からは通常のORMクエリでは見えない）。

**UX上のトレードオフ**: 先行登録されたユーザーが、サインアップ後に `/billing` を経由せず `_paid` エンドポイント（例えばブックマークしたダッシュボードURL）に直接アクセスした場合、1回だけ402→`/billing`へのリダイレクトを経験してから使えるようになる（新規サインアップしたばかりの通常ユーザーが最初に辿る導線と同じで、退行ではない）。

---

## 7. API設計

新設: `backend/routers/admin_comp.py`（`admin.py` を肥大化させず分離。既存 `admin.py` は「アカウント一覧・閲覧セッション」専任のまま保つ）。`main.py` で `_admin` グループに追加登録する。

| メソッド・パス | 依存関係 | 内容 |
|---|---|---|
| `GET /api/admin/comp-grants` | `require_admin` | 有効な付与一覧（`revoked_at IS NULL`）。`target_user_id` が埋まっているか（解決済み/先行登録中）を返す。解決済みの行は `GET /api/admin/accounts` 側にも `comp_granted_at` 等をマージして表示する（後述） |
| `POST /api/admin/comp-grants` | `require_admin_write` | body `{email, note}`（**note必須・評定Q6確定**。空文字は400）。§8のStripe整合チェック→パターンA/Bの分岐→`CompGrant`行を作成 |
| `POST /api/admin/comp-grants/{id}/revoke` | `require_admin_write` | `revoked_at`をセット。対象の `Subscription.status` が `"comp"` なら削除（§9で詳述） |

`GET /api/admin/accounts` にも軽微な拡張を加える（**新規エンドポイントを増やさず、既存の集計に1列足すだけ**）:

```python
comp_rows = db.execute(text(
    "SELECT target_user_id FROM comp_grants "
    "WHERE revoked_at IS NULL AND target_user_id IS NOT NULL"
)).fetchall()
comp_user_ids = {r[0] for r in comp_rows}
...
accounts.append({
    ...,
    "is_comp": uid in comp_user_ids,
})
```

（実際には `subscription_status == "comp"` を見ればフロントは判別できるが、`CompGrant` 側の `granted_at`/`note` も一覧に出したい場合はここでマージする。詳細はフロント設計時に確定）

---

## 8. Stripe整合チェック（要件5）の実装方針

**推奨どおり「警告して拒否し、先にStripe側の解約を促す」を採用する。**

### 8-1. 拒否条件の精緻化

単純に `status in ("trialing", "active", "past_due", "unpaid")` で拒否すると、**EXEMPT_TEST_EMAILS 由来の `status="trialing"`（Stripe契約が実在しない）まで拒否してしまい、demo@ の comp 移行（§3）ができなくなる。** 拒否すべきは「実際に Stripe 上に生きた契約がある」ケースのみ。

既存コードに、まさにこの区別のために作られた信号がある: `stripe_linked = bool(s.stripe_customer_id)`（`routers/billing.py::_sub_dict()`。カスタマーポータルのボタン表示可否に既に使われている実績パターン）。

**拒否条件（推奨）**:

```python
if s and s.stripe_customer_id and s.status in ("trialing", "active", "past_due", "unpaid"):
    raise HTTPException(
        status_code=409,
        detail=(
            "このメールには既にStripe契約があります"
            f"（status={s.status}）。先にStripe側の解約手続きを行ってから、"
            "無償提供を付与してください。"
        ),
    )
```

- `stripe_customer_id` が無い（EXEMPT/TRIAL_WITHOUT_CARD 由来 or 未契約）→ 拒否しない
- `status == "canceled"`（解約済み。`stripe_customer_id` は残っていることがある）→ 拒否しない（解約後の再付与は正当なユースケース）
- `status` が既に `"comp"`（重複付与）→ 拒否ではなく「既に付与済みです」として200で既存行を返す（冪等。二重にCompGrant行を作らない）

### 8-2. legal-financeレビューのタイミング

**実装着手前（区切り2の実装に入る前）に、`.claude/agents/legal-finance.md` のレビューを正式に実行する。** 今回の計画段階では、そのレビュー観点を先取りして論点整理だけ行った（下表）。**これは法的助言ではなく、専門家確認が必要な論点の洗い出しにとどまる。**

| 箇所 | 現状 | 今回の機能との関係 | 対応案 | 専門家確認の要否 |
|---|---|---|---|---|
| `lp/terms.html` 解約導線（問い合わせ経由・2〜3営業日） | 有料契約者の解約フロー | comp アカウントは Stripe契約が無いため、この解約フローの対象外（管理者がcomp管理画面で解除するだけ） | 変更不要。ただし `Billing.tsx` の「解約をご希望の場合」カードを comp アカウントには出さない（§4-2で設計済み。有料の解約導線を無関係なアカウントに見せない） | 不要 |
| `backend/routers/account.py` の退会ブロック（`_BLOCKING_SUB_STATUSES`） | 契約中の退会をブロック | §4-3で comp を含めない案を推奨。含めない場合、comp アカウントは自己都合でいつでも退会できる | 退会時に `CompGrant.revoked_at` を連動させる実装が必要（§4-3） | 不要（実装上の整合の話であり、規約上の論点ではない） |
| 特定商取引法・利用規約の「取引条件」としての comp | 無償提供は金銭の授受を伴わない | 特商法は「販売価格・支払方法」等、有償取引の表示義務を定めるもので、無償提供そのものは取引条件の開示義務の対象外と考えられる | 変更不要と考えられる | 一応確認（無償提供の実施自体が何らかの表示義務を生まないか） |
| `lp/privacy.html` 6章（安全管理措置） | 管理者閲覧機能導入時（2026-08-26）に「サポート対応および導入支援の目的で、当方の担当者が利用者の登録データを閲覧する場合があります」を追記済み | comp 付与は「閲覧」ではなく「契約状態の変更」だが、目的は同じ（サポート対応・導入支援） | 既存文言でカバーされると考えられる。追記は必須ではない | 不要 |

---

## 9. 解除時の挙動（要件6）

`POST /api/admin/comp-grants/{id}/revoke`:

1. 対象の `CompGrant` 行に `revoked_at` / `revoked_by_email` をセット
2. `target_user_id` が確定している（=既にサインアップ済み）場合、tenancy コンテキストを対象ユーザーへ切り替え（§6-2と同じ `current_user_id.set()` パターン）、その `Subscription` 行を確認する:
   - `status == "comp"` の場合のみ、行を**削除**する（`db.delete(s)`）。これにより `_sub_dict(None)` が返る「未契約」状態＝要件6の「通常の未契約状態」に正確に戻る。`db.query(Subscription).first()` が `None` を返すようになり、`Billing.tsx` は自動的に通常のプランカード（課金導線）を再表示する
   - `status != "comp"`（例: 何らかの理由で既に別の状態に変わっている）の場合は**何もしない**（安全側。comp解除がうっかり実契約を壊さないようにする）。レスポンスに `subscription_touched: false` を含め、フロントで「対象の契約状態が comp ではなかったため、契約データは変更していません」という注記を出せるようにする
3. `target_user_id` が未確定（先行登録のまま誰もサインアップしていない）場合、`CompGrant.revoked_at` をセットするだけで完了（触るべき `Subscription` 行が存在しない）

**「通常の未契約状態に戻り、課金導線が再表示される」の技術的な担保**: `Subscription` 行を削除する設計により、`billing_status()` は `_sub_dict(None)` を返す（`is_active: false`, `status: null`）。これは「一度も契約したことがないユーザー」と完全に同じレスポンス形状であり、`Billing.tsx` の分岐は既存のまま（新しい分岐を追加する必要がない）で正しいプランカードを表示する。

---

## 10. フロントエンドの変更点

- `frontend/src/pages/AdminAccounts.tsx`:
  - 課金状態列の `STATUS_LABEL` に `comp: '無償提供'` を追加
  - 各行（Supabase Auth に実在するアカウント）に「無償提供を付与」／「無償提供を解除」ボタンを追加（現在の `subscription_status` によって出し分け）
  - 一覧の下に「無償提供（先行登録・未サインアップ含む）」の折りたたみセクションを追加（`GET /api/admin/comp-grants` を取得。既存の「閲覧履歴」折りたたみと同じ実装パターン＝開いたときだけ取得）。ここに「メールで先行登録する」フォーム（メール入力＋**理由メモ入力必須**。評定Q6確定。プレースホルダで短文例を示す＝「例: ○○社の導入検証用」）を置く
- **確認ダイアログ**: 要件3「対象・変更内容つきの確認ダイアログ必須」を満たすコンポーネントを新設（`ConfirmDeleteModal.tsx` と同じ「チェックボックスを入れないと実行できない」構造を踏襲するが、名前・トーンは汎用化する。例: `ConfirmActionModal.tsx`）。表示内容:
  - 対象: メールアドレス（＋店舗名が分かれば併記）
  - 変更内容: 「未契約 → 無償提供」／「無償提供 → 未契約」のように現在値→変更後を明示
  - 影響: 付与時「この操作後、対象アカウントはカード登録なしで全機能を利用できるようになります。」／解除時「この操作後、対象アカウントの無償提供は終了し、通常のトライアル・課金フローに戻ります。」
- `frontend/src/pages/Billing.tsx`:
  - `STATUS_LABEL` に `comp: '無償提供'` を追加
  - 日付欄（200〜204行目）に `status === 'comp'` の分岐を追加し、「無償提供中（期間の定めなし）」を表示
  - 「解約をご希望の場合」カード（246行目）の表示条件に `status.status !== 'comp'` を追加し、comp アカウントには出さない（有料契約の解約フローを無関係なアカウントに見せないため）
  - 「お支払い方法の変更」ボタンは既存の `stripe_linked === false` 判定がそのまま効くため、**変更不要**（comp アカウントは `stripe_customer_id` を持たないので自動的に非表示になる）

---

## 11. 区切り（マイルストーン）

各区切りで: 実装 → `cd backend && py -3 -c "from main import app"` ／ `cd frontend && npm run build`（型エラー0） ／ ローカルuvicornでの動作確認 → push → 本番デプロイ確認 → オーナー目視。

| 区切り | 担当 | 理由 |
|---|---|---|
| 1. バックエンド基盤（`CompGrant`モデル・`require_admin_write`・migrations登録） | **対話セッション専任（夜勤対象外）** | `require_admin_write` は認証/管理者ガードの拡張そのもの。管理者閲覧機能の区切り1・2と同じ判断基準（RLS・認証の根幹に触れる変更は無人実行に出さない） |
| 2. comp API本体（付与・解除・一覧・Stripe整合チェック・先行登録の解決ロジック・`status="comp"`の全箇所反映） | **対話セッション専任（夜勤対象外）** | 課金ゲート（`require_active_subscription`）・Checkout分岐・退会ブロックという「お金と権限」に関わるロジックの変更。作りながら判断が発生する性質（管理者閲覧機能の区切り2と同じ理由） |
| 3. フロントエンド（`AdminAccounts.tsx`拡張・確認ダイアログ・`Billing.tsx`表示分岐） | Cowork可（1・2マージ後、APIが固まってから） | 既存APIを呼ぶだけの独立作業。管理者閲覧機能の区切り3と同じ位置づけ |
| 4. `docs/unyou_exempt_test_emails.md` 更新・legal-financeレビューの正式実施・CLAUDE.md追記 | Cowork可（文言確定後、即日） | 文書作業＋legal-financeサブエージェントによる整合確認。失敗しても無害 |
| 5. 本番デプロイ・検証・オーナー目視 | オーナー＋対話セッション | 本番作業 |

**区切り1・2は夜勤（無人・定期実行）の対象外とする。** `docs/office_map.html` の軍令帳に本件を積む際、「夜勤対象外（普請はセッション実施）」と明記すること（管理者閲覧機能の計画書と同じ注意）。

### 各区切りの検証コマンド（機械的に実行できるもの）

- 区切り1: `cd backend && py -3 -c "from main import app"`／`GET /api/security-status` で `comp_grants` が `unprotected` に含まれないことを確認
- 区切り2: ローカルuvicornで (a) 管理者以外が `/api/admin/comp-grants` に403 (b) 既存Stripe契約ありのメールへの付与が409 (c) 先行登録→サインアップ後に`GET /api/billing/status`が`comp`を返す (d) 解除後に`is_active: false`に戻る (e) **【評定Q4・qa必須項目】閲覧モード中（`X-Admin-View-Session`ヘッダ付き）に`POST /api/admin/comp-grants`を叩くと403になり、既存の閲覧終了API（`POST /api/admin/view-sessions/{id}/end`）は引き続き200で通ること**、の5パターンを確認
- 区切り3: `npm run build` 型エラー0／ヘッドレスブラウザで付与→確認ダイアログ表示→実行→一覧に反映→解除の一連を確認
- 区切り4: `docs/unyou_exempt_test_emails.md` の差分レビューのみ（コード変更なし）

---

## 12. オーナーへの確認事項

**Q1. `Subscription.status` に新しい値 `"comp"` を追加する設計でよいか。**
推奨: はい。DBスキーマ変更は不要（String列のため）で、影響箇所は§4-2で洗い出した4〜5ファイルに限定される。代替案（既存の `"trialing"` を無期限で使い回す）は要件4「トライアル残り◯日を出さない」と両立できないため採らない。

**Q2. `EXEMPT_TEST_EMAILS` は一本化・併存のどちらにするか。**
推奨: 併存（§3）。ローカル開発の使い勝手と本番障害時のフォールバックを残しつつ、運用ルールで「新規追加は管理画面のcomp機能を使う」に寄せる。demo@ のcomp移行は必須要件ではなく推奨として実行する。

**Q3. 未登録メールへの先行登録の永続化方式でよいか。**
推奨: `CompGrant` テーブル（`target_user_id` は解決まで NULL）＋ `billing_status()` / `create_checkout()` での解決（§6）。`require_active_subscription()` には解決ロジックを持たせない（全リクエストへの負荷を避けるため）。この場合、先行登録ユーザーが `_paid` エンドポイントへ直接アクセスすると1回だけ `/billing` へリダイレクトされてから使えるようになる（新規ユーザーの既存導線と同じ）が、これで許容できるか。

**Q4. 閲覧モード中403の対処方針でよいか。**
推奨: 案A（`require_admin_write` を新設し、comp管理の書き込み系エンドポイントにだけ付ける。既存の閲覧セッション管理APIは変更しない）。§2-2で実測済み（現状は素通りすることを確認済み。修正後の再検証は実装フェーズで行う）。

**Q5. comp アカウントを退会ブロック（`account.py::_BLOCKING_SUB_STATUSES`）に含めるか。**
推奨: 含めない（§4-3）。comp はStripe契約が存在しないため、`_BLOCKING_SUB_STATUSES` の本来の目的（「ログイン不可なのに課金継続」の防止）に該当しない。ただし退会処理に `CompGrant.revoked_at` を連動させる実装を追加する（本人退会後も comp 台帳に「有効」として残らないようにするため）。

**Q6. `CompGrant.note`（付与理由の自由記述）は必須項目にするか、任意にするか。**
推奨: 任意。ただしフロントのプレースホルダで記入を促す（例:「例: ○○社の導入検証用、△△様のオンボーディング支援」）。必須にすると、緊急時に理由をまだ言語化できていない状態での付与ができなくなる。

**Q7. `CompGrant` は `sample_data.py` の対象外（`AdminViewSession` と同じ扱い）でよいか。**
推奨: はい。店舗のKPIデータではなく管理者の運用ログのため。

---

## 13. 評定結果（確定・2026-08-28）

Q1〜Q7、すべて推奨案どおりで確定。うち3問（Q1・Q2・Q4）に実装条件を追加、Q6は推奨を覆して確定した。

| # | 確定内容 | 推奨案からの変更・追加 |
|---|---|---|
| Q1 | **`"comp"`追加で確定。** | **追加条件**: 週次security-check（`.claude/agents/security.md`）と`docs/unyou_exempt_test_emails.md`の「課金ガードの通過条件」の記述に`comp`を明記する。ガード条件（`_ACTIVE_STATUSES`/`ACTIVE_STATUSES`に加わる新しい通過経路）はセキュリティ検分の監視対象そのものであり、検分側が「知らない通過経路」として誤検知しないようにする。区切り4（運用文書更新）で対応 |
| Q2 | **併存で確定。ただし役割を固定する。** | **追加条件**: `EXEMPT_TEST_EMAILS`は「緊急用・開発用の最終手段」、通常運用はすべて管理画面のcompへ、と`docs/unyou_exempt_test_emails.md`に明記する。**demo@ureshiru.comは今回の実装完了時にcompへ移行し、envから外す**（§3の「移行は必須要件ではなく推奨」から「今回実施する」に変更。二重管理の芽を早期に摘む） |
| Q3 | 推奨どおり`CompGrant`＋`billing_status()`/`create_checkout()`解決で確定。 | 変更なし |
| Q4 | **案A（`require_admin_write`新設）で確定。** | **追加条件**: 実装時、この依存を使うテスト（閲覧モード中のcomp操作が403になること）を**qaの検証項目に必須で含める**。§2-2はミドルウェアレベルの実測（対処前）であり、`require_admin_write`実装後の再検証はqaが担う |
| Q5 | 推奨どおり退会ブロックに含めない＋退会処理に`CompGrant`連動を追加、で確定。 | 変更なし |
| Q6 | **必須に変更（推奨「任意」を覆す）。** | 理由（オーナー）: 無償リストは時間が経つと「この人なぜ無償だっけ」が必ず起きる。`EXEMPT_TEST_EMAILS`で「誰をいつ入れたか台帳に残す」運用にしたのと同じ考え方で、付与の瞬間に理由を1行書かせるのが最も安い。短文でよいが必須。§5の`CompGrant.note`を`nullable=False`に変更し、§10のフロント確認ダイアログ（付与フォーム）でも入力必須にする |
| Q7 | 推奨どおり`sample_data.py`対象外で確定。 | 変更なし |

**進め方**: 区切り1・2（バックエンド基盤・comp API本体）は次の対話セッションで着手する。区切り3（フロントエンド）・区切り4（運用文書更新・legal-financeレビュー）のCowork委任指示書は、区切り2完了後に切り出す（管理者閲覧機能のku3/ku4と同じ順序＝APIが固まってから指示書を書く）。
