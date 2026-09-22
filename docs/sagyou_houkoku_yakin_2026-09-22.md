# 夜勤 作業報告（2026-09-22）

## 前段: 普請（急務対応）

`docs/office_map.html` QUESTS を確認したところ、`stamp:"wait"`（急務）は0件だった
（`stamp:"kouho"`22件・`stamp:"later"`2件のみ）。CLAUDE.md「📌 申し送り」台帳にも新規の
未実装・未実施項目は見当たらなかった。**対象なし。普請は実施しなかった。**

あわせてSTATUS（領国・評定・守り・軍費）を実態と照合した:
- 評定 = 「議案なし」… GitHub上のオープンPRは0件（`list_pull_requests`で確認）。変更不要
- 守り = 「9/21検分 高0」… 直近の週次セキュリティチェック（`security/security_check_2026-09-21.md`、
  コミット `2eb8f1f`）が今日時点でも最新で「高0・中0・低0」を記録済み。変更不要
- 軍費 = 「月 約$33」… `.claude/agents/infra-ops.md`のコスト内訳（Render $7 + Supabase $25 +
  Cloudflare 約$1 + LP $0 = $33）と一致。変更不要

いずれも実態と一致していたため、STATUS側の更新は行っていない。

## 後段: 巡回（発見専用フェーズ）

`docs/gunrei_kouho.md`（候補一覧22件・却下済み1件）とCLAUDE.md申し送り台帳を読んだうえで、
コード・ドキュメントを見回った。重複除外のため既存候補・却下済み・台帳記載と丹念に照合した結果、
新規に裏取りできた候補は1件だった（上限3件のうち1件のみ。無理に3件を埋めるための弱い指摘は
挙げていない）。

1. **`CLAUDE.md:320`（「アーキテクチャ」節）** — 「マイグレーションツールなし＝モデル変更は手動で
   DB削除 or ALTER」という記述が、実際の`backend/migrations.py`の`_EXTRA_COLUMNS`辞書＋
   `_add_extra_columns()`という確立した自動ALTER機構と食い違っている。この機構は
   `_add_extra_columns()`のdocstringどおり「モデルに後から追加した通常カラムを、無ければ
   ALTER TABLE で足す（冪等）」もので、辞書に1行足すだけで起動時に自動反映される。2026-08-01の
   アクション提案ロジック（`products`4列）を皮切りに、`shops`（売上予算プラン）・`targets`
   （月次予算手動補正）・`comp_grants`（招待メール機能）と少なくとも4つの機能追加で実際に
   使われてきた実績があり、単なる思いつきの改善案ではなく既に定着した規約であることを確認した。
   なお同じCLAUDE.md:320の一文には既に2件の候補（`global_exception_handler`の
   EXPOSE_ERROR_DETAILゲート＝2026-09-16候補、CORSの`ALLOW_ORIGINS`拡張＝2026-09-08候補）が
   付いているが、いずれも「マイグレーションツールなし」の条項そのものには触れておらず、
   今回の指摘は別の切り口として新規性がある。

上記1件を `docs/office_map.html` の QUESTS に `stamp:"kouho"` として追記し、`docs/gunrei_kouho.md`
の候補一覧に詳細（何が・どこで・なぜ・放置するとどうなるか）を追記した。修正・昇格・却下は行って
いない（オーナー裁可待ち）。

他に検討したが候補として挙げなかった論点（裏取りの結果、問題なしと確認したもの）:
- CSVエクスポートの`csv_safe_cell()`適用範囲（`export.py`/`item_targets.py`/`masters.py`/
  `targets.py`）… 全箇所で適用済み、新規の漏れなし
- サンプルデータ生成対象（`is_sample`列を持つ10モデル）と`delete_sample_data()`の対象一致 … 一致
- `frontend/src/lib/api.ts`経由でないfetch直書き … 0件（規約どおり）
- CSP `connect-src`の外部サービス網羅 … Supabase・Google Fontsのみで新規の抜けなし
- `backend/routers/admin.py`のアカウント一覧APIのN+1クエリ … `masters.py`と同じプリフェッチ方式で
  問題なし
- `backend/learning.py`の重み計算ロジック（コメントとコードの数式一致） … 一致、問題なし

## 次にやること

- 上記1件の候補について、オーナーが急務への昇格または却下を判断する
- 既存の急務候補22件のうち優先度の高いものがあれば、次回の夜勤の普請対象として昇格を検討する
