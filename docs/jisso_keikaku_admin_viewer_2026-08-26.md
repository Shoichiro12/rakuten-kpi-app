# 実装計画: 管理者閲覧機能（アカウント一覧＋読み取り専用の顧客画面閲覧） 2026-08-26

対象コミット: `5d7ef4f`（`git log --oneline -5` で確認。直前は CSVインジェクション対策の評定確定 `7b44c23`）。

**評定確定済み（2026-08-26）。§9参照。** 区切り4・5はCowork委任で即日着手可（`docs/cowork_shiji_admin_viewer_ku4_privacy_2026-08-26.md` / `docs/cowork_shiji_admin_viewer_ku5_exempt_docs_2026-08-26.md`）。区切り1・2はRLS・認証の根幹に触るため対話セッション専任（§8参照）、区切り3はそのマージ後にCowork可。

## 0. 背景・要件（オーナー原文の整理）

導入オンボーディングと問い合わせ対応で、顧客と同じ画面を見ながら案内したい（画面共有を頼む運用を避けたい）。

1. 専用管理者アカウント（`admin@ureshiru.com` 想定、`demo@ureshiru.com` とは別人格）に、①登録アカウント一覧（メール・登録日・課金状態・最終ログイン・データ取込有無）と、②選択したアカウントの読み取り専用閲覧モードを提供する
2. 閲覧モードは操作・変更不可。閲覧の開始・終了・対象を監査ログとしてDBに記録する
3. RLSを壊さない実装方式の比較（service_role経由の専用APIとadminポリシー追加の利害得失）を計画に含める
4. legal-financeの観点で規約・プライバシーポリシーの現状を確認し、閲覧に関する追記文言の案を作る（LP側の法的文書が正、の原則どおり）
5. EXEMPT_TEST_EMAILSのテスト利用運用を軽くドキュメント化する（追加・削除の手順、台帳ルール）

### 今回やらないこと（スコープ外）

- 複数管理者オペレーターの権限分離（`ADMIN_EMAILS` に複数メールを入れれば複数人使えるが、役割の作り分けはしない。現状は `admin@ureshiru.com` 1名想定）
- 閲覧モード中の書き込みUI（保存ボタン等）を画面ごとに個別に disabled 化すること。バックエンドで403にする方式を採り、フロントの全フォーム改修はしない（区切り3で確認事項として提示）
- 顧客側への「サポートが閲覧しました」という通知・表示（既存のプライバシーポリシーの利用目的の枠内で足りるという整理。区切り4参照）
- 閲覧セッション中の1操作単位の詳細ログ（「どの画面を何秒見たか」等）。記録するのは開始・終了・対象のみ（要件どおり）
- Supabase Data API（PostgREST）を顧客データに対して新たに開放すること（§2の比較で不採用と結論）

### 守る既存の開発規約（前提として確認済み）

- 新しいモデルは `UserScopedMixin` 継承＋ `migrations._USER_SCOPED_TABLES` 登録が必須（`backend/tenancy.py` / `backend/migrations.py` で確認）
- RLSは起動時 `migrations._enforce_rls_pg()` が `public` スキーマの未保護テーブルを自動で塞ぐ（`pg_tables` を走査する全件スイープで、`UserScopedMixin` の有無に関係なく効く）。新テーブルもこれで自動的に保護される
- 新しいルーターは `_paid`（`_auth + require_active_subscription`）に乗せない限り未契約者に開放される（`main.py` 153〜178行）。今回の管理者ルーターは契約の有無と無関係の機能なので、この分類のどれにも当てはまらない新しい第3のグループになる（§5で定義）
- 生SQL（`text()`）はtenancyの自動絞り込みを受けない。`GET /api/security-status` がこの逃げ道を使っている（`main.py` 235〜260行）のと同じパターンを、アカウント一覧APIの「全ユーザー横断集計」にも使う

---

## 1. 現状調査（コードを読んで確認した事実）

