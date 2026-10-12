# セキュリティチェック 2026-10-12（週次定例）

対象範囲: 前回チェック（2026-10-05、`security/security_check_2026-10-05.md`。確定コミット
`cff1640`）以降の **`cff1640..HEAD`（10コミット、現在HEAD `5e46890`）**。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- **`backend/`・`frontend/`・`lp/` のソースコード変更は0件。** `git diff --stat
  cff1640..HEAD -- backend frontend lp` を実行し出力0行であることを実測確認した。対象範囲の
  10コミットはすべて夜勤（無人・定期実行）による巡回記録・作業報告・軍令帳更新と、前回
  セキュリティチェック自体のマージコミット（PR #124）のみ（PR #125〜#128）。
- したがって前回チェック時点の権限境界・入力検証・CSVインジェクション対策（`csv_safe_cell()`）・
  マルウェアスキャンカバレッジ（`scan_bytes()`）・RLS適用状況・CSPヘッダー・Stripe Webhook検証・
  各種ガード（`require_admin`/`require_admin_write`/`_paid`等）は**すべて変更なし＝退行なし**。
- **新規指摘1件（低・情報提供）**: `npm audit` の検出数が前回の8件（high6・moderate1・low1）から
  **9件（high7・moderate2）に増加した。** `frontend/package-lock.json`自体は対象範囲でdiff 0行
  （依存関係は変更されていない）。原因は新規アドバイザリの連鎖で、具体的には
  (a) `source-map-js`（high、`GHSA-68fv-2mgg-jv7q`）が新規に検出された、
  (b) `postcss-selector-parser`の既存アドバイザリ（`GHSA-w9m9-85wc-3x92`、low）に加えて
  新規アドバイザリ（`GHSA-rj75-hqrm-r3gf`、moderate）が追加登録され、表示severityがlowから
  moderateへ上がった。詳細は「新規指摘」節。
- **訂正1件（低・報告の正確性）**: 過去複数回の報告書が `csv_safe_cell()` の呼び出し箇所数を
  「masters.py 6箇所・item_targets.py 1箇所・export.py 2箇所、計9箇所」としていたが、今回
  ソースを直接 `grep` で数え直したところ **masters.py は実際には7箇所**（`464`-`465`行目の
  `genre_u2`/`genre_u3`も対象列として含まれていたが過去の数え方では漏れていた可能性がある）
  で、**合計は10箇所**が正しい。`masters.py`は2026-09-02（コミット`95dd1b2`）以降コード変更が
  無いため、これはコード側の変化ではなく過去の報告書の集計誤りであり、カバレッジそのものに
  後退は無い（全箇所健在）。次回以降は10箇所を基準値として扱う。
- `pip-audit` … **0件**（前回と同じ）。環境側の制約で `python3`（3.11）と `pip`（3.13向け）の
  バージョンが分離されていたため、`/usr/bin/python3.13` を明示して実行・確認した。
- `python3.13 -c "from main import app"` … OK。`npm run build` … tsc型エラー0、vite build成功
  （`dist/assets/index-B9EA3kwc.js` 951.52kB / `index-vZxdomaG.css` 47.28kB。**前回と完全一致の
  ハッシュ**＝フロント成果物が一切変わっていないことの裏付け）。
- ローカル起動（SQLite・`AUTH_ENABLED=false`）で `GET /api/security-status` を実測:
  `{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,
  "malware_scan_active":false}`。新規モデル追加は0件（`backend/models.py`に対象範囲でdiffなし）。
- マルウェアスキャン（`scan_bytes`）の呼び出しカバレッジを `grep` で全アップロードエンドポイント
  （`UploadFile` 使用箇所5ファイル）に対し再実測し、9呼び出し（`import_csv.py`4箇所・
  `masters.py`2箇所・`item_targets.py`1箇所・`targets.py`1箇所・`costs.py`1箇所）すべて健在で
  漏れなし（前回と同一）。
- CSVインジェクション対策（`csv_safe_cell()`）の呼び出しも `masters.py`（7箇所）・
  `item_targets.py`（1箇所）・`export.py`（2箇所）、計10箇所で健在、漏れなし（前回報告の「9箇所」
  は上記のとおり集計誤りと判明。退行ではない）。
