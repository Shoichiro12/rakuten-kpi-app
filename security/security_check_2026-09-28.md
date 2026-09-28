# セキュリティチェック 2026-09-28（週次定例）

対象範囲: 前回チェック（2026-09-21、`security/security_check_2026-09-21.md`。確定コミット
`75ed010`）以降の **`75ed010..HEAD`（12コミット、現在HEAD `04f4a36`）**。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- **`backend/`・`frontend/`・`lp/` のソースコード変更は0件。** `git diff --stat
  75ed010..HEAD -- backend frontend lp` を実行し出力0行であることを実測確認した
  （前回チェックの要約を鵜呑みにせず、本チェックで独立に再実行して確認した）。
  変更ファイルは以下9件のみ: `docs/gunrei_kouho.md`・`docs/office_map.html`・
  `docs/sagyou_houkoku_yakin_2026-09-{21,22,23,24,25}.md`（5件）・
  `security/index.md`（1行）・`security/security_check_2026-09-21.md`（前回報告書
  自体、`git diff --stat`にも1件としてカウントされる）。`git log 75ed010..HEAD`の
  12コミットはすべて夜勤（無人・定期実行）による巡回記録・作業報告・軍令帳更新のみ
  （5回分の「急務なし・巡回のみ」報告とそのマージコミット）。
- したがって前回チェック時点の権限境界・入力検証・CSVインジェクション対策・
  マルウェアスキャン・RLS適用状況・CSPヘッダー・Stripe Webhook検証はすべて
  **変更なし＝退行なし**。前回の未解決2件（低）も対象範囲に変化なし。
- `npm audit`は今回も**3件（high 1・moderate 1・low 1）を検出**。前回
  （2026-09-21）検出した3件（`browserslist`=high、`baseline-browser-mapping`
  =moderate、`postcss-selector-parser`=low）と**完全に同一**。
  `frontend/package-lock.json`は対象範囲（`75ed010..HEAD`）で1コミットも変更
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
- マルウェアスキャン（`scan_bytes`）の呼び出しカバレッジを`grep`で全アップロード
  エンドポイント（`UploadFile`使用箇所5ファイル）に対し再実測し、9呼び出し
  （`import_csv.py`4箇所・`masters.py`2箇所・`item_targets.py`1箇所・
  `targets.py`1箇所・`costs.py`1箇所）すべて健在で漏れなし（前回と同一）。
- 本番URLへの疎通は今回も不可（`curl`がエージェントプロキシに
  `CONNECT tunnel failed, response 403`で拒否される）。CLAUDE.md「セッション
  環境の注意」節のとおり、本番実測は範囲外として扱う。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-09-21時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・クローズ済み（退行なし確認済み） | `backend/`に対象範囲内でdiffなし（コミット自体が0件）。`csv_safe_cell()`呼び出し箇所は前回と同一 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | 今回の12コミットはすべてドキュメント・運用系で、CSVインポート関連の変更なし。`costs.py`の同型欠陥（2026-09-18夜勤巡回が発見・軍令帳に候補記録済み）も引き続き未昇格のまま | 継続監視（変化なし） |
| 招待メールの`email`フィールドの形式検証が薄い（CRLF注入シンク到達、実害はPython標準ライブラリの保護により無し） | 低・継続監視 | `backend/routers/admin_comp.py::_validate_email_note()`の内容を今回も直接読み、`email.strip().lower()`・`"@" in email`・長さ上限のみでCRLF等の制御文字チェックが無いことを再確認。diffなし | 継続監視（変化なし） |
| npm audit: react-router系（解決済み） | 解決済み | `package.json`にdiffなし、react-router系の再発なし | 維持 |
| CSPヘッダー（解決済み） | 解決済み | `backend/main.py`にdiffなし | 維持 |
| マルウェアスキャンのカバレッジ漏れ（解決済み） | 解決済み | `masters.py`/`item_targets.py`/`targets.py`/`costs.py`/`import_csv.py`にdiffなし、`scan_bytes`呼び出し9箇所を`grep`で再実測し健在を確認 | 維持 |

## 新規指摘

**なし。** 対象範囲がドキュメント・運用系コミットのみのため、新規のコード起因の
指摘は発生していない。