- 認証は Supabase JWT（`backend/auth.py`）。`UserContextMiddleware`（ASGI）がJWTの `sub` を `tenancy.current_user_id`（ContextVar）にセットし、以降のSQLAlchemy ORMクエリ全てに自動で `user_id = 現在ユーザー` の絞り込みが付く（`tenancy.py` の `do_orm_execute`）。これは**同期依存関係ではなくASGIミドルウェアでやっている**理由が明記されている（スレッドプールのコンテキストコピー問題）
- バックエンドは `DATABASE_URL` でテーブル所有者(`postgres`ロール)として直接接続しており、RLSを常にバイパスする（`migrations.py` のコメントで明記）。つまり**「RLSを壊さない」とは、Postgres側の設定を壊さないことであり、アプリの動作自体はRLS設定に依存していない**
- 退会機能（`backend/routers/account.py`）が Supabase Admin API を叩く既存の実例。`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` で `urllib.request` を直接使い、キー形式（旧JWT形式 `eyJ...` / 新形式 `sb_secret_...`）でヘッダの組み方を変えている。今回のアカウント一覧（Supabase Auth側のメール・登録日・最終ログイン取得）はこの資産を流用・共通化する
- `EXEMPT_TEST_EMAILS` / `TRIAL_WITHOUT_CARD` は「JWT検証済みメールで判定し、入力値では判定しない」という原則の実例（`backend/billing.py`）。管理者判定もこの原則をそのまま踏襲する
- `frontend/src/lib/api.ts` の `authHeaders()` が全APIコール（`request()` と `downloadCsv()` 双方）の唯一の認証ヘッダ付与点。閲覧モードの伝達もここに1箇所追記すれば全APIに効く（新しい仕組みを画面ごとに書かなくてよい）
- `frontend/src/App.tsx` はルーティング一覧を持つ唯一のファイルで、現在 `/admin` 相当のルートは存在しない。サイドバー（`Sidebar.tsx`）にも管理者向け項目は無い
- `backend/models.py` に `is_sample` 列を持つテーブル群（`migrations._IS_SAMPLE_TABLES`）がある。アカウント一覧の「データ取込有無」を判定するとき、サンプルデータだけの行を「取込あり」と誤認しないよう `is_sample = False`（またはNULL）で絞る必要がある（2026-08-20のサンプル分離の意図を踏まえる）

---

## 2. 実装方式の比較: 「顧客画面をそのまま見る」をどう実現するか

顧客が見ているのは生テーブルの中身ではなく、`calculations.py` / `gap_analysis.py` / `evaluation.py` 等で**サーバー側計算済みの画面**（ダッシュボード・GAP分析・商品別KPI等）。管理者閲覧の目的は「同じ画面を一緒に見る」ことなので、実現方式は「既存のFastAPIエンドポイント群をそのまま、対象アカウントのデータで呼べるようにする」ことが核心になる。この前提で2案を比較する。

| 観点 | 案A: service_role経由の専用API（tenancyのcontextvar上書き） | 案B: Supabase RLS adminポリシー＋Data API直接公開 |
|---|---|---|
| 仕組み | 管理者ルーター＋ミドルウェア拡張で `tenancy.current_user_id` を対象ユーザーのIDに一時的に差し替える。既存の `_paid` エンドポイント（ダッシュボード・GAP・商品別KPI等）をそのまま呼べる | 各テーブルに `auth.jwt() ->> 'email' = 'admin@ureshiru.com' OR user_id = auth.uid()` のようなRLSポリシーを追加し、ブラウザから Supabase Data API（PostgREST）を直接叩けるようにする |
| 既存の計算ロジックを再利用できるか | できる。`calculations.py` 等はそのまま動く（バックエンドは既にpostgresロールでRLSをバイパスしているため、tenancyのcontextvarさえ差し替えれば通常のORMクエリが対象ユーザーのデータを返す） | できない。ダッシュボード・GAP分析・評価マトリクス等の計算は全てPython側にあり、生テーブルへのRLS付きアクセスだけでは同じ画面を再現できない。管理者用に画面をもう一系統作ることになる |
| 新しい攻撃対象面 | 増えない。フロントは今までどおりFastAPI経由でしかデータに触らない | 増える。**フロントのブラウザが初めてSupabase Data APIへ直接データ系テーブルを問い合わせる経路を持つことになる**。2026-07のRLS未設定事故はこのData API経由の露出が原因だった。ポリシーの書き漏れ・書き間違いが即座に「anonキーだけで全社データが見える」事故に直結する |
| 変更が必要な箇所の広さ | バックエンド2ファイル程度（ミドルウェア拡張＋新ルーター）＋フロント1箇所（`authHeaders()`）＋新テーブル1つ | 全 `UserScopedMixin` テーブル（16以上）にポリシー追加、かつフロントに管理者専用の別データ取得層（Data APIクライアント）を新設 |
| 読み取り専用の強制 | アプリ層で明示的に「GET以外は403」を1箇所（ミドルウェア）で実装できる | Postgresのポリシーを `FOR SELECT` に限定すれば理論上可能だが、対象16テーブル全てで書き漏れなく徹底する必要があり、検証の手間が段違い |
| 監査ログとの相性 | 自前のセッションテーブルに開始・終了・対象を記録するだけで完結 | 同様のログ機構は別途アプリ側に必要（Postgres側だけでは「誰が何のためにこの行を見たか」という業務的な文脈は残せない）ため、結局アプリ側の仕組みが要る |

