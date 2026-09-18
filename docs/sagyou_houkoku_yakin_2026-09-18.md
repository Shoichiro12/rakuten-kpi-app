# 作業報告（夜勤 2026-09-18）

## 前段: 普請（急務対応）

`docs/office_map.html` QUESTS を確認したところ、`stamp:"wait"`（急務）の項目は0件だった
（全19件中、17件が`stamp:"kouho"`〈候補・未昇格〉、2件が`stamp:"later"`〈後日・封印済み〉）。
このため今回の普請は対象なし。

`STATUS`（領国・評定・守り・軍費）も実態と照合した:
- 評定: GitHub上のオープンPRを確認したところ0件 → 「議案なし」のまま変更不要
- 守り: 直近の`security/security_check_2026-09-14.md`が最新（次回定例は9/21） → 「9/14検分 高0」のまま変更不要
- 軍費・領国: 変更を要する情報なし

いずれも事実の更新は不要だった。

## 後段: 巡回（発見専用フェーズ）

`docs/gunrei_kouho.md`の候補一覧・却下済み、`docs/office_map.html`のQUESTS、CLAUDE.md申し送り台帳と
重複しないか確認したうえで、新規2件を発見した（1晩3件までの上限内）。

1. **退会APIが「全データ削除」と謳いながら実際は7/20テーブルしか消していない**
   （`backend/routers/account.py:37-38` `_ALL_MODELS`）。`UserScopedMixin`継承20テーブルのうち
   `Shop`/`Product`/`ProductCategory`/`ProductCost`/`ItemTarget`/`GenreBenchmark`/`ActionLog`/
   `RppActionCheck`/`Subscription`/`AdminViewSession`の10テーブルが削除対象から漏れている
   （`comp_grants`は別途revoke処理、`consulting_inquiries`・`feedbacks`は2026-07-28決定により
   意図的保持——この3つは正当な除外）。`_ALL_MODELS`が2026-07-30の退会機能導入時点のテーブル
   構成のまま固定され、その後追加されたテーブルが反映されていないことが原因。退会したユーザーの
   商品マスタ・原価率・店舗設定等の事業データが、Supabase側のアカウント削除後もDBに残り続ける。

2. **`costs.py`の原価率CSV一括登録にファイルサイズ上限が無い**
   （`backend/routers/costs.py:154-159` `import_costs`）。2026-08-24セキュリティ指摘バックログの
   「新設CSVインポート3本+商品マスタ」という同型欠陥の一覧に、この5件目のエンドポイントが
   含まれていない。実害は他の4件と同水準で低いと考えられるが、棚卸しの一覧が不完全。

いずれも`docs/office_map.html`のQUESTSに`stamp:"kouho"`として追加、`docs/gunrei_kouho.md`の
候補一覧に詳細を記載した。**発見のみで修正はしていない**（夜勤の掟どおり、昇格・却下はオーナー判断）。

## 次にやること

- QUESTSの急務は0件のため、次回の夜勤も巡回中心になる見込み（オーナーが候補を昇格させない限り）
- 今回発見した2件、特に1点目（退会時のデータ残存）は事業データの取り扱いに関わる可能性があるため、
  優先的な確認を推奨する