- オープンPRは0件（`gh api repos/Shoichiro12/rakuten-kpi-app/pulls?state=open`で確認）。
- 対象範囲10コミットの秘密情報残置チェック: `git diff cff1640..HEAD` 全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|
  password\s*=\s*['\"]` でgrepし、該当は「報告書本文に書かれた検索パターン文字列そのもの」のみ
  （実際のシークレット値は検出されず）。
- 本番URLへの疎通は今回も確認できず、`curl` が通らない環境だったため未実施（CLAUDE.md
  「セッション環境の注意」節のとおり、セッションごとにプロキシの許可状況が異なる）。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-10-05時点） | 今回の確認 | 判定 |
|---|---|---|---|
| 新設CSVインポート3本＋`costs.py`（計4〜5本）にファイルサイズ上限が無い | 低・継続監視 | `backend/routers/costs.py`の`import_costs()`を再読。`scan_bytes()`呼び出しの後も、依然ファイルサイズの上限チェックは無い（`content`の長さ判定なし）。対象範囲にdiffなし | 継続監視（変化なし） |
| 招待メールの`email`フィールドの形式検証が薄い（CRLF注入シンク到達、実害はPython標準ライブラリの保護により無し） | 低・継続監視 | `backend/routers/admin_comp.py::_validate_email_note()`を再読（76-85行）。`strip().lower()`・`"@" in email`・長さ上限のみで制御文字チェックは引き続き無し。diffなし | 継続監視（変化なし） |
| `npm audit`: `braces`（tailwindcss依存チェーン、スタック枯渇DoS）がhigh表示6件に増加 | 低・継続監視 | `package-lock.json`に対象範囲でdiffなし。`braces`チェーン自体の構成（braces/chokidar/micromatch/fast-glob/tailwindcss、計5件high）は不変。今回はこれに加え`source-map-js`（新規high）・`postcss-selector-parser`（severity上昇）が別途検出された（下記「新規指摘」参照） | 継続監視（対象は不変だが、別系統の新規アドバイザリが追加で検出されたため合計件数は増加） |
| npm audit: react-router系／CSP／マルウェアスキャンカバレッジ／CSVインジェクション対策（いずれも解決済み） | 解決済み | 対象ファイルに対象範囲内でdiffなし。`scan_bytes` 9箇所・`csv_safe_cell` 10箇所（集計訂正、上記参照）を再実測し健在 | 維持 |

## 新規指摘

### 低（情報提供・継続監視）: `npm audit` 検出件数が8件→9件に増加（`source-map-js`新規検出・`postcss-selector-parser`severity上昇）

- **再現手順**: `cd frontend && npm install && npm audit` を実行すると、以下2点の変化が見られる。
  1. `source-map-js`（`1.0.0 - 1.2.1`、`GHSA-68fv-2mgg-jv7q`「event-loop denial of service through
     indexed source-map section offsets」）が**新規にhigh判定**された。前回の報告書にはこの
     パッケージの言及が無く、今回初めて検出された。
  2. `postcss-selector-parser`（`<=7.1.5`）は、前回からの既存アドバイザリ
     （`GHSA-w9m9-85wc-3x92`、「uncontrolled AST recursion」）に加えて、新規アドバイザリ
     （`GHSA-rj75-hqrm-r3gf`、「PostCSS: Quadratic complexity in flat selector parsing allows
     CPU exhaustion」）が追加登録され、`npm audit`の表示severityが**low→moderateへ上昇**した。
  3. 既存の`braces`依存チェーン（`braces`/`chokidar`/`micromatch`/`fast-glob`/`tailwindcss`、
     high5件）・`browserslist`（high）・`baseline-browser-mapping`（moderate）は前回から継続
     （変化なし）。
  - 合計: high7（`braces`系5＋`browserslist`1＋`source-map-js`1）・moderate2
    （`baseline-browser-mapping`＋`postcss-selector-parser`）＝9件。
- **原因切り分け**: `git diff cff1640..HEAD -- frontend/package-lock.json frontend/package.json`
  は出力0行＝**依存関係自体はこの7日間変更されていない。** `package-lock.json`上の各パッケージ
  バージョン（`source-map-js@1.2.1`・`postcss-selector-parser@6.1.2`）も前回チェック時点から
  不変であることを確認した。つまり前回・前々回と同型のパターンで、GitHub Advisory Database
  に新しいアドバイザリが登録されたことで`npm audit`の判定結果が変わったものであり、コード側の
  変更が原因ではない。
- **影響評価**: `npm audit --json`・`package-lock.json`の内容確認により、`source-map-js`・
  `postcss-selector-parser`とも`devDependencies`配下（`dev: true`）であることを実測確認した
  （`vite`・`tailwindcss`のビルドパイプラインが内部的に利用するCSS/sourcemap処理用のツール）。
  ビルド時に開発者・CI環境のファイルシステムとビルド設定のみを処理し、ユーザー入力
  （CSVアップロード等）がこの経路に渡ることはない。**したがって本番環境・顧客データへの直接的
  な攻撃面は無いと判断する**（前回までの`braces`系の判断と同じ理由）。
- **修正可否**: `npm audit fix`（非破壊的）では解消しない。`npm audit fix --force`は
  `tailwindcss@4.3.3`へのメジャー更新を提示する（前回と同じ）。`source-map-js`・
  `postcss-selector-parser`はいずれも`postcss`/`tailwindcss`の推移的依存であり、非破壊的な
  単独更新手段は今回も確認できなかった。
- **対策案**: 今回は修正を行わない（本チェックの制約）。前回同様、実害は低い（devDependency
  限定・本番非混入）と判断し、`tailwindcss` v3→v4メジャー移行という既存のバックログ項目
  （`docs/gunrei_kouho.md`・`docs/office_map.html`のQUESTS候補に記録済み）にこの新規分も
  合流させる形で継続監視とする。新しい候補カードは追加しない（既存候補と同一の根本原因
  ・同一の対応方針のため）。

## 差分カバレッジ節（必須）

今回もコード変更が0件のため、「新設・変更されたルーター・テーブル・ガード・書き込み
エンドポイント」自体が対象範囲に存在しない。対象範囲の10コミットすべての変更ファイルを
列挙し、いずれもセキュリティ上の意味を持たないことを確認した。

| コンポーネント/変更 | 検証方法 | 結果 |
|---|---|---|
| `backend/`・`frontend/`・`lp/` 配下の全ファイル | `git diff --name-only cff1640..HEAD` および `git diff --stat cff1640..HEAD -- backend frontend lp` を実行 | 出力0行（変更なし）。ローカル実測で確認 |
| `docs/gunrei_kouho.md`（巡回候補の追記、10-05〜10-08分9件） | 内容全文を`Read`で確認 | いずれも「発見のみ・修正なし」の候補記録（README.mdの`/yakin`欠落、kpi-analyst.mdの異物トリガー語、designer.mdのLPトークン値取り違え、kpi-analyst.mdの評価ランク`−`欠落、旧デプロイチェックリストの死んだURL、4エージェントの`_admin`グループ未記載、security.mdの削除済みEXEMPT_TEST_EMAILS参照、designer.mdのHeroKgi例外未記載）。コード変更・権限変更・実装変更を一切伴わない |
| `docs/office_map.html`（STATUS「守り」、御庭番talk文言、QUESTS候補追記） | diff全文確認（`git diff cff1640..HEAD -- docs/office_map.html`） | 静的HTMLの定数配列（`STATUS`/`QUESTS`/`AGENTS`のtalk文言）への追記・書き換えのみ。外部送信API・実行コードの変更なし。機密情報の混入なし |
| `docs/sagyou_houkoku_yakin_2026-10-{05,06,07,08}.md`（新規作業報告4件） | 全文を`Read`で確認 | いずれも「急務なし・巡回のみ」の報告。mainへの直接push・外部ダッシュボード操作・自己判断でのフォローアップタスク作成の記載なし |
| `security/index.md`・`security/security_check_2026-10-05.md`（前回チェックのマージ分） | diff確認 | 前回チェック自体の報告書・索引更新。本チェックの対象ではなく前回作業の反映のみ |
| npm audit / pip-audit | コマンド実行 | npm auditは前回の8件から9件に増加（詳細は「新規指摘」節）。`package-lock.json`にdiffなし＝advisory新規登録が原因と確認。pip-auditは0件（前回と同じ） |
| RLS（新規テーブルの有無） | コードレビュー（`backend/models.py`にdiffなし）＋ローカル実測（`GET /api/security-status`） | 新規モデル追加なし。ローカルSQLiteで`applicable:false`・`unprotected:[]`・`ok:true`を確認 |
| マルウェアスキャンカバレッジ（`scan_bytes`呼び出し） | `grep -rln "UploadFile"` / `grep -rn "scan_bytes("` で全アップロードエンドポイントを再列挙 | 5ファイル・9呼び出しすべて健在。漏れなし（前回と同一） |
| CSVインジェクション対策（`csv_safe_cell`呼び出し） | `grep -rn "csv_safe_cell("` で再列挙・再集計 | `masters.py`7箇所・`item_targets.py`1箇所・`export.py`2箇所、合計10箇所すべて健在（前回報告「9箇所」は集計誤り、本回で訂正。退行ではない） |
| 招待メールの`_validate_email_note()` | ソースを直接`Read`して制御文字チェックの有無を再確認 | 変化なし（未実装のまま、継続監視） |
| `costs.py::import_costs()`のファイルサイズ上限 | ソースを直接`Read`して再確認 | 変化なし（未実装のまま、継続監視） |
| 本番URLへの疎通確認 | 実測（未実施） | 本セッションでは`curl`での本番疎通確認を行っていない（詳細は「範囲外・継続監視」節） |

## 精査した観点（チェックリスト）

- **RLS**: 新規テーブル追加なし（`models.py`にdiffなし）。ローカルで `GET /api/security-status`
  を実測しエラーなし。
- **認証と課金ガード**: `backend/routers/`配下にdiffなし。`require_admin`/
  `require_admin_write`/`_paid`の設計に変化なし。
- **Stripe**: `stripe.Webhook.construct_event`使用箇所にdiffなし。
- **SPA配信**: `_serve_spa`／`realpath`チェックにdiffなし。
- **例外ハンドラ**: `global_exception_handler`／`EXPOSE_ERROR_DETAIL`にdiffなし。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY`（`script-src 'self'`含む）にdiffなし。
- **CSVインジェクション**: 退行なし（フォローアップ表参照。呼び出し数の集計を訂正）。
- **マルウェアスキャン**: 退行なし（フォローアップ表参照。全9箇所を再実測）。
- **秘密情報の残置**: `git diff cff1640..HEAD`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし、報告書本文の検索パターン文字列以外に該当なし。
- **夜勤ルールの遵守状況**: 対象範囲の10コミットに含まれる4回の夜勤実行
  （10-05/06/07/08）はいずれも「急務なし・巡回のみ」で、mainへの直接push・外部
  ダッシュボード操作・自己判断でのフォローアップタスク作成・候補の自己昇格は無いことを
  コミットログと作業報告書で確認した。

## 実行したコマンドと結果

```
$ git log --oneline cff1640..HEAD | wc -l
10

$ git diff --name-only cff1640..HEAD
docs/gunrei_kouho.md
docs/office_map.html
docs/sagyou_houkoku_yakin_2026-10-05.md
docs/sagyou_houkoku_yakin_2026-10-06.md
docs/sagyou_houkoku_yakin_2026-10-07.md
docs/sagyou_houkoku_yakin_2026-10-08.md
security/index.md
security/security_check_2026-10-05.md

$ git diff --stat cff1640..HEAD -- backend frontend lp
（出力なし＝差分0）

$ cd backend && /usr/bin/python3.13 -m pip install -r requirements.txt -q
$ /usr/bin/python3.13 -c "from main import app; print('OK')"
OK
# 注: このセッションの `python3` コマンドは3.11を指し、pipは3.13向けの環境に
# インストールする構成だったため、import確認は `/usr/bin/python3.13` を明示して実行した
# （アプリ側のコード・依存構成に起因する問題ではない、実行環境側の事情）。

$ /usr/bin/python3.13 -m pip install -q pip-audit
$ cd backend && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd frontend && npm install && npm audit
9 vulnerabilities (2 moderate, 7 high)
  baseline-browser-mapping  <2.11.0  moderate  GHSA-w5vr-8v7q-w6rv（継続・変化なし）
  braces  *  high  GHSA-vfj7-8cjw-p6xm（継続・変化なし。tailwindcss@3.4.19の依存チェーン経由）
  browserslist  <=4.28.6  high  GHSA-c83g-rgw3-j3cx / GHSA-73wf-gq98-2v4g（継続・変化なし）
  postcss-selector-parser  <=7.1.5  moderate  GHSA-w9m9-85wc-3x92 / GHSA-rj75-hqrm-r3gf
    （後者が新規登録。severityがlow→moderateへ上昇）
  source-map-js  1.0.0-1.2.1  high  GHSA-68fv-2mgg-jv7q（新規検出）
  （chokidar/micromatch/fast-glob/tailwindcssはbracesの推移的依存として連鎖表示、継続）

$ git diff cff1640..HEAD -- frontend/package-lock.json frontend/package.json
（出力なし＝差分0。advisory新規登録が原因と確認）

$ cd frontend && python3 -c "
import json
d = json.load(open('package-lock.json'))
for name in ['braces','chokidar','micromatch','fast-glob','tailwindcss','browserslist',
             'baseline-browser-mapping','postcss-selector-parser','source-map-js']:
    pkg = d['packages'].get('node_modules/'+name, {})
    print(name, 'dev=', pkg.get('dev'), 'version=', pkg.get('version'))
"
braces dev= True version= 3.0.3
chokidar dev= True version= 3.6.0
micromatch dev= True version= 4.0.8
fast-glob dev= True version= 3.3.3
tailwindcss dev= True version= 3.4.19
browserslist dev= True version= 4.28.2
baseline-browser-mapping dev= True version= 2.10.33
postcss-selector-parser dev= True version= 6.1.2
source-map-js dev= True version= 1.2.1
（全てdevDependencies配下＝本番配信物に含まれない）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（dist/assets/index-B9EA3kwc.js 951.52kB,
index-vZxdomaG.css 47.28kB）— 前回（2026-10-05）と完全に同一ハッシュ

$ cd backend && rm -f rakuten_kpi.db && AUTH_ENABLED=false /usr/bin/python3.13 -m uvicorn main:app --host 127.0.0.1 --port 8041 &
$ curl -sS http://127.0.0.1:8041/api/security-status
{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,"malware_scan_active":false}
$ curl -sS -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8041/api/health
health:200

$ grep -rln "UploadFile" backend/routers/*.py backend/*.py
costs.py / import_csv.py / item_targets.py / masters.py / targets.py の5ファイル
$ grep -rn "scan_bytes(" backend/routers/*.py backend/*.py | grep -v "def scan_bytes" | wc -l
9
$ grep -rn "csv_safe_cell(" backend/routers/*.py | grep -v "を通すこと" | wc -l
10
$ grep -n "csv_safe_cell(" backend/routers/masters.py | wc -l
7

$ gh api repos/Shoichiro12/rakuten-kpi-app/pulls?state=open
0件（オープンPRなし）

$ git diff cff1640..HEAD | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（検索パターン文字列自体の引用のみ。実際のシークレット値は検出されず）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- **本番URLへの疎通確認は今回実施していない。** CLAUDE.md「セッション環境の注意」節のとおり、
  セッションごとにプロキシの許可状況が異なるため、本チェックでは試行していない。
- 本番Render環境変数（`ADMIN_USER_ID`・`APP_BASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・
  `CLOUDMERSIVE_API_KEY`等）の実際の設定値は、オーナーが別途本番確認済み（CLAUDE.md記録）。
- `GET /api/security-status`の本番Postgresでの再実測は、今回新規テーブル追加が無いため
  実施していない。
- Supabaseダッシュボードの表示プラン（Free Plan表示の食い違い）は引き続きオーナー確認待ち
  （2026-08-31記録、未解決）。セキュリティ機能自体への影響は確認できていないため本チェックの
  スコープ外として扱う。
- `docs/gunrei_kouho.md`に積まれた未昇格の候補（ドキュメント記述の誤り・陳腐化が中心）は、
  いずれも実装コードへの影響が無いことを前提に記録されたものだが、昇格・対応要否の判断は
  オーナー専任のため本チェックでは判断を下さない。
- `tailwindcss` v3→v4 メジャー移行（`braces`系DoS・今回追加の`source-map-js`等の実質的な
  解消手段）は、互換性検証を要する作業のため本チェックでは着手していない（バックログ記録のみ）。

## 総括

新規指摘は**高0件・低1件**（中0件）。対象範囲の10コミットはすべて夜勤（無人・定期実行）の
巡回記録・作業報告・軍令帳更新と前回チェックのマージコミットのみで、`backend`・`frontend`・
`lp`のソースコードに一切変更が無かった（`git diff --stat`で実際に確認）ため、前回チェック
時点の権限境界・入力検証・CSVインジェクション対策・マルウェアスキャン・RLS適用状況・CSP
ヘッダーは退行なし。前回の未解決3件（低。新設CSVインポート+costs.pyのサイズ上限欠如・招待
メールのemail形式検証・npm audit braces系）はいずれも対象範囲に変化がないため継続監視のまま
持ち越す。新規指摘の`npm audit`検出件数増加（8件→9件）は、依存関係自体の変更ではなく新規
アドバイザリ登録（`source-map-js`新規検出・`postcss-selector-parser`のseverity上昇）が原因で、
対象パッケージはすべてdevDependencies配下のビルド時ツールに限られ本番配信物には含まれないため、
実害は低いと判断した。あわせて、過去複数回の報告書における`csv_safe_cell()`呼び出し数の集計
誤り（9箇所→正しくは10箇所）を本回で訂正したが、これはコード側の後退ではなく報告の精度の
問題である。`pip-audit`は0件。本番URLへの疎通確認は今回は実施していない。