**結論: 案A（service_role的な専用API＋tenancyのcontextvar上書き）を採用する。**

理由は「RLSを壊さないから」だけではない。このアプリの計算ロジックが全てサーバー側Pythonにあるため、案Bは「顧客と同じ画面を見る」という要件そのものを満たせない（生データへのアクセス手段が変わるだけで、画面を再現するには結局アプリ側にもう一系統の実装が要る）。加えて案Bは、2026-07に実際に事故を起こした経路（Data APIへのテーブル直接公開）を、今回「管理者用」という名目で新たに開くことになり、ポリシーの記述ミス1つが即座に全顧客データの露出につながる。案Aはその経路を一切増やさない。

なお「service_role」という語はSupabaseのAuth Admin API（ユーザー一覧取得等）で実際に使うが、テーブルデータの読み書き自体はバックエンドが元々postgresロール（テーブル所有者）で直結しており、RLSをバイパスしている。したがって案Aは「service_roleキーでテーブルを読む」のではなく、「既存の接続方式のまま、tenancyのユーザー識別だけを一時的に対象顧客に切り替える」実装になる。

---

## 3. データモデルへの影響

新テーブル `AdminViewSession`（1つ）を追加する。

```python
class AdminViewSession(Base, UserScopedMixin):
    """管理者による顧客アカウントの閲覧セッション（監査ログ）。

    UserScopedMixin の user_id は「閲覧を行った管理者自身のID」を表す
    （通常のtenancy運用と同じ意味）。対象顧客は user_id とは別に
    target_user_id 列で持つ（こちらはtenancyの絞り込み対象ではない、
    単なる識別子）。
    """
    __tablename__ = "admin_view_sessions"

    id = Column(Integer, primary_key=True, index=True)
    admin_email = Column(String)            # 開始時点のメールを保存（読みやすさのため）
    target_user_id = Column(String, index=True, nullable=False)
    target_email = Column(String)           # 開始時点のメールを保存（退会等で後から引けなくなる対策）
    session_token_hash = Column(String, index=True, unique=True)  # 生トークンはDBに保存しない
    started_at = Column(DateTime, default=func.now())
    ended_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)   # 自動失効（安全網）
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
```

- `UserScopedMixin` を継承するので、`migrations._USER_SCOPED_TABLES["admin_view_sessions"] = []`（ユニーク制約なし）に登録する。既存の全テーブルと同じ登録パターン
- 起動時 `_enforce_rls_pg()` が他の新テーブルと同様に自動でRLSを有効化する。ポリシーは作らないので、Data API経由のanon/authenticatedアクセスは通常どおり全拒否のまま
- `UserScopedMixin` により、このテーブルへの通常のORMクエリ（一覧・作成）は「作成した管理者自身の行」に自動で絞られる。今回は管理者が `admin@ureshiru.com` 1名の想定なので実務上問題にならないが、**将来 `ADMIN_EMAILS` に複数人を入れた場合、各管理者は自分が開始したセッションしか一覧できない**（他の管理者の閲覧履歴を横断的に見る画面が必要になったら、`security_status` と同じ生SQLの逃げ道を使う）。この制約は仕様として明記しておく
- `sample_data.py` は更新しない。理由: これは店舗のKPIデータではなく、管理者の運用ログであり、サンプルデータ生成・削除（`is_sample` 機構）の対象にする意味がない。CLAUDE.mdの「新しいテーブルを追加したら `sample_data.py` を更新する」ルールは業務データ（顧客が見るKPI系）を想定したものであり、このテーブルは例外として扱う。**この判断自体をオーナー確認事項に含める**（§8 Q4）
- `Product` / `Target` 等の既存マスタに変更は無い。管理者閲覧は既存のRead系エンドポイントをそのまま使うだけで、新しいマスタは増えない

