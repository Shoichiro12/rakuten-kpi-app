# セキュリティチェック 2026-09-14（週次定例）

対象範囲: 前回チェック（2026-09-07、`security/security_check_2026-09-07.md`。本体分
`007dae3`、確定コミット `cbf3573`）以降の **`cbf3573..acdb21f`（10コミット）**。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- **`backend/`・`frontend/`・`lp/` のソースコード変更は0件。** 今回の10コミットはすべて
  夜勤（無人・定期実行）の巡回記録と作業報告（`docs/sagyou_houkoku_yakin_*.md`）・
  `CLAUDE.md`「🌙 夜勤の掟」10番目の追加・`.claude/commands/yakin.md`の同趣旨追記・
  `docs/gunrei_kouho.md`/`docs/office_map.html`の候補追加のみ（`git diff --stat` で
  `backend`/`frontend`/`lp` の差分が0行であることを確認済み）。急務（`stamp:"wait"`）は
  普請されておらず、巡回が新規候補3件（ALLOW_ORIGINS未文書化・og:image TODOの旧デザイン
  前提・APP_BASE_URL未文書化。いずれも「候補・未昇格」のまま）を積んだのみ。
- したがって前回チェック時点の権限境界・入力検証・CSVインジェクション対策・マルウェア
  スキャン・RLS適用状況はすべて**変更なし＝退行なし**。前回の未解決2件（低）も対象範囲に
  変化なし。
- `npm audit`は今回**3件（high 1・moderate 1・low 1）を検出**。前回検出した2件
  （`browserslist`=high・`postcss-selector-parser`=low）に加え、**新規に`moderate`1件
  （`baseline-browser-mapping`、`browserslist`が内部で依存する併走パッケージ）**が
  増えた。`frontend/package-lock.json`は今回の対象範囲（`cbf3573..acdb21f`）で
  1コミットも変更されていないことを確認済みのため、これも前回同様**npm advisory
  データベース側への新規登録によるもの**であり、コード変更に起因しない。3件とも
  `package-lock.json`上で`dev: true`（devDependencies配下）で、PostCSS/Autoprefixer/
  Tailwindのビルド時ツールチェーンにのみ関与し、本番の実行時配信物（`dist/`）には
  含まれない。
- `pip-audit`… **0件**。
- `python3 -c "from main import app"` … OK（依存関係を`pip install -r requirements.txt`
  で導入した上で確認。この検証環境はセッションごとに`node_modules`/Pythonパッケージが
  未導入の状態から始まるため、フロントの`npm run build`も同様に`npm install`を先に
  実行してから確認した。型エラー0、`dist/assets/index-B9EA3kwc.js` 951.52kB / 
  `index-vZxdomaG.css` 47.28kB でビルド成功）。
- 本番URLへの疎通は今回も不可（`curl`がエージェントプロキシに`CONNECT tunnel failed,
  response 403`で拒否される）。CLAUDE.md「セッション環境の注意」節のとおり、本番実測は
  範囲外として扱う。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-09-07時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・クローズ済み（退行なし確認済み） | `backend/`に対象範囲内でdiffなし（コミット自体が0件）。`csv_safe_cell()`呼び出し箇所は前回と同一 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | 今回の10コミットはすべてドキュメント・運用系で、CSVインポート関連の変更なし | 継続監視（変化なし） |
| 招待メールの`email`フィールドの形式検証が薄い（CRLF注入シンク到達、実害はPython標準ライブラリの保護により無し） | 低・継続監視 | `backend/routers/admin_comp.py::_validate_email_note()`にdiffなし。対策案（制御文字チェック追加）は未実装のまま | 継続監視（変化なし） |
| npm audit: react-router系（解決済み） | 解決済み | `package.json`にdiffなし、react-router系の再発なし | 維持 |
| CSPヘッダー（解決済み） | 解決済み | `backend/main.py`にdiffなし | 維持 |
| マルウェアスキャンのカバレッジ漏れ（解決済み） | 解決済み | `masters.py`/`item_targets.py`/`targets.py`/`costs.py`/`import_csv.py`にdiffなし | 維持 |

## 新規指摘

**なし。** 対象範囲がドキュメント・運用系コミットのみのため、新規のコード起因の指摘は
発生していない。

## 差分カバレッジ節（必須）

今回はコード変更が0件のため、「新設・変更されたセキュリティ関連コンポーネント」自体が
存在しない。念のため対象範囲の10コミットすべての変更ファイルを列挙し、いずれもセキュリ
ティ上の意味を持たないことを確認した。

