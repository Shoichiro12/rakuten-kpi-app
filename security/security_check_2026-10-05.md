# セキュリティチェック 2026-10-05（週次定例）

対象範囲: 前回チェック（2026-09-28、`security/security_check_2026-09-28.md`。確定コミット
`4fd8549`）以降の **`4fd8549..cff1640`（11コミット、現在HEAD `cff1640`）**。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- **`backend/`・`frontend/`・`lp/` のソースコード変更は0件。** `git diff --name-only
  4fd8549..cff1640` を実行し、変更ファイルは `docs/gunrei_kouho.md`・`docs/office_map.html`・
  `docs/sagyou_houkoku_yakin_2026-09-{28,29,30}.md`・`docs/sagyou_houkoku_yakin_2026-10-{01,02}.md`
  の7件のみであることを実測確認した。対象範囲の11コミットはすべて夜勤（無人・定期実行）に
  よる巡回記録・作業報告・軍令帳更新のみ（PR #118〜#123、うち#118は前回セキュリティチェック
  自体のマージコミット）。
- したがって前回チェック時点の権限境界・入力検証・CSVインジェクション対策（`csv_safe_cell()`
  4箇所）・マルウェアスキャンカバレッジ（`scan_bytes()` 9箇所）・RLS適用状況・CSPヘッダー・
  Stripe Webhook検証・各種ガード（`require_admin`/`require_admin_write`/`_paid`等）は**すべて
  変更なし＝退行なし**。
- **新規指摘1件（低）**: `npm audit` の検出数が前回の3件（high1・moderate1・low1）から
  **8件（high6・moderate1・low1）に増加した。** 原因は `frontend/package-lock.json` 自体の
  変更ではなく（対象範囲でdiff 0件を確認）、`braces`（GHSA-vfj7-8cjw-p6xm、スタック枯渇DoS）
  という**新規登録されたアドバイザリ**が、既存の `tailwindcss@3.4.19` の依存チェーン
  （`chokidar`→`braces`、`micromatch`→`braces`、`fast-glob`→`micromatch`）を通じて6件の
  "high" 表示として連鎖的に現れたもの。詳細は「新規指摘」節。
- `pip-audit` … **0件**（前回と同じ）。
- `python3 -c "from main import app"` … OK。`npm run build` … tsc型エラー0、vite build成功
  （`dist/assets/index-B9EA3kwc.js` 951.52kB / `index-vZxdomaG.css` 47.28kB。**前回と完全一致
  のハッシュ**＝フロント成果物が一切変わっていないことの裏付け）。
- ローカル起動（SQLite・`AUTH_ENABLED=false`）で `GET /api/security-status` を実測:
  `{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,
  "malware_scan_active":false}`。新規モデル追加は0件（`backend/models.py`に対象範囲でdiffなし）。
- マルウェアスキャン（`scan_bytes`）の呼び出しカバレッジを `grep` で全アップロードエンドポイント
  （`UploadFile` 使用箇所5ファイル・7エンドポイント）に対し再実測し、9呼び出し
  （`import_csv.py`4箇所・`masters.py`2箇所・`item_targets.py`1箇所・`targets.py`1箇所・
  `costs.py`1箇所）すべて健在で漏れなし（前回と同一）。
- CSVインジェクション対策（`csv_safe_cell()`）の呼び出しも `masters.py`（6箇所）・
  `item_targets.py`（1箇所）・`export.py`（2箇所）で前回と同一、漏れなし。
- 本番URLへの疎通は今回も確認できず、`curl` が通らない環境だったため未実施。CLAUDE.md
  「セッション環境の注意」節のとおり、本番実測は範囲外として扱う。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-09-28時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・クローズ済み（退行なし） | `backend/`に対象範囲内でdiffなし（コミット自体が0件）。`csv_safe_cell()`呼び出し箇所（`masters.py`6箇所・`item_targets.py`1箇所・`export.py`2箇所）は前回と同一 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | 今回の11コミットはすべてドキュメント・運用系で、CSVインポート関連の変更なし。`costs.py`の同型欠陥（2026-09-18夜勤巡回が発見・軍令帳候補）も未昇格のまま | 継続監視（変化なし） |
| 招待メールの`email`フィールドの形式検証が薄い（CRLF注入シンク到達、実害はPython標準ライブラリの保護により無し） | 低・継続監視 | `backend/routers/admin_comp.py::_validate_email_note()`を再読。`email.strip().lower()`・`"@" in email`・長さ上限のみで制御文字チェックは引き続き無し。diffなし | 継続監視（変化なし） |
| npm audit: react-router系／CSP／マルウェアスキャンカバレッジ（いずれも解決済み） | 解決済み | 対象ファイルに対象範囲内でdiffなし。`scan_bytes` 9箇所・`csv_safe_cell` 9箇所を再実測し健在 | 維持 |