なお対象範囲内の夜勤巡回（2026-09-21〜09-25の5回）が発見した新規候補
（`docs/gunrei_kouho.md`に記録済み、いずれも「候補・未昇格」、13件追加）のうち、
内容がドキュメント・エージェント知識ファイルの記述誤り（幽霊参照・出典の取り違え・
陳腐化した記述）に留まり、実装コード自体への影響が無いことを確認した。今回のチェック
時点でセキュリティ・プライバシー上の実害を持つ新規候補（前回の退会API`_ALL_MODELS`
削除範囲漏れのような実害系）の追加は見当たらない。既存の退会API関連候補は今回も
対象範囲外（コード変更なし）のため状態に変化はない。

## 差分カバレッジ節（必須）

今回はコード変更が0件のため、「新設・変更されたルーター・テーブル・ガード・
書き込みエンドポイント」自体が対象範囲に存在しない。念のため対象範囲の12
コミットすべての変更ファイルを列挙し、いずれもセキュリティ上の意味を持たない
ことを確認した。

| コンポーネント/変更 | 検証方法 | 結果 |
|---|---|---|
| `backend/`・`frontend/`・`lp/` 配下の全ファイル | `git diff --stat 75ed010..HEAD -- backend frontend lp` を実行 | 出力0行（変更なし）。ローカル実測で確認 |
| `docs/gunrei_kouho.md`（巡回候補13件の追加） | 内容全文を`Read`で確認 | いずれも「発見のみ・修正なし」の候補記録（qa.mdの管理者権限記載漏れ、office_map最終更新日の陳腐化、security-check SKILL.mdの二重管理指示の矛盾、CLAUDE.mdのDB移行記述の陳腐化、infra-ops.mdの旧Render/Vercel・EXEMPT_TEST_EMAILS記載漏れ、DEPLOY.mdの自己矛盾、kpi-analyst.mdのアクセス軸誤記、CLAUDE.mdのLP別リポジトリ誤記、privacy.htmlの旧Vercel委託先記載、designer.md/planner.md/CLAUDE.mdの幽霊参照、developer.mdのpytestコマンド不整合）。コード変更・権限変更・実装変更を一切伴わない | 対象外（ドキュメントのみ、権限昇格につながる記述なし） |
| `docs/office_map.html`（STATUS「守り」日付更新×2、「最終更新」コメント更新、QUESTS候補13件追加） | diff全文確認（`git diff 75ed010..HEAD -- docs/office_map.html`） | 静的HTMLの定数配列（`STATUS`/`QUESTS`/`AGENTS`のtalk文言）への追記・書き換えのみ。外部送信API・実行コードの変更なし。機密情報（キー・トークン・個人情報）の混入なし | 対象外（ドキュメントのみ） |
| `docs/sagyou_houkoku_yakin_2026-09-{21,22,23,24,25}.md`（新規作業報告5件） | 全文を`Read`で確認 | いずれも「急務なし・巡回のみ」の報告。実装を伴う変更の記載なし、mainへの直接push・外部ダッシュボード操作・自己判断でのフォローアップタスク作成の記載なし。各回のSTATUS自己点検（評定・守り・軍費）もオープンPR0件確認等の実測に基づく | 対象外（ドキュメントのみ） |
| `security/index.md`（実施記録テーブルへの1行追加） | diff確認 | 前回チェック（2026-09-21）の実施記録追加のみ。過去の記録の書き換えなし | 対象外（索引更新） |
| npm audit / pip-audit | コマンド実行 | npm auditは前回と完全同一の3件（high1・moderate1・low1）。`package-lock.json`にdiffなし＝advisory側にも変化なし。pip-auditは0件（前回と同じ） |
| RLS（新規テーブルの有無） | コードレビュー（`git diff --stat`で`backend/models.py`にdiffなし）＋ローカル実測（`GET /api/security-status`） | 新規モデル追加なし。ローカルSQLiteで`applicable:false`・`unprotected:[]`・`ok:true`を確認。本番Postgresでの再実測は新規テーブル追加が無いため不要と判断 |
| マルウェアスキャンカバレッジ（`scan_bytes`呼び出し） | `grep -rn "UploadFile"`で全アップロードエンドポイントを再列挙し、`scan_bytes(`呼び出しと1対1で対応することを実測 | 5ファイル・9呼び出しすべて健在。漏れなし（前回と同一） |
| 招待メールの`_validate_email_note()` | ソースを直接`Read`して制御文字チェックの有無を再確認 | 変化なし（未実装のまま、継続監視） |
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
- **マルウェアスキャン**: 退行なし（フォローアップ表参照。全9箇所を再実測）。
- **秘密情報の残置**: `git diff 75ed010..HEAD`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし該当なし（前回・前々回の報告書自身の本文中にパターン文字列が引用として
  出現するのみで実際の秘密情報ではないことを確認済み）。
