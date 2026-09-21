# セキュリティチェック 2026-09-21（週次定例）

対象範囲: 前回チェック（2026-09-14、`security/security_check_2026-09-14.md`。本体分
`1680773`、確定コミット `acdb21f`）以降の **`acdb21f..75ed010`（12コミット）**。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- **`backend/`・`frontend/`・`lp/` のソースコード変更は0件。** `git diff --stat
  acdb21f..HEAD` を実際に実行し、変更ファイルが以下9件のみであることを確認した
  （憶測ではなくコマンド実行結果に基づく）: `docs/gunrei_kouho.md`・
  `docs/office_map.html`・`docs/sagyou_houkoku_yakin_2026-09-{14,15,16,17,18}.md`
  （5件）・`security/index.md`（1行）・`security/security_check_2026-09-14.md`
  （前回報告書自体、`git diff --stat`にも1件としてカウントされる）。`git log
  acdb21f..HEAD`の12コミットはすべて夜勤（無人・定期実行）による巡回記録・軍令帳
  更新のみで、アプリケーションコードの変更は無い。
- したがって前回チェック時点の権限境界・入力検証・CSVインジェクション対策・
  マルウェアスキャン・RLS適用状況・CSPヘッダー・Stripe Webhook検証はすべて
  **変更なし＝退行なし**。前回の未解決2件（低）も対象範囲に変化なし。
- `npm audit`は今回も**3件（high 1・moderate 1・low 1）を検出**。前回
  （2026-09-14）検出した3件（`browserslist`=high、`baseline-browser-mapping`
  =moderate、`postcss-selector-parser`=low）と**完全に同一**。
  `frontend/package-lock.json`は対象範囲（`acdb21f..HEAD`）で1コミットも変更
  されていないため、advisory側にも変化がないことになる。3件とも
  `package-lock.json`上で`dev: true`（devDependencies配下）のビルド時ツール
  （PostCSS/Autoprefixer/Tailwindの依存チェーン）にのみ関与し、本番の実行時
  配信物（`dist/`）には含まれない。
- `pip-audit`… **0件**（前回と同じ）。
- `python3 -c "from main import app"` … OK。`npm run build` … tsc型エラー0、
  vite build成功（`dist/assets/index-B9EA3kwc.js` 951.52kB /
  `index-vZxdomaG.css` 47.28kB。**前回のハッシュと完全一致**＝フロントの
  成果物が一切変わっていないことの裏付け）。
- ローカル起動（SQLite・`AUTH_ENABLED=false`）で `GET /api/security-status`
  を実測: `{"dialect":"sqlite","applicable":false,"protected":[],
  "unprotected":[],"ok":true,"malware_scan_active":false}`。新規モデル追加は
  0件のため`backend/models.py`にdiffが無いことも確認済み。RLSは元々
  Postgres専用機構のためローカルSQLiteでは`applicable:false`が正常（本番
  Postgresでの再実測は、新規テーブル追加が無いため今回は不要と判断）。
- 本番URLへの疎通は今回も不可（`curl`がエージェントプロキシに
  `CONNECT tunnel failed, response 403`で拒否される）。CLAUDE.md「セッション
  環境の注意」節のとおり、本番実測は範囲外として扱う。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-09-14時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・クローズ済み（退行なし確認済み） | `backend/`に対象範囲内でdiffなし（コミット自体が0件）。`csv_safe_cell()`呼び出し箇所は前回と同一 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | 今回の12コミットはすべてドキュメント・運用系で、CSVインポート関連の変更なし。**なお2026-09-18の夜勤巡回が`costs.py`の原価率CSV一括登録にも同型の欠陥（サイズ上限無し）を発見し`docs/gunrei_kouho.md`へ候補記録済み**（未昇格）。これはコード変更ではなく既存欠陥の発見漏れ拡張のため、本チェックの「対象範囲」自体には影響しない | 継続監視（変化なし。関連候補1件が軍令帳に追加されたのみ） |
