# セキュリティチェック 2026-09-07（週次定例）

対象範囲: 前回チェック（2026-08-31、`security/security_check_2026-08-31.md`。本体分
`4d08d97`、オーナー指摘への追記込みの確定コミット `0728ad4`）以降の
**`0728ad4..453bb72`（47コミット）**。管理画面からの無償アカウント招待（メール送信つき）
の区切り1〜4完了、招待メールのHTML化・自社ドメインリンク化、課金設定の診断パネルの
管理者限定化、マルウェアスキャンの適用漏れ解消（`costs.py`含む5箇所）、LPリニューアル(2a)
後続対応、マスタ削除一括化 区切り3が中心。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- 前回の未解決2件を再確認した。いずれも維持（詳細はフォローアップ表）。
  - CSVエクスポートのCSVインジェクション対策（中・クローズ済み）… 退行なし。
  - 新設CSVインポート3本のファイルサイズ上限欠如（低・継続監視）… 対象範囲に変化なし。
- 今回の主眼である**管理画面からの無償アカウント招待機能**（`POST /api/admin/invites`・
  `POST /api/admin/invites/{id}/resend`）と**課金診断パネルの管理者限定化**
  （`GET /api/billing/diagnose`）は、ローカルで実際にJWTを発行し（自作HS256トークン・
  `TestClient`によるアプリ内実行）、書き込み系2本を含む多数の境界条件を実測した。
  想定どおりの拒否・許可が得られ、**新規の高/中指摘なし**。
- **新規指摘（低）1件**: 招待の`email`フィールドの形式検証が緩く（`"@"`が含まれるかのみ）、
  今回追加された新しいシンク（SMTPの`To`ヘッダ・エンベロープ受信者）に到達する。実際に
  CRLFを含むメールアドレスで送信を試みたところ、Pythonの`email`/`smtplib`標準ライブラリの
  組込み保護（`HeaderParseError`・`ValueError`）により**送信前に例外化され実害はない**こと
  を実測で確認済みだが、アプリケーション側の入力検証としては薄いため、多層防御の観点で
  指摘する（詳細は新規指摘節）。
- マルウェアスキャン（`scan_bytes`）の新規適用5箇所（`costs.py`含む）は前回チェック後の
  2026-09-02〜03に実装・本番実測まで完了済み（CLAUDE.md記録）。今回は退行なしをコードで
  確認。
- `npm audit --package-lock-only`で**新規に2件（high 1・low 1）を検出**（`browserslist`・
  `postcss-selector-parser`）。これは`package-lock.json`が前回チェック以降1コミットも
  変更されていないことを確認済みのため、**コード変更によるものではなく、npm advisory
  データベース側に新しく登録された脆弱性情報**（advisory ID推定: `1153170`〜`1153172`）
  によるもの。両方ともビルド時ツール（PostCSS/Autoprefixer経由の依存）で、アプリの
  実行時（本番サーバー・ブラウザ配信物）には含まれない。修正版が`npm audit fix`で
  利用可能。
- `pip-audit`… **0件**。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-08-31時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・クローズ済み（退行なし確認済み） | `masters.py`（カテゴリ・商品export）・`item_targets.py`・`export.py`の4箇所とも`csv_safe_cell()`呼び出しが健在（grep確認、diffなし）。`targets.py`も対象外の明記を維持 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | 今回の47コミットで新規CSVインポートエンドポイントの追加なし。`masters.py`/`targets.py`/`item_targets.py`とも`await file.read()`にサイズ上限チェックなしのまま変化なし | 継続監視（変化なし） |
| npm audit: react-router系（解決済み） | 解決済み | package.jsonの`react-router-dom: ^7.18.2`は変更なし。今回の`npm audit`結果に react-router 系の再発なし | 維持 |
| CSPヘッダー（解決済み） | 解決済み | `backend/main.py`の`_CONTENT_SECURITY_POLICY`にdiffなし、`script-src 'self'`健在 | 維持 |
| マルウェアスキャンのカバレッジ漏れ（前回チェック後の2026-09-02〜03に解消・記録） | 前回チェック時点で本件はまだ発生前 | `masters.py`（カテゴリ・商品import）・`item_targets.py`・`targets.py`・`costs.py`の5箇所すべてで`scan_bytes()`呼び出しが健在（grep確認）。`import_csv.py`側の既存4箇所も含め計9箇所すべて確認 | ✅ 維持（対応済み、退行なし） |