---

## 4. 閲覧モードの技術的な実現方法

### 4-1. なぜ「別JWT発行」ではなく「view-asセッション状態」を採るか

検討した2案:

| 案 | 内容 | 採否 |
|---|---|---|
| 別JWT発行（顧客としてログインし直す） | Supabase Admin APIで対象ユーザーの magic link / OTP を発行し、実際に顧客としてサインインする | **不採用**。①顧客本人の `last_sign_in_at` が更新されてしまい、アカウント一覧の「最終ログイン」表示自体を汚染する ②実際のログインセッションを作るため、閲覧終了後もブラウザに顧客のセッションが残るリスクがある ③Supabase Admin APIの呼び出し回数・実装が増える（毎回のセッション開始でメール送信系のAPIを呼ぶ設計が多く、無効化・使い回しの制御が煩雑） |
| view-asセッション状態（今回採用） | 管理者は自分自身のJWTでログインしたまま。専用のセッションレコード（§3）と紐づく不透明なトークンをリクエストヘッダに載せ、サーバー側で `tenancy.current_user_id` を対象ユーザーのIDに一時的に上書きする | **採用**。顧客側のログイン記録に一切影響しない。既存の `UserContextMiddleware` の拡張だけで実現でき、新しい認証方式を増やさない |

### 4-2. 実装の流れ

1. **管理者ルーター（`backend/routers/admin.py`）を新設**。依存関係は `_auth + [Depends(require_admin)]`（後述、`_paid` ではない＝契約状態と無関係）
2. **`backend/admin_guard.py` を新設**（`subscription_guard.py` と対の構成）:
   - **判定はメールアドレスではなく、Supabaseユーザーの UUID（JWTの `sub`、`AuthUser.id`）で行う**（2026-08-26 オーナー評定で確定。§10参照）。`ADMIN_USER_IDS`（カンマ区切りのUUID、既定は空＝全員拒否）を読む。`EXEMPT_TEST_EMAILS` と実装パターンは同じだが、比較対象がメール文字列ではなくUUIDである点が異なる
   - メール判定を採らない理由: メールアドレスは変更・取り違えの余地がある（オーナー本人の言葉）。UUIDはSupabase側で不変のため、`admin@ureshiru.com` のメールを万一変更してもUUIDをenvに反映し忘れない限り安全側に倒れる（＝古いUUIDのままなら単に管理者権限が無くなるだけで、別人に権限が渡ることはない）
   - `require_admin(user: AuthUser = Depends(get_current_user))` … `AUTH_ENABLED` が False（ローカル開発）なら403（この機能はマルチテナントが効いている環境専用。ローカルでは全データ user_id NULLの単一テナントなので、閲覧モードという概念自体が成立しない）。`is_admin_user_id(user.id)` が False でも403
3. **`GET /api/admin/accounts`**（一覧）:
   - Supabase Auth Admin API（`GET {SUPABASE_URL}/auth/v1/admin/users`）でユーザー一覧（`id` / `email` / `created_at` / `last_sign_in_at` / `email_confirmed_at`）を取得。`account.py` の `_delete_supabase_user` にある鍵形式判定ロジックを `backend/supabase_admin.py`（新設・共通化）に切り出し、両方から使う
   - 課金状態は `Subscription` テーブルを **生SQL**（`db.execute(text("SELECT user_id, status, trial_end, current_period_end FROM subscriptions"))`）で全ユーザー分まとめて取得する（tenancyのORM絞り込みを受けない、`security_status` と同じ逃げ道）
   - データ取込有無は `RppWeekly` / `MonthlyItemSales` を `user_id` でグルーピングした生SQL（`WHERE is_sample = false OR is_sample IS NULL` を必ず付ける。付けないとサンプル生成しただけのアカウントが「データ取込済み」に見えてしまう）
   - 上記3系統を `user_id` をキーにPythonでマージして返す。店舗名（`Shop.name`）もあわせて生SQLで引く（1店舗1アカウント前提なので `Shop` は1ユーザー1行）