| 招待メールの`email`フィールドの形式検証が薄い（CRLF注入シンク到達、実害はPython標準ライブラリの保護により無し） | 低・継続監視 | `backend/routers/admin_comp.py::_validate_email_note()`にdiffなし。対策案（制御文字チェック追加）は未実装のまま | 継続監視（変化なし） |
| npm audit: react-router系（解決済み） | 解決済み | `package.json`にdiffなし、react-router系の再発なし | 維持 |
| CSPヘッダー（解決済み） | 解決済み | `backend/main.py`にdiffなし | 維持 |
| マルウェアスキャンのカバレッジ漏れ（解決済み） | 解決済み | `masters.py`/`item_targets.py`/`targets.py`/`costs.py`/`import_csv.py`にdiffなし | 維持 |

## 新規指摘

**なし。** 対象範囲がドキュメント・運用系コミットのみのため、新規のコード起因の
指摘は発生していない。

なお対象範囲内の夜勤巡回（2026-09-14〜09-18の5回）が発見した候補
（`docs/gunrei_kouho.md`に記録済み、いずれも「候補・未昇格」）のうち、
セキュリティ／プライバシーの観点で軽視できないものを参考として1件だけ言及する
（**新規指摘としては扱わない**。理由は後述）:

- **2026-09-18発見・`backend/routers/account.py`の`_ALL_MODELS`**: 退会API
  （`DELETE /api/account`）の案内文言・docstringは「本人の全データを削除する」
  としているが、実際に削除されるのは`_ALL_MODELS`に列挙された7テーブルのみで、
  `UserScopedMixin`継承20テーブルのうち`Product`・`Shop`・`ItemTarget`・
  `ProductCost`等10テーブルが削除対象から漏れている（詳細は`gunrei_kouho.md`
  2026-09-18行）。**これを新規指摘として今回のチェックに追加計上しない理由**:
  (a) 発見自体はコード変更0件の対象範囲より前から存在する既存の実装状態であり、
  今回の差分によって生じた退行ではない、(b) 既に夜勤の巡回プロセスで発見・
  記録済みで、CLAUDE.md「🌙 夜勤の掟」9番目の規約どおり候補の昇格判断は
  オーナー専任のため、本チェックが重ねて昇格判断を行うと二重の意思決定経路に
  なる。**ただし内容自体（説明と実装の不一致・プライバシー上の含意）は妥当な
  指摘であり、次回オーナーが軍令帳を確認する際の優先度判断材料として記録に
  残す。**

## 差分カバレッジ節（必須）

今回はコード変更が0件のため、「新設・変更されたルーター・テーブル・ガード・
書き込みエンドポイント」自体が対象範囲に存在しない。念のため対象範囲の12
コミットすべての変更ファイルを列挙し、いずれもセキュリティ上の意味を持たない
ことを確認した。