## 新規指摘

### 低: 招待メールの宛先（`email`）フィールドの形式検証が薄く、新設のSMTP送信シンクに直接到達する

**再現手順（ローカル、`TestClient`で実施）**:

```python
from routers.admin_comp import _validate_email_note
_validate_email_note("evil@example.com\r\nBcc: victim@example.com", "note")
# -> ("evil@example.com\r\nbcc: victim@example.com", "note")  # 例外にならず通過する
```

この値は`POST /api/admin/invites`経由で`notifications.send_invite(email=...)`に渡り、
`smtplib.SMTP.sendmail(user, [to], msg.as_string())`の`to`（エンベロープ受信者）と
`msg["To"]`（ヘッダ）の両方に使われる。**招待機能はこの週の新機能で、`email`フィールドが
実際のSMTP送信の宛先として使われるのは今回が初めて**（従来の`POST /api/admin/comp-grants`
では`email`はDB保存とSupabase Admin APIのJSON body参照にしか使われず、生のSMTPプロトコルへは
渡っていなかった）。

**実機検証（ローカル、`smtplib.SMTP`をスタブに差し替えて実施）**: 上記のCRLFを含む
アドレスで実際に`notifications.send_invite()`を呼んだところ、`msg.as_string()`の時点で
Pythonの`email`ライブラリが`HeaderParseError: header value appears to contain an embedded
header`を送出して例外化された。仮にヘッダ側をすり抜けても、`smtplib.SMTP.putcmd()`が
CRLFを含むコマンド引数を検出すると`ValueError`を送出する保護がPython 3.7系以降に
組み込まれている（本番は`Dockerfile`で`python:3.12-slim`を使用しており対象）。
`admin_comp.py::_send_invite_mail()`はこの例外を`except Exception`で捕捉し、
`invite_status="failed"`にして502を返す設計のため、**この経路は実際には悪用できない
ことを実測で確認した**。

**影響**: 現時点で実害はない（Pythonの標準ライブラリの保護により送信前に失敗する）。
ただし、この保護は「アプリケーションが意図して入れた検証」ではなく「たまたま依存
ライブラリが持っていた保護」であるため、①将来ライブラリの実装が変わった場合や、
②`msg["To"]`を経由しない別の送信経路（例: 将来SendGrid等のAPI送信へ切り替える場合、
多くのメール送信APIはヘッダインジェクションを自前でチェックしない）に切り替えた際、
無防備になる可能性がある。呼び出し元は`require_admin_write`（管理者限定）のため、
実際に悪用するには既に管理者権限が必要であり、深刻度は低い。

**対策案**: `_validate_email_note()`に、`@`の有無だけでなく制御文字（`\r`・`\n`・`\0`等）
を拒否する簡単なチェック（例: `if any(c in email for c in "\r\n\x00"): raise ...`)、または
`^[^\s@]+@[^\s@]+\.[^\s@]+$`程度の正規表現を追加することを推奨する。多層防御の観点での
改善であり、緊急対応は不要と判断する。

## 差分カバレッジ節（必須）