4. **`POST /api/admin/view-sessions`**（閲覧開始）: body `{target_user_id}`。
   - 対象が実在するか（Supabase Auth側 or `Shop`/`Subscription` に該当行があるか）を確認
   - `secrets.token_urlsafe(32)` でトークンを発行し、`sha256` ハッシュだけをDBに保存（生トークンはレスポンスで一度だけ返す。DBには残さない＝万一DBが漏れてもトークンは再現できない）
   - **同じ管理者の既存の未終了セッションは自動終了する**（1管理者につき同時に1セッションのみ。複数タブでの多重閲覧による混乱を避ける）
   - `expires_at = started_at + 2時間`（§8 Q1で秒数を確認）
   - レスポンス: `{id, session_token, target_email, started_at, expires_at}`
5. **`POST /api/admin/view-sessions/{id}/end`**（閲覧終了）: `ended_at` をセット。対象は自分（管理者自身）が開始したセッションのみ（tenancyの自動絞り込みでそもそも他人のセッションは見えない）
6. **`GET /api/admin/view-sessions`**（履歴。監査ログの確認用。優先度は低いが、要件2「監査ログとしてDBに記録する」を人間が確認できる手段として最低限のGET一覧は用意する）
7. **`UserContextMiddleware`（`backend/auth.py`）を拡張**:
   - JWTを検証して `user`（管理者自身）を決定した直後、`current_user_id.set(user.id)` を行う**前**に、リクエストヘッダ `X-Admin-View-Session` を確認する
   - ヘッダがあれば: `sha256` ハッシュを計算し、`AdminViewSession` を `session_token_hash` 一致・`ended_at IS NULL`・`expires_at > now()` で検索（このクエリ自体はtenancy越しに行うので、後述の通り「検索している管理者自身が開始したセッションか」も自動的に絞られる。加えて `is_admin_email(user.email)` も毎リクエスト再チェックする＝許可リストから後で外れた管理者のセッションは即座に無効になる）
   - 一致すれば: リクエストの `method` が `GET`/`HEAD`/`OPTIONS` 以外なら、ここで403を返して `self.app` を呼ばずに終了する（「閲覧モードは読み取り専用です」）。GETであれば `current_user_id` に**管理者自身のIDではなく対象ユーザーのID**をセットする
   - 一致しなければ（トークン不正・期限切れ等）: 401を返す（サイレントに管理者自身のデータへフォールバックしない。フロントが「閲覧セッションが切れました、再度開始してください」と案内できるようにするため）
   - ヘッダが無ければ: 従来どおり（管理者自身のデータで動く。通常のログイン利用）
   - **`is_admin_email` ではなく `is_admin_user_id(user.id)` で毎リクエスト再チェックする**（上記のUUID判定に統一。§10 Q3参照）
8. **既存の `_paid` エンドポイント群は無改修で動く**。tenancyのcontextvarが対象ユーザーのIDになっているだけなので、ダッシュボード・GAP分析・商品別KPI・目標設定の閲覧（GET）がそのまま対象アカウントのデータを返す

### 4-3. 「読み取り専用」の技術的な粒度についての注記（要確認ではなく事実の共有）

GET以外のHTTPメソッドを一律403にする実装は、`masters.get_or_create_default_shop()` のような「GETのついでに欠けている行を遅延生成する」既存の内部処理まで止めるものではない（HTTPメソッドで止めているのであって、内部でのINSERTの有無では判定しない）。これは対象アカウントが初回アクセス時と同じ動作をするだけで、顧客が明示的に行う「保存・削除」等の操作とは性質が違うため、意図的にブロック対象外としている。

---

## 5. `main.py` への追加

```python
_admin = _auth + [Depends(require_admin)]
app.include_router(admin.router, dependencies=_admin)
```

`_paid` にも `_auth` 単体にも属さない、第3のグループとして追加する。契約状態を問わない（管理者自身は課金対象ではない）。

---

## 6. フロントエンドの変更点