| コンポーネント/変更 | 検証方法 | 結果 |
|---|---|---|
| `backend/`・`frontend/`・`lp/` 配下の全ファイル | `git diff --stat acdb21f..HEAD -- backend frontend lp` を実行 | 出力0行（変更なし）。ローカル実測で確認 |
| `docs/gunrei_kouho.md`（巡回候補10件の追加） | 内容全文を`Read`で確認 | いずれも「発見のみ・修正なし」の候補記録（招待メール有効期限表示の未実測、CLAUDE.md記載漏れ複数件、`.env.example`のマルウェアスキャンenv未記載、`migrations.py`のuser_id自動付与対象漏れ2テーブル、退会APIの削除範囲漏れ、`costs.py`のCSVサイズ上限欠如）。コード変更・権限変更・実装変更を一切伴わない | 対象外（ドキュメントのみ、権限昇格につながる記述なし） |
| `docs/office_map.html`（STATUS「守り」日付更新、QUESTS候補10件追加） | diff全文確認（`git diff acdb21f..HEAD -- docs/office_map.html`） | 静的HTMLの定数配列（`STATUS`/`QUESTS`/`AGENTS`のtalk文言）への追記・書き換えのみ。外部送信API・実行コードの変更なし。機密情報（キー・トークン・個人情報）の混入なし | 対象外（ドキュメントのみ） |
| `docs/sagyou_houkoku_yakin_2026-09-{14,15,16,17,18}.md`（新規作業報告5件） | grepで内容確認（「急務なし・巡回」等の記載パターン） | いずれも「急務なし・巡回のみ」の報告。実装を伴う変更の記載なし、mainへの直接push・外部ダッシュボード操作の記載なし | 対象外（ドキュメントのみ） |
| `security/index.md`（実施記録テーブルへの1行追加） | diff確認 | 前回チェック（2026-09-14）の実施記録追加のみ。過去の記録の書き換えなし | 対象外（索引更新） |
| npm audit / pip-audit | コマンド実行 | npm auditは前回と完全同一の3件（high1・moderate1・low1）。`package-lock.json`にdiffなし＝advisory側にも変化なし。pip-auditは0件（前回と同じ） |
| RLS（新規テーブルの有無） | コードレビュー（`git diff --stat`で`backend/models.py`にdiffなし）＋ローカル実測（`GET /api/security-status`） | 新規モデル追加なし。ローカルSQLiteで`applicable:false`・`unprotected:[]`・`ok:true`を確認。本番Postgresでの再実測は新規テーブル追加が無いため不要と判断 |
| 本番URLへの疎通確認 | 実測（失敗） | `curl -sS -m 10 https://app.ureshiru.com/api/health` → プロキシに`CONNECT tunnel failed, response 403`で拒否。本番実測は範囲外 |

## 精査した観点（チェックリスト）

- **RLS**: 新規テーブル追加なし（`models.py`にdiffなし）。ローカルで
  `GET /api/security-status`を実測しエラーなし。
- **認証と課金ガード**: `backend/routers/`配下にdiffなし。`require_admin`/
  `require_admin_write`の設計に変化なし。
- **Stripe**: `stripe.Webhook.construct_event`使用箇所にdiffなし。
- **SPA配信**: `_serve_spa`／`realpath`チェックにdiffなし。
- **例外ハンドラ**: `global_exception_handler`／`EXPOSE_ERROR_DETAIL`にdiffなし。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY`にdiffなし。
- **CSVインジェクション**: 退行なし（フォローアップ表参照）。
- **マルウェアスキャン**: 退行なし（フォローアップ表参照）。
- **秘密情報の残置**: `git diff acdb21f..HEAD`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし該当なし（前回報告書自身の本文中にパターン文字列が引用として出現する
  のみで実際の秘密情報ではないことを確認済み）。
- **夜勤ルールの遵守状況**: 対象範囲の12コミットに含まれる5回の夜勤実行
  （09-14/15/16/17/18）はいずれも「急務なし・巡回のみ」で、mainへの直接push・
  外部ダッシュボード操作・自己判断でのフォローアップタスク作成・候補の自己昇格
  は無いことをコミットログと作業報告書で確認した。

## 実行したコマンドと結果

```
$ git log --oneline acdb21f..HEAD | wc -l
12

$ git diff --stat acdb21f..HEAD -- backend frontend lp
（出力なし＝差分0）

$ git diff --stat acdb21f..HEAD
 docs/gunrei_kouho.md                    |  10 ++
 docs/office_map.html                    |  14 ++-
 docs/sagyou_houkoku_yakin_2026-09-14.md |  62 +++++++++++++
 docs/sagyou_houkoku_yakin_2026-09-15.md |  48 ++++++++++
 docs/sagyou_houkoku_yakin_2026-09-16.md |  43 +++++++++
 docs/sagyou_houkoku_yakin_2026-09-17.md |  48 ++++++++++
 docs/sagyou_houkoku_yakin_2026-09-18.md |  42 +++++++++
 security/index.md                       |   1 +
 security/security_check_2026-09-14.md   | 156 ++++++++++++++++++++++++++++++++
 9 files changed, 422 insertions(+), 2 deletions(-)