## 新規指摘

### 低（情報提供・継続監視）: `npm audit` 検出件数が3件→8件に増加（`tailwindcss`の依存チェーン、`braces` DoS）

- **再現手順**: `cd frontend && npm install && npm audit` を実行すると、`braces`
  （`GHSA-vfj7-8cjw-p6xm`、「深くネストしたパターンによるスタック枯渇DoS」）が新規にhigh判定
  され、それを推移的に抱える `chokidar`（3.6.0）・`micromatch`（4.0.8）・`fast-glob`（3.3.3）・
  直接依存の `tailwindcss`（3.4.19）の4パッケージも連鎖してhigh判定された。既存の
  `browserslist`（high）・`baseline-browser-mapping`（moderate）・`postcss-selector-parser`
  （low）は前回から継続（変化なし）。合計 high6・moderate1・low1＝8件。
- **原因切り分け**: `git diff 4fd8549..cff1640 -- frontend/package-lock.json
  frontend/package.json` は出力0行＝**依存関係自体はこの7日間変更されていない。** つまり
  コード側の変更ではなく、GitHub Advisory Database に `braces` の新しいアドバイザリが登録
  されたことで、同一の `package-lock.json` に対する `npm audit` の判定結果が変わった
  （前回までの報告書で繰り返し見られたパターンと同型）。
- **影響評価**: `npm audit --json` で該当5パッケージ（`braces`/`chokidar`/`micromatch`/
  `fast-glob`/`tailwindcss`）すべてが `package-lock.json` 上で `dev: true`
  （`devDependencies` 配下のビルド時ツール）であることを実測確認した。これらはビルド時に
  開発者・CI環境のファイルシステムを走査する目的で使われ、本番の実行時配信物（`dist/`）には
  含まれない。また `braces`/`chokidar` が処理するのは信頼できる開発者のビルド設定（glob
  パターン）であり、ユーザー入力（CSVアップロード等）がこの経路に渡ることはない。
  **したがって本番環境・顧客データへの直接的な攻撃面は無いと判断する。**
- **修正可否**: `npm audit fix`（非破壊的）では解消しない。`npm audit fix --force` を実行すると
  `tailwindcss@4.3.3`（メジャーバージョン）への更新が提示される。`npm view braces versions`
  で確認したところ、`braces` の最新版は現在インストール済みの `3.0.3` のままであり、
  **3.x系に対する非破壊的な修正版は現時点で存在しない**（`chokidar` も3.x系の最新は既に
  `3.6.0` で打ち止め、4.x系はESMのみでtailwindcss v3との互換に別途検証が要る）。
  実質的な解消には tailwindcss v3→v4 のメジャー移行（破壊的変更）が必要と考えられる。
- **対策案**: 今回は修正を行わない（本チェックの制約）。実害は低い（devDependency限定・
  本番非混入）ため緊急対応は不要と判断するが、2026-08-18の react-router v6→v7 移行と同様に
  「メジャー移行が要る既知の残課題」としてバックログに記録し、`docs/office_map.html` の
  候補（`kouho`）に追加した。対応するセッションは `/jisso-keikaku` で tailwindcss v4 移行の
  影響範囲（`tailwind.config.js` のカスタムトークン・プラグイン構成の互換性）を洗い出した
  うえで着手すること。

## 差分カバレッジ節（必須）

今回もコード変更が0件のため、「新設・変更されたルーター・テーブル・ガード・書き込み
エンドポイント」自体が対象範囲に存在しない。対象範囲の11コミットすべての変更ファイルを
列挙し、いずれもセキュリティ上の意味を持たないことを確認した。