- `frontend/src/pages/AdminAccounts.tsx`（新規）: `/admin` ルート。アカウント一覧テーブル（メール・店舗名・登録日・最終ログイン・課金状態・データ取込有無）＋各行に「この画面を見る」ボタン
- `frontend/src/lib/adminView.ts`（新規）: 現在の閲覧セッション（`session_token` / `target_email` / `expires_at`）を `sessionStorage`（ブラウザを閉じたら消える。`localStorage` は使わない＝長期間残ってほしくないため）で保持する薄いストア。`getViewToken()` / `setViewSession()` / `clearViewSession()`
- `frontend/src/lib/api.ts` の `authHeaders()` を1箇所拡張し、`adminView.getViewToken()` があれば `X-Admin-View-Session` ヘッダを追加する。`request()` と `downloadCsv()` の両方に自動的に効く（新しい仕組みを画面ごとに書く必要がない）
- `frontend/src/components/layout/AdminViewBanner.tsx`（新規）: 閲覧セッションが有効な間、`App.tsx` のレイアウト最上部に常時表示する固定バナー。「閲覧モード: `{target_email}`（読み取り専用）」＋残り時間の目安＋「閲覧を終了」ボタン。403（書き込み拒否）を受けたときのエラーメッセージが埋もれないよう、バナーの文言にも「保存・削除はできません」を明記する。**「読み取り専用」の明記はQ2の評定で必須要件として確定**（押せるのに失敗するボタンは操作する側を不安にさせるため、事前にバナーで宣言する。§10参照）。区切り3の検証項目にバナー文言の目視確認を含める
- `App.tsx` に `/admin` ルートを追加。サイドバーへの新規ナビ項目は**追加しない**（§8 Q3で確認）。管理者は直接 `/admin` にアクセスする運用とする
- 書き込み系ボタンの個別 disabled 化はしない（§8 Q2で確認）。バックエンドの403を受けたときの表示は既存の `parseJson()` のエラーハンドリング（`detail` をそのままエラーメッセージとして表示）に乗せるだけにする

---

## 7. 法務観点の整理（legal-financeの視点。専門家確認ではなく論点整理）

| 箇所 | 現状 | 今回の機能との関係 | 対応案 | 専門家確認の要否 |
|---|---|---|---|---|
| `lp/privacy.html` 2章（利用目的） | 「本サービスの提供・維持・改善のため」「本人確認、料金請求、お問い合わせ対応のため」が既に明記されている | サポート対応目的での閲覧はこの利用目的の範囲内と読める。第三者提供ではない（当方=事業者自身が自社サービスの提供のために自社データを見る行為） | 現状の文言でも法的にはカバーされていると考えられるが、**透明性のため明示を追加する**案: 「本サービスの提供・維持・改善のため」の直後、または6章（安全管理措置）に一文追加。例文: 「サポート対応・導入支援のため、当方の担当者が利用者の登録データを閲覧する場合があります。」 | 要（表現の是非は専門家判断。法的には現状の目的規定で足りる可能性が高いという整理） |
| `lp/privacy.html` 6章（安全管理措置） | 「取得した情報への不正アクセス、紛失、漏えい等を防止するため、通信の暗号化（TLS）、アクセス権限の管理等の安全管理措置を講じます」 | 閲覧モードの「読み取り専用強制」「監査ログ記録」はまさにこの「アクセス権限の管理」の具体化 | 追加するなら「閲覧は監査ログに記録し、読み取り専用に制限しています」のような一文で安全管理措置の実効性を補強できる | 不要（説明の追加であり新しい義務を負う文言ではない） |
| `lp/terms.html` 第6条（データの取扱い） | 「当方は、サービスの提供・改善に必要な範囲でのみ当該データを取り扱い、第三者に販売・提供しません」 | 管理者閲覧は「当方」自身による取扱いであり、条文上の「第三者への販売・提供」には当たらない | 現状のままで矛盾はないと判断。追記は必須ではない | 不要 |
| `lp/tokushoho.html` | 事業者名・返品条件等。閲覧機能との直接の関係は無い | 影響なし | 変更不要 | 不要 |

**結論（2026-08-26 評定確定）**: `lp/privacy.html` 6章（安全管理措置）に以下の一文を追加する。監査ログの存在まで書く形にオーナーが文言を差し替えた（機能の実態と一致させるため）。

> サポート対応および導入支援の目的で、当方の担当者が利用者の登録データを閲覧する場合があります。閲覧は必要な範囲に限り、閲覧記録を保存します。

実装は区切り4（Cowork委任、指示書は`docs/cowork_shiji_admin_viewer_ku4_privacy_2026-08-26.md`）。

---

## 8. 区切り（マイルストーン）と担当割り当て

各区切りで: 実装 → `npm run build`（型エラー0）／`from main import app` ／ローカルuvicornでの動作確認 → push → 本番デプロイ確認 → オーナー目視。

**担当割り当て（2026-08-26 評定で確定。判断基準＝事故ったときの被害範囲）:**