| コンポーネント | 検証方法 | 結果 |
|---|---|---|
| `GET /api/billing/diagnose`（`require_admin`化） | ローカル実測（`TestClient`＋自作HS256 JWT） | 非管理者403「管理者権限がありません。」／管理者200 |
| `GET /api/billing/status`の`is_admin`フラグ追加 | ローカル実測 | 非管理者`is_admin: false`／管理者`is_admin: true` |
| `POST /api/admin/invites`（新設・招待作成） | ローカル実測（`supabase_admin`/`notifications`をフェイクに差し替え） | 非管理者403／`SUPABASE_SERVICE_ROLE_KEY`未設定501／正常系200（Supabase新規ユーザー作成＋`_grant_comp`共有ロジック経由でcomp付与＋メール送信）／既存登録メール409／note空400／email長超過(201文字)400／message長超過(1001文字)400／`hashed_token`欠如時502／メール送信失敗時502＋`invite_status=failed`でグラントは残存／閲覧モード中（`X-Admin-View-Session`ヘッダ）403 |
| `POST /api/admin/invites/{id}/resend`（新設・再送） | ローカル実測 | 非管理者403／閲覧モード中403／60秒以内の連投429／招待経由でない直接付与グラントへの再送400／存在しない/解除済みID 404／メール失敗後の再送で`invite_status`が`sent`に復帰 |
| `GET /api/admin/comp-grants`一覧の`invited_at`/`invite_status`追加 | ローカル実測 | 200、招待経由の行にのみ値が入り、直接付与は両方`null` |
| `_build_invite_link()`（自社ドメインリンク組み立て） | コードレビュー＋ローカル実測 | フェイクの`generate_link`応答（`hashed_token`あり）から`http://localhost:5173/invite?t=...`形式のリンクを構築し、送信されたメール本文に`supabase.co`が含まれないことを確認 |
| `supabase_admin.generate_link()`のトップレベル`id`/`hashed_token`平坦化対応（2026-09-01/04の修正） | コードレビューのみ（実Supabase未接続） | 2026-09-04にオーナーが本番で実招待メール送信〜`verifyOtp`〜ログインまで一気通貫で確認済み（CLAUDE.md記録）。今回のセッションはSupabase未接続のためコードレビューに留める |
| `notifications.send_invite()` / `mail_templates.py`（HTML化・multipart） | ローカル実測 | `smtplib.SMTP`をスタブ化し、text/plain＋text/htmlの2パートが生成されること、メッセージ差し込み欄が`html.escape()`されること、招待の`email`フィールドがCRLF注入シンクとして機能するがPython標準ライブラリの保護で例外化されることを確認（新規指摘・低として記載） |
| フロント`/invite`ルート（`App.tsx`、BrowserRouterマウント前の状態分岐・`verifyOtp`呼び出し） | コードレビュー＋ビルド確認のみ（本番URL疎通不可のため） | `npm run build`型エラー0。実際の`verifyOtp`実行・Supabaseセッション確立の動作は2026-09-04にオーナーが本番で実施済み（CLAUDE.md記録）。今回のセッションからは追試不可 |
| `ResetPassword.tsx`の`isInvite`分岐 | コードレビューのみ | 表示文言のみの分岐で、認証・パスワード設定処理自体（`supabase.auth.updateUser`）は既存の再設定処理をそのまま流用しており変更なし |
| マルウェアスキャン新規5箇所（`masters.py`カテゴリ/商品import・`item_targets.py`・`targets.py`・`costs.py`） | コードレビュー（grep）＋ローカル実測（アップロード時に`scan_bytes`が呼ばれ、キー未設定環境でno-op経由のまま従来どおりの応答が返ることを確認） | 5箇所とも健在、退行なし |
| `AdminAccounts.tsx`招待UI（送信前プレビュー・招待列・再送ボタン） | コードレビューのみ | `dangerouslySetInnerHTML`不使用、`<pre>{...}</pre>`でReactの自動エスケープに乗るためXSSリスクなし |
| `comp_grants`テーブルへの列追加（`invited_at`/`invite_status`） | コードレビュー | 新規テーブルではなく既存の`UserScopedMixin`継承テーブルへの列追加のみのため、RLS適用状況に変化なし（本番Postgresでの再実測は今回不要と判断） |
| RLS（新規テーブルの有無） | コードレビュー | 今回の47コミットで新規モデル追加なし（既存テーブルへの列追加のみ）。`GET /api/security-status`の本番再実測は不要と判断 |
| npm audit / pip-audit | コマンド実行 | npm auditは新規2件（high 1・low 1、依存関係のコード変更起因ではなくadvisory新規登録）、pip-auditは0件 |
| 本番URLへの疎通確認 | 実測（失敗） | `curl -sS -m 10 https://app.ureshiru.com/api/health` → プロキシに`403 gateway policy denial`で拒否され疎通不可。本番実測はすべて範囲外（CLAUDE.md「セッション環境の注意」節のとおり） |

## 精査した観点（チェックリスト）

- **RLS**: 新規テーブル追加なし（`comp_grants`への列追加2つのみ）。既存のRLS適用状況に
  影響なし。
- **認証と課金ガード**: `GET /api/billing/diagnose`が`get_current_user`から
  `admin_guard.require_admin`へ変更（管理者限定化）。`is_admin`フラグは表示の出し分け
  専用で、実際のアクセス制御は`diagnose`自体の`require_admin`が担う設計（CLAUDE.md記載の
  設計方針どおり、コードでも確認）。`_paid`グループ（`masters`/`targets`/`item_targets`/
  `export`）に変更なし。