| コンポーネント/変更 | 検証方法 | 結果 |
|---|---|---|
| `backend/`・`frontend/`・`lp/` 配下の全ファイル | `git diff --name-only 4fd8549..cff1640` および `git diff --stat 4fd8549..cff1640 -- backend frontend lp` を実行 | 出力0行（変更なし）。ローカル実測で確認 |
| `docs/gunrei_kouho.md`（巡回候補の追記） | 内容全文を`Read`で確認（2026-09-28〜10-02分、5件追加） | いずれも「発見のみ・修正なし」の候補記録（kickoffのglob漏れ、Billing.tsxの日付ずれ、legal-financeの出典不明番号、README.mdの幽霊参照、designer.mdの書体決定陳腐化、security.md/READMEのファイル名表記ゆれ、.env.exampleの記載漏れ2件、kpi-analyst.mdの母数しきい値記載漏れ、developer/reviewer.mdのマルウェアスキャン規約漏れ）。コード変更・権限変更・実装変更を一切伴わない |
| `docs/office_map.html`（STATUS「守り」日付更新、「最終更新」コメント更新、QUESTS候補5件追加） | diff全文確認（`git diff 4fd8549..cff1640 -- docs/office_map.html`） | 静的HTMLの定数配列（`STATUS`/`QUESTS`/`AGENTS`のtalk文言）への追記・書き換えのみ。外部送信API・実行コードの変更なし。機密情報の混入なし |
| `docs/sagyou_houkoku_yakin_2026-{09-28,09-29,09-30,10-01,10-02}.md`（新規作業報告5件） | 全文を`Read`で確認 | いずれも「急務なし・巡回のみ」の報告。mainへの直接push・外部ダッシュボード操作・自己判断でのフォローアップタスク作成の記載なし |
| npm audit / pip-audit | コマンド実行 | npm auditは前回の3件から8件に増加（詳細は「新規指摘」節）。`package-lock.json`にdiffなし＝advisory新規登録が原因と確認。pip-auditは0件（前回と同じ） |
| RLS（新規テーブルの有無） | コードレビュー（`backend/models.py`にdiffなし）＋ローカル実測（`GET /api/security-status`） | 新規モデル追加なし。ローカルSQLiteで`applicable:false`・`unprotected:[]`・`ok:true`を確認 |
| マルウェアスキャンカバレッジ（`scan_bytes`呼び出し） | `grep -rn "UploadFile"` / `grep -rn "scan_bytes("` で全アップロードエンドポイントを再列挙 | 5ファイル・9呼び出しすべて健在。漏れなし（前回と同一） |
| CSVインジェクション対策（`csv_safe_cell`呼び出し） | `grep -rn "csv_safe_cell("` で再列挙 | `masters.py`6箇所・`item_targets.py`1箇所・`export.py`2箇所、合計9箇所すべて健在（前回と同一） |
| 招待メールの`_validate_email_note()` | ソースを直接`Read`して制御文字チェックの有無を再確認 | 変化なし（未実装のまま、継続監視） |
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
- **CSVインジェクション**: 退行なし（フォローアップ表参照）。
- **マルウェアスキャン**: 退行なし（フォローアップ表参照。全9箇所を再実測）。
- **秘密情報の残置**: `git diff 4fd8549..cff1640`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし該当なし。
- **夜勤ルールの遵守状況**: 対象範囲の11コミットに含まれる5回の夜勤実行
  （09-28/29/30、10-01/02）はいずれも「急務なし・巡回のみ」で、mainへの直接push・外部
  ダッシュボード操作・自己判断でのフォローアップタスク作成・候補の自己昇格は無いことを
  コミットログと作業報告書で確認した。

## 実行したコマンドと結果