$ cd frontend && npm install && npm audit
3 vulnerabilities (1 low, 1 moderate, 1 high)
  baseline-browser-mapping  <2.11.0  moderate  GHSA-w5vr-8v7q-w6rv  (前回から継続、変化なし)
  browserslist  <=4.28.6  high  GHSA-c83g-rgw3-j3cx / GHSA-73wf-gq98-2v4g  (前回から継続、変化なし)
  postcss-selector-parser  6.1.0 - 6.1.2  low  GHSA-w9m9-85wc-3x92  (前回から継続、変化なし)
（package-lock.jsonは対象範囲でdiffなし＝前回から advisory 側にも変化なし。
  3件とも package-lock.json 上で dev:true＝ビルド時ツールで実行時配信物には
  含まれない）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（dist/assets/index-B9EA3kwc.js 951.52kB,
index-vZxdomaG.css 47.28kB）— 前回（2026-09-14）と完全に同一ハッシュ

$ cd backend && pip install -r requirements.txt -q && pip install pip-audit -q && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd backend && python3 -c "from main import app; print('OK')"
OK

$ cd backend && rm -f rakuten_kpi.db && AUTH_ENABLED=false python3 -m uvicorn main:app --host 127.0.0.1 --port 8010 &
$ curl -sS http://127.0.0.1:8010/api/security-status
{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,"malware_scan_active":false}
$ curl -sS -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8010/api/health
health:200

$ curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://app.ureshiru.com/api/health
（接続失敗: CONNECT tunnel failed, response 403。本番実測は範囲外）

$ git diff acdb21f..HEAD | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（実際の秘密情報としての該当なし。前回報告書本文中のgrepパターン引用文字列が
  2箇所ヒットするのみ）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- 本番Render環境変数（`ADMIN_USER_ID`・`APP_BASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・
  `CLOUDMERSIVE_API_KEY`等）の実際の設定値。前回チェックまでの記録どおり、いずれも
  オーナーが別途本番確認済み（CLAUDE.md記録）。
- `GET /api/security-status`の本番Postgresでの再実測は、今回新規テーブル追加が無いため
  不要と判断し実施していない。
- Supabaseダッシュボードの表示プラン（Free Plan表示の食い違い、2026-08-31にCLAUDE.mdへ
  記録済みの未解決事項）は引き続きオーナー確認待ちで、セキュリティ機能自体に影響しない
  インフラ確認事項のため本チェックのスコープ外。
- 上記「新規指摘」節で言及した退会API（`account.py`の`_ALL_MODELS`）の削除範囲漏れは、
  夜勤巡回が発見済みの候補（未昇格）であり、昇格・対応要否の判断はオーナー専任のため
  本チェックでは判断を下さない（記録の共有のみ）。

## 総括

新規指摘は**高0件・中0件・低0件**。対象範囲の12コミットはすべて夜勤（無人・定期実行）の
巡回記録・作業報告・軍令帳更新で、`backend`・`frontend`・`lp`のソースコードに一切変更が
無かった（`git diff --stat`で実際に確認）ため、前回チェック時点の権限境界・入力検証・
CSVインジェクション対策・マルウェアスキャン・RLS適用状況は退行なし。前回の未解決2件
（低。招待メールのemail形式検証・CSVインポートのサイズ上限）はいずれも対象範囲に変化が
ないため継続監視のまま持ち越す。`npm audit`は前回と完全同一の3件（high1・moderate1・
low1）で変化なし、`pip-audit`は0件。本番URLへの疎通は本セッションからは不可（プロキシに
拒否）のため、本番実測が必要な項目は前回同様「範囲外」または「オーナーが別途実施済みの
記録を参照」として扱った。