- **夜勤ルールの遵守状況**: 対象範囲の12コミットに含まれる5回の夜勤実行
  （09-21/22/23/24/25）はいずれも「急務なし・巡回のみ」で、mainへの直接push・
  外部ダッシュボード操作・自己判断でのフォローアップタスク作成・候補の自己昇格
  は無いことをコミットログと作業報告書で確認した。

## 実行したコマンドと結果

```
$ git log --oneline 75ed010..HEAD | wc -l
12

$ git diff --stat 75ed010..HEAD -- backend frontend lp
（出力なし＝差分0）

$ git diff --stat 75ed010..HEAD
 docs/gunrei_kouho.md                    |  13 +++
 docs/office_map.html                    |  19 +++-
 docs/sagyou_houkoku_yakin_2026-09-21.md |  46 ++++++++
 docs/sagyou_houkoku_yakin_2026-09-22.md |  55 +++++++++
 docs/sagyou_houkoku_yakin_2026-09-23.md |  63 +++++++++++
 docs/sagyou_houkoku_yakin_2026-09-24.md |  45 ++++++++
 docs/sagyou_houkoku_yakin_2026-09-25.md |  27 +++++
 security/index.md                       |   1 +
 security/security_check_2026-09-21.md   | 195 ++++++++++++++++++++++++++++++++
 9 files changed, 461 insertions(+), 3 deletions(-)

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
index-vZxdomaG.css 47.28kB）— 前回（2026-09-21）と完全に同一ハッシュ

$ cd backend && pip install -r requirements.txt -q && pip install pip-audit -q && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd backend && python3 -c "from main import app; print('OK')"
OK

$ cd backend && rm -f rakuten_kpi.db && AUTH_ENABLED=false python3 -m uvicorn main:app --host 127.0.0.1 --port 8020 &
$ curl -sS http://127.0.0.1:8020/api/security-status
{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,"malware_scan_active":false}
$ curl -sS -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8020/api/health
health:200

$ grep -rn "UploadFile" backend/routers/*.py backend/*.py
（costs.py / import_csv.py / item_targets.py / masters.py / targets.py の5ファイル）
$ grep -rn "scan_bytes(" backend/routers/*.py backend/*.py
（9箇所すべて健在。詳細は差分カバレッジ節参照）

$ curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://app.ureshiru.com/api/health
（接続失敗: CONNECT tunnel failed, response 403。本番実測は範囲外）

$ git diff 75ed010..HEAD | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（実際の秘密情報としての該当なし。過去報告書本文中のgrepパターン引用文字列がヒットするのみ）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- 本番Render環境変数（`ADMIN_USER_ID`・`APP_BASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・
  `CLOUDMERSIVE_API_KEY`等）の実際の設定値。前回チェックまでの記録どおり、いずれも
  オーナーが別途本番確認済み（CLAUDE.md記録）。
- `GET /api/security-status`の本番Postgresでの再実測は、今回新規テーブル追加が無いため
  不要と判断し実施していない。
- Supabaseダッシュボードの表示プラン（Free Plan表示の食い違い、2026-08-31にCLAUDE.mdへ
  記録済みの未解決事項。2026-09-23夜勤巡回でも同種の候補が既存扱いとして言及されている）は
  引き続きオーナー確認待ちで、セキュリティ機能自体に影響しないインフラ確認事項のため本チェック
  のスコープ外。
- 夜勤巡回が発見した新規候補13件（ドキュメント記述の誤り・陳腐化・幽霊参照）は、いずれも
  実装コードへの影響が無いことを確認済みだが、昇格・対応要否の判断はオーナー専任のため
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