| コンポーネント/変更 | 検証方法 | 結果 |
|---|---|---|
| `backend/`・`frontend/`・`lp/` 配下の全ファイル | `git diff --stat cbf3573..acdb21f -- backend frontend lp` | 出力0行（変更なし） |
| `.claude/commands/yakin.md`（夜勤の掟10番目と同趣旨の追記） | 内容確認（Read） | PR作り直し時の旧PRクローズ手順の追記のみ。権限・実行範囲の拡大なし |
| `CLAUDE.md`（夜勤の掟10番目の追加） | 内容確認（Read） | 同上、運用ルールの明文化のみ |
| `docs/gunrei_kouho.md`・`docs/office_map.html`（巡回候補3件の追加） | 内容確認（Read） | いずれも「発見のみ・修正なし」の候補記録（ALLOW_ORIGINS未文書化／og:image TODO旧デザイン前提／APP_BASE_URL未文書化）。コード変更・権限変更を伴わない | 対象外（ドキュメントのみ） |
| `docs/sagyou_houkoku_yakin_2026-09-{07,08,10,11}.md`（新規作業報告4件） | 内容確認（grep） | いずれも「急務なし・巡回のみ」の報告。実装を伴う変更の記載なし | 対象外（ドキュメントのみ） |
| npm audit / pip-audit | コマンド実行 | npm auditは新規1件（moderate、`baseline-browser-mapping`。前回からのhigh 1・low 1は維持）。package-lock.jsonにdiffなし＝advisory新規登録。pip-auditは0件 |
| RLS（新規テーブルの有無） | コードレビュー（`git diff --stat` で`backend/models.py`にdiffなし） | 新規モデル追加なし。`GET /api/security-status`の本番再実測は不要と判断 |
| 本番URLへの疎通確認 | 実測（失敗） | `curl -sS -m 10 https://app.ureshiru.com/api/health` → プロキシに`CONNECT tunnel failed, response 403`で拒否。本番実測は範囲外 |

## 精査した観点（チェックリスト）

- **RLS**: 新規テーブル追加なし（`models.py`にdiffなし）。
- **認証と課金ガード**: `backend/routers/`配下にdiffなし。前回確認済みの
  `require_admin`/`require_admin_write`の設計に変化なし。
- **Stripe**: `stripe.Webhook.construct_event`使用箇所にdiffなし。
- **SPA配信**: `_serve_spa`／`realpath`チェックにdiffなし。
- **例外ハンドラ**: `global_exception_handler`／`EXPOSE_ERROR_DETAIL`にdiffなし。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY`にdiffなし。
- **CSVインジェクション**: 退行なし（フォローアップ表参照）。
- **マルウェアスキャン**: 退行なし（フォローアップ表参照）。
- **秘密情報の残置**: `git diff cbf3573..acdb21f`全体を
  `sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]`
  でgrepし該当なし。
- **夜勤ルールの遵守状況**: 対象範囲の10コミットに含まれる4回の夜勤実行（09-07/08/10/11）
  はいずれも「急務なし・巡回のみ」で、mainへの直接push・外部ダッシュボード操作・
  自己判断でのフォローアップタスク作成は無いことをコミットログと作業報告書で確認した。

## 実行したコマンドと結果

```
$ git log --oneline cbf3573..acdb21f | wc -l
10

$ git diff --stat cbf3573..acdb21f -- backend frontend lp
（出力なし＝差分0）

$ git diff --stat cbf3573..acdb21f | tail -10
.claude/commands/yakin.md               |  4 ++
CLAUDE.md                               |  3 ++
docs/gunrei_kouho.md                    |  3 ++
docs/office_map.html                    |  5 ++-
docs/sagyou_houkoku_yakin_2026-09-07.md | 39 +++++++++++++++++++
docs/sagyou_houkoku_yakin_2026-09-08.md | 41 ++++++++++++++++++++
docs/sagyou_houkoku_yakin_2026-09-10.md | 67 +++++++++++++++++++++++++++++++++
docs/sagyou_houkoku_yakin_2026-09-11.md | 60 +++++++++++++++++++++++++++++
8 files changed, 221 insertions(+), 1 deletion(-)

$ cd frontend && npm install && npm audit
3 vulnerabilities (1 low, 1 moderate, 1 high)
  baseline-browser-mapping  <2.11.0  moderate  GHSA-w5vr-8v7q-w6rv  (新規)
  browserslist  <=4.28.6  high  GHSA-c83g-rgw3-j3cx / GHSA-73wf-gq98-2v4g  (前回から継続)
  postcss-selector-parser  6.1.0 - 6.1.2  low  GHSA-w9m9-85wc-3x92  (前回から継続)
（package-lock.jsonは対象範囲でdiffなし＝コード変更起因ではなくnpm advisory
  データベース側の新規登録。3件とも package-lock.json 上で dev:true＝ビルド時ツールで
  実行時配信物には含まれない）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（dist/assets/index-B9EA3kwc.js 951.52kB, index-vZxdomaG.css 47.28kB）

$ cd backend && pip install -r requirements.txt -q && pip install pip-audit -q && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd backend && python3 -c "from main import app; print('OK')"
OK

$ curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://app.ureshiru.com/api/health
（接続失敗: CONNECT tunnel failed, response 403。本番実測は範囲外）

$ git diff cbf3573..acdb21f | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（該当なし）
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

## 総括

新規指摘は**高0件・中0件・低0件**。対象範囲の10コミットはすべて夜勤（無人・定期実行）の
巡回記録・作業報告・運用ルール明文化で、`backend`・`frontend`・`lp`のソースコードに一切
変更が無かったため、前回チェック時点の権限境界・入力検証・CSVインジェクション対策・
マルウェアスキャン・RLS適用状況はすべて維持され、退行は確認されなかった。前回の未解決
2件（低。招待メールのemail形式検証・CSVインポートのサイズ上限）はいずれも対象範囲に
変化がないため継続監視のまま持ち越す。`npm audit`は新規advisory登録により3件
（high 1・moderate 1・low 1）を検出したが、いずれもビルド時ツールチェーン限定で
`package-lock.json`自体の変更は無く、コード変更に起因するものではない。`pip-audit`は
0件。本番URLへの疎通は本セッションからは不可（プロキシに拒否）のため、本番実測が必要な
項目は前回同様「範囲外」または「オーナーが別途実施済みの記録を参照」として扱った。