```
$ git log --oneline 4fd8549..cff1640 | wc -l
11

$ git diff --name-only 4fd8549..cff1640
docs/gunrei_kouho.md
docs/office_map.html
docs/sagyou_houkoku_yakin_2026-09-28.md
docs/sagyou_houkoku_yakin_2026-09-29.md
docs/sagyou_houkoku_yakin_2026-09-30.md
docs/sagyou_houkoku_yakin_2026-10-01.md
docs/sagyou_houkoku_yakin_2026-10-02.md

$ git diff --stat 4fd8549..cff1640 -- backend frontend lp
（出力なし＝差分0）

$ cd backend && pip install -r requirements.txt -q && python3 -c "from main import app; print('OK')"
OK

$ cd backend && pip install -q pip-audit && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd frontend && npm install && npm audit
8 vulnerabilities (1 low, 1 moderate, 6 high)
  baseline-browser-mapping  <2.11.0  moderate  GHSA-w5vr-8v7q-w6rv（継続・変化なし）
  braces  *  high  GHSA-vfj7-8cjw-p6xm（新規。tailwindcss@3.4.19の依存チェーン経由。
    fix available via `npm audit fix --force`（tailwindcss@4.3.3へのメジャー移行が必要））
  browserslist  <=4.28.6  high  GHSA-c83g-rgw3-j3cx / GHSA-73wf-gq98-2v4g（継続・変化なし）
  postcss-selector-parser  6.1.0-6.1.2  low  GHSA-w9m9-85wc-3x92（継続・変化なし）
  （chokidar/micromatch/fast-glob/tailwindcssはbracesの推移的依存として連鎖表示）

$ git diff 4fd8549..cff1640 -- frontend/package-lock.json frontend/package.json
（出力なし＝差分0。advisory新規登録が原因と確認）

$ cd frontend && python3 -c "
import json
d = json.load(open('package-lock.json'))
for name in ['braces','chokidar','micromatch','fast-glob','tailwindcss']:
    print(name, d['packages']['node_modules/'+name].get('dev'))
"
braces True
chokidar True
micromatch True
fast-glob True
tailwindcss True
（全てdevDependencies配下＝本番配信物に含まれない）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（dist/assets/index-B9EA3kwc.js 951.52kB,
index-vZxdomaG.css 47.28kB）— 前回（2026-09-28）と完全に同一ハッシュ

$ cd backend && rm -f rakuten_kpi.db && AUTH_ENABLED=false python3 -m uvicorn main:app --host 127.0.0.1 --port 8031 &
$ curl -sS http://127.0.0.1:8031/api/security-status
{"dialect":"sqlite","applicable":false,"protected":[],"unprotected":[],"ok":true,"malware_scan_active":false}
$ curl -sS -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8031/api/health
health:200

$ grep -rn "UploadFile" backend/routers/*.py backend/*.py
（costs.py / import_csv.py / item_targets.py / masters.py / targets.py の5ファイル）
$ grep -n "scan_bytes(" backend/routers/*.py backend/*.py | wc -l
9
$ grep -rn "csv_safe_cell(" backend/routers/*.py | wc -l
9

$ gh api repos/Shoichiro12/rakuten-kpi-app/pulls?state=open
0件（オープンPRなし）

$ git diff 4fd8549..cff1640 | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（該当なし）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- **本番URLへの疎通確認は今回実施していない。** CLAUDE.md「セッション環境の注意」節のとおり、
  セッションごとにプロキシの許可状況が異なるため、本チェックでは試行していない（前回まで
  複数回「プロキシに403で拒否される」実測記録があり、同種の制約が続いている可能性が高いが、
  今回は未検証のまま「範囲外」として扱う）。
- 本番Render環境変数（`ADMIN_USER_ID`・`APP_BASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・
  `CLOUDMERSIVE_API_KEY`等）の実際の設定値は、オーナーが別途本番確認済み（CLAUDE.md記録）。
- `GET /api/security-status`の本番Postgresでの再実測は、今回新規テーブル追加が無いため
  実施していない。
- Supabaseダッシュボードの表示プラン（Free Plan表示の食い違い）は引き続きオーナー確認待ち
  （2026-08-31記録、未解決）。セキュリティ機能自体への影響は確認できていないため本チェックの
  スコープ外として扱う。
- 夜勤巡回が発見した新規候補5件（ドキュメント記述の誤り・陳腐化、kpi-analyst.md/
  developer.md/reviewer.mdの規約記載漏れ）は、いずれも実装コードへの影響が無いことを
  確認済みだが、昇格・対応要否の判断はオーナー専任のため本チェックでは判断を下さない。
- `tailwindcss` v3→v4 メジャー移行（braces DoS対応の実質的な解消手段）は、互換性検証を
  要する作業のため本チェックでは着手していない（バックログ記録のみ）。

## 総括

新規指摘は**高0件・低1件**（中0件）。対象範囲の11コミットはすべて夜勤（無人・定期実行）の
巡回記録・作業報告・軍令帳更新で、`backend`・`frontend`・`lp`のソースコードに一切変更が
無かった（`git diff --name-only`で実際に確認）ため、前回チェック時点の権限境界・入力検証・
CSVインジェクション対策・マルウェアスキャン・RLS適用状況・CSPヘッダーは退行なし。前回の
未解決2件（低。招待メールのemail形式検証・CSVインポートのサイズ上限）はいずれも対象範囲に
変化がないため継続監視のまま持ち越す。新規指摘の`npm audit`検出件数増加（3件→8件）は、
依存関係自体の変更ではなく新規アドバイザリ登録が原因で、対象パッケージはすべて
devDependencies配下のビルド時ツールに限られ本番配信物には含まれないため、実害は低いと
判断した（非破壊的な修正版が現時点で存在せず、根本解消にはtailwindcss v4へのメジャー移行が
必要）。`pip-audit`は0件。本番URLへの疎通確認は今回は実施していない。