- **管理者判定・閲覧モードの読み取り専用強制**: `POST /api/admin/invites`・
  `POST /api/admin/invites/{id}/resend`ともに`require_admin_write`（既存のcomp-grants
  付与・解除と同じ依存関係）を使っており、閲覧モード中は両方とも403で拒否されることを
  実測。新設の書き込みエンドポイント2本ともに漏れなく検証した。
- **Stripe**: `stripe.Webhook.construct_event`使用箇所に diff なし。`EXEMPT_TEST_EMAILS`・
  `TRIAL_WITHOUT_CARD`に変更なし。
- **SPA配信**: `_serve_spa`／`realpath`チェックに diff なし。
- **例外ハンドラ**: `global_exception_handler`／`EXPOSE_ERROR_DETAIL`に diff なし。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY`に diff なし（`script-src 'self'`健在）。
- **入力上限**: 招待の`email`（200文字）・`message`（1000文字）はサーバ側手動チェックで
  上限あり（実測済み）。`email`の形式検証自体は`"@"`の有無のみで薄い（上記新規指摘）。
- **CSVインジェクション**: 退行なし（フォローアップ表参照）。
- **マルウェアスキャン**: 新規5箇所の適用を確認、退行なし。
- **オープンリダイレクト**: `_build_invite_link()`が組み立てるリンクの遷移先は
  `B.app_base_url()`（env `APP_BASE_URL`固定値）＋固定パス`/invite`のみで、リクエスト由来の
  値を宛先に使っていない。フロント側の`window.history.replaceState(null, '', '/')`も
  固定文字列。オープンリダイレクトのリスクなし。
- **秘密情報の残置**: `git diff 0728ad4..HEAD`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし該当なし（`SUPABASE_SERVICE_ROLE_KEY`という変数名の言及のみで実値なし）。
- **XSS**: `mail_templates.invite_body_html()`は`email`/`invite_link`/`expires_label`/
  `message`すべてを`html.escape()`してから埋め込んでおり、改行のみ意図的に`<br>`へ変換。
  フロントの招待プレビューもReactの自動エスケープに乗る実装（`dangerouslySetInnerHTML`
  不使用）。

## 実行したコマンドと結果

```
$ git log --oneline 0728ad4..HEAD | wc -l
47

$ git diff --stat 0728ad4..HEAD -- backend frontend | tail -1
19 files changed, 952 insertions(+), 79 deletions(-)

$ cd frontend && npm install && npm audit --package-lock-only
2 vulnerabilities (1 low, 1 high)
  browserslist  <=4.28.6  high  GHSA-c83g-rgw3-j3cx / GHSA-73wf-gq98-2v4g
  postcss-selector-parser  6.1.0 - 6.1.2  low  GHSA-w9m9-85wc-3x92
  fix available via `npm audit fix`
（package-lock.json自体は前回チェック以降diffなし＝コード変更起因ではなくnpm advisory
  データベース側の新規登録。ビルド時ツールのみで実行時配信物には含まれない）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（dist/assets/index-*.js 951.52kB, index-*.css 47.28kB）

$ cd backend && pip install -r requirements.txt -q && pip install pip-audit -q && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd backend && python3 -c "from main import app; print('OK')"
OK

# TestClient + 自作HS256 JWT によるアプリ内実行テスト（同一プロセス内、SQLite一時DB）
$ python3 test_admin.py（要旨、詳細は上表参照）
non-admin GET /api/billing/diagnose            -> 403 管理者権限がありません。
admin     GET /api/billing/diagnose            -> 200
non-admin GET /api/billing/status .is_admin    -> False
admin     GET /api/billing/status .is_admin    -> True
POST /api/admin/invites (未configured)          -> 501
POST /api/admin/invites (non-admin)             -> 403
POST /api/admin/invites (happy path)            -> 200, invite_link に supabase.co を含まない
POST /api/admin/invites (既存登録メール)          -> 409
POST /api/admin/invites (note空)                -> 400
POST /api/admin/invites (message 1001文字)       -> 400
POST /api/admin/invites (email 200文字超)        -> 400
POST /api/admin/invites (hashed_token欠如)       -> 502
POST /api/admin/invites (SMTP送信失敗)           -> 502, invite_status=failed でグラント残存
POST /api/admin/invites (X-Admin-View-Session)  -> 403
POST /api/admin/invites/{id}/resend (60秒以内)   -> 429
POST /api/admin/invites/{id}/resend (直接付与)   -> 400
POST /api/admin/invites/{id}/resend (存在しないID)-> 404
POST /api/admin/invites/{id}/resend (non-admin) -> 403
POST /api/admin/invites/{id}/resend (view-mode) -> 403
POST /api/admin/invites/{id}/resend (失敗後再送) -> 200, invite_status=sent に復帰