| 区切り | 担当 | 理由 |
|---|---|---|
| 1. バックエンド基盤 | **対話セッション（Cowork不可）** | 認証・管理者判定の根幹。作りながら判断が発生する |
| 2. 閲覧モード本体 | **対話セッション（Cowork不可）** | ミドルウェア拡張＝RLS/認証と同じ重みを持つ変更。無人実行でPRゲートだけで受けるには重い |
| 3. フロントエンド | Cowork可（1・2マージ後、APIが固まってから） | 既存APIを呼ぶだけの独立作業 |
| 4. 法務文言 | Cowork・文言確定済みなので即日可 | LP1ファイルの追記のみ、legal-finance照合つき |
| 5. EXEMPT運用ドキュメント | Cowork・即日可 | 文書のみ、独立、失敗しても無害 |
| 6. デプロイ・検証 | オーナー＋対話セッション | 本番作業 |

**⚠️ 区切り1・2は夜勤（無人・定期実行）の対象外。** `docs/office_map.html` の軍令帳に本件を急務として積む際、「夜勤対象外（普請はセッション実施）」と明記すること（付けないと夜勤が区切り1を無断で開始しうる。CLAUDE.md「🌙 夜勤の掟」4番＝1回1件までのルールはあるが対象選定までは制御しないため、この案件は明示的に除外する）。

区切り4・5の自己完結タスク指示書:
- `docs/cowork_shiji_admin_viewer_ku4_privacy_2026-08-26.md`
- `docs/cowork_shiji_admin_viewer_ku5_exempt_docs_2026-08-26.md`

### 区切り1: バックエンド基盤（管理者判定・アカウント一覧API）

- `backend/admin_guard.py` 新設（`ADMIN_USER_IDS` 判定＝Supabaseユーザーの UUID。メールでは判定しない。§10 Q3参照）
- `backend/supabase_admin.py` 新設（`account.py` の鍵形式判定ロジックを切り出し、Admin API のユーザー一覧取得を追加）
- `backend/routers/admin.py` 新設。`GET /api/admin/accounts` のみ（一覧表示まで）
- `main.py` に `_admin` グループとルーター登録
- `.env.example` に `ADMIN_USER_IDS`（例: Supabase の Authentication → Users で対象ユーザーのUUIDをコピーする手順つき）の例を追記
- 検証: `GET /api/security-status` で `admin_view_sessions` がまだ存在しないので対象外（区切り2で追加）。管理者以外のアカウントで `/api/admin/accounts` が403になることを確認

### 区切り2: 閲覧モード本体（セッション開始・終了・view-as上書き・読み取り専用強制）

- `models.py` に `AdminViewSession` 追加、`migrations._USER_SCOPED_TABLES` 登録
- `POST /api/admin/view-sessions` / `POST /api/admin/view-sessions/{id}/end` / `GET /api/admin/view-sessions`
- `backend/auth.py` の `UserContextMiddleware` を拡張（§4-2の7番。`is_admin_user_id(user.id)` で再チェック）
- 検証: 管理者トークンで閲覧開始 → 対象アカウントの `GET /api/dashboard` 等が対象データを返す → 同トークンで `POST /api/targets` 等が403 → `GET /api/security-status` で `admin_view_sessions` がRLS保護対象に含まれることを確認

### 区切り3: フロントエンド（Cowork可・1と2のマージ後）

- `AdminAccounts.tsx` / `adminView.ts` / `AdminViewBanner.tsx` 新設、`App.tsx` にルート追加、`api.ts` の `authHeaders()` 拡張
- 検証: ヘッドレスブラウザで一覧表示 → 閲覧開始 → バナーに「読み取り専用」の文言が表示される → 既存ページ（ダッシュボード等）が対象アカウントのデータで表示される → 保存操作でエラーメッセージ表示 → 「閲覧を終了」→ バナー消滅・自分のデータに戻ることを確認

### 区切り4: 法務文言（Cowork委任・即日可）

- `lp/privacy.html` への追記。文言は§7で確定済み（§10も参照）
- 実装対象はLPのみ（アプリ内に法的ページを複製しない、の原則どおり）
- 詳細は `docs/cowork_shiji_admin_viewer_ku4_privacy_2026-08-26.md` を参照

### 区切り5: EXEMPT_TEST_EMAILS運用ドキュメント化（Cowork委任・即日可、他の区切りと独立）

新規ファイル `docs/unyou_exempt_test_emails.md` に以下を記載する:

- **追加手順（オーナー作業）**: Render ダッシュボード → 対象サービスの Environment → `EXEMPT_TEST_EMAILS` を編集（既存値にカンマ区切りで追記）→ 再デプロイ（Renderは環境変数変更時に自動再起動する構成だが、手動デプロイが必要な場合の手順も明記）
- **削除手順**: 同様にダッシュボードから該当メールを削除 → 再デプロイ。**削除を忘れると、そのメールの受信箱を持つ人がずっと無料で使える状態が続く**ことを明記（既存のCLAUDE.md記載事故の教訓を反映）
- **台帳ルール**: 同ファイル内に表形式の台帳を置く（列: 追加日 / メールアドレス / 目的 / 追加した人 / 削除予定日 / 削除日）。**現在設定されている `demo@ureshiru.com` を台帳の最初の行として記録する**（2026-07-30導入、目的=トライアル運用テスト、削除予定=無期限運用のため空欄）
- CLAUDE.mdの既存 `EXEMPT_TEST_EMAILS` 行に、この新ドキュメントへの参照を1行追記する
- 詳細は `docs/cowork_shiji_admin_viewer_ku5_exempt_docs_2026-08-26.md` を参照

### 区切り6: 本番デプロイ・検証・オーナー目視

- 本番で `admin@ureshiru.com` を作成（Supabase側でオーナーが作業。パスワードは長いランダム値・オーナーのパスワードマネージャーのみに保存、`demo@ureshiru.com` とは使い回さない。Stripe契約は不要＝`_paid` 対象外のため）
- 作成後、Supabase の Authentication → Users で当該ユーザーのUUIDを控え、本番envに `ADMIN_USER_IDS=<UUID>` を設定
- 実際に `demo@ureshiru.com`（または任意の実データ入りアカウント）を選んで閲覧を開始し、ダッシュボード・GAP分析等が正しく表示されること、保存系操作が403になること、閲覧終了後に管理者自身の画面に戻ることを実機確認
- `GET /api/security-status` で `admin_view_sessions` を含め `unprotected` が空であることを確認

---

## 9. 評定結果（確定・2026-08-26）

全7問、推奨案どおり2件を変更して確定。実装可。

| # | 論点 | 確定内容 | 推奨案からの変更 |
|---|---|---|---|
| Q1 | 閲覧セッションの自動失効時間 | **2時間**（オンボーディング1回分に十分、閉じ忘れても自動で切れる長さ） | なし |
| Q2 | 書き込みボタンの個別disabled化 | **見送り。バックエンド403のみ。** ただし閲覧バナーに「読み取り専用」を明記する（§6に反映済み） | バナー文言の明記を必須要件として追加 |
| Q3 | 管理者専用ナビの要否／管理者判定方式 | `/admin` 直接アクセスのみ。**管理者判定はメールではなくSupabaseユーザーUUIDを環境変数（`ADMIN_USER_IDS`）で固定**（メールは変更・取り違えの余地があるため） | 判定方式をメール（`ADMIN_EMAILS`）からUUID（`ADMIN_USER_IDS`）に変更（§3・§4-2・§8に反映済み） |
| Q4 | `AdminViewSession` の `sample_data.py` 対象除外 | **除外でOK** | なし |
| Q5 | `lp/privacy.html` 追記文言 | 「サポート対応および導入支援の目的で、当方の担当者が利用者の登録データを閲覧する場合があります。閲覧は必要な範囲に限り、閲覧記録を保存します。」に確定（§7参照） | 文言を差し替え（監査ログの存在まで明記し、機能の実態と一致させた） |
| Q6 | EXEMPT_TEST_EMAILS台帳の置き場所 | **独立ドキュメント**（`docs/unyou_exempt_test_emails.md`）。CLAUDE.mdには参照ポインタ1行のみ | なし |
| Q7 | `admin@ureshiru.com` の作成方法 | **Supabase側でオーナーが手動作成**。パスワードは長いランダム値、オーナーのパスワードマネージャーのみに保存、`demo@ureshiru.com` とは使い回さない | なし（作成時の運用注意を追記） |

**区切り・担当割り当てとCowork委任の方針は §8 を参照。** 区切り1・2は対話セッション専任、区切り3はAPI確定後にCowork可、区切り4・5はCowork委任・即日実施（自己完結のタスク指示書あり）。区切り1・2を無人実行に出さない理由: RLS・認証まわりの変更は「作りながら判断が発生する」性質があり、PRゲートだけで受けるにはリスクが高いとオーナーが判断したため。