$ python3 -c "from routers.admin_comp import _validate_email_note; print(_validate_email_note('evil@example.com\r\nBcc: victim@example.com','note'))"
('evil@example.com\r\nbcc: victim@example.com', 'note')   # 例外にならず通過（新規指摘）

$ python3 -c "（smtplib.SMTPをスタブ化してnotifications.send_inviteを実行）"
Exception raised (blocked): HeaderParseError header value appears to contain an embedded header

$ grep -n csv_safe_cell backend/routers/{masters,item_targets,export,targets}.py backend/csv_utils.py
（4箇所とも健在、退行なし）

$ grep -rn "UploadFile" backend/routers/*.py backend/*.py | wc -l
9
$ grep -n scan_bytes backend/routers/{masters,item_targets,targets,costs}.py backend/routers/import_csv.py
（9箇所すべて健在）

$ curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://app.ureshiru.com/api/health
（接続失敗: CONNECT tunnel failed, response 403。本番実測は範囲外）

$ git diff 0728ad4..HEAD | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（変数名の言及のみ、実値なし）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- 本番Render環境変数（`ADMIN_USER_ID`・`APP_BASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・
  `CLOUDMERSIVE_API_KEY`等）の実際の設定値。CLAUDE.mdの記録によれば
  `CLOUDMERSIVE_API_KEY`は2026-09-02にオーナーが設定・2026-09-03に本番実測済み。
- 本番Supabaseでの`generate_link()`実レスポンス形状・`verifyOtp`の実動作・実際に届く
  招待メールの表示（Gmail等）は、2026-09-04にオーナーが本番で一気通貫の実施・確認済み
  （CLAUDE.md記録）。今回のセッションは本番URL・Supabaseいずれにも疎通できないため
  追試していない（上表のとおり明記）。
- `GET /api/security-status`の本番Postgresでの再実測は、今回新規テーブル追加が無い
  （既存テーブルへの列追加のみ）ため不要と判断し実施していない。
- Supabaseダッシュボードの表示プラン（Free Plan表示の食い違い、2026-08-31にCLAUDE.mdへ
  記録済みの未解決事項）はセキュリティ機能自体には影響しないインフラ確認事項のため、
  本チェックのスコープ外として扱う（オーナー確認待ちのまま）。

## 総括

新規指摘は**高0件・中0件・低1件**（招待メールの`email`フィールドの形式検証が薄く、
新設のSMTP送信シンクに到達する。実際には言語標準ライブラリの保護で例外化され実害は
現状ないことを実測確認済みだが、多層防御として`_validate_email_note()`への制御文字
チェック追加を推奨）。前回の未解決2件はいずれも維持（CSVインジェクション対策はクローズ済み
で退行なし、CSVインポートのサイズ上限欠如は継続監視のまま）。今回重点確認とした招待機能・
課金診断パネルの管理者限定化は、書き込み系エンドポイント2本（招待作成・再送）を含む
すべての新設コンポーネントについて実測または相応の検証を行い、権限境界・読み取り専用
強制・入力上限・XSS対策のいずれも設計どおりの挙動を確認できた。マルウェアスキャンの
新規適用5箇所・CSVインジェクション対策4箇所とも退行なし。`npm audit`は依存関係の新規
advisory登録により2件（high 1・low 1、いずれもビルド時ツールで実行時配信物には
含まれない）を検出したが、コード変更に起因するものではない。`pip-audit`は0件。
本番URLへの疎通は本セッションからは不可（プロキシに拒否）のため、本番実測が必要な項目は
すべて「範囲外」または「オーナーが別途実施済みの記録を参照」として明記した。
