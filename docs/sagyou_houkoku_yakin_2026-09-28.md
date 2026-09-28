# 夜勤作業報告（2026-09-28）

## 前段: 普請

`docs/office_map.html` QUESTS を確認したところ `stamp:"wait"`（急務）は0件だった。着手前にSTATUS（領国・評定・守り・軍費）も実態と照合したが、以下のとおりすべて実態と一致しており更新不要だった:

- 評定「議案なし」… GitHub上のオープンPRは0件（`mcp__github__list_pull_requests` で確認）
- 守り「9/28検分 高0」… 今日merge済みのPR #118（週次セキュリティチェック、高0・中0・低0）と一致
- 軍費「月 約$33」… `.claude/agents/infra-ops.md` のコスト内訳（Render Starter $7 + Supabase Pro $25 + Cloudflare約$1 + LP/メール$0 = $33）と一致（Supabaseプランの実態自体は既存候補〈2026-08-28発見〉として未裁可のまま）

急務なし・STATUSも変更不要のため、前段は何もせず後段（巡回）へ進んだ。

## 後段: 巡回

既存の候補一覧（32件）・却下済み（1件）・CLAUDE.md申し送り台帳と照合し、重複しない新規候補を2件見つけた。

1. **`/kickoff`が直近1ヶ月分の作業報告を読めていない**（`.claude/skills/kickoff/SKILL.md:10`／`.claude/README.md:28`）: 作業報告のファイル名が `docs/作業報告_YYYY-MM-DD.md`（sagyou-houkokuスキル本来の命名。最新は2026-08-31止まり）と `docs/sagyou_houkoku_yakin_YYYY-MM-DD.md`（夜勤が独自に定めた命名。2026-08-25〜2026-09-25の26件）の2系統に分かれており、kickoffのglobは前者しか見ない。README.mdの「作業報告は既存のsagyou-houkokuスキルが担当（変更なし）」という前提も、夜勤が独自命名で運用している実態と食い違っている。

2. **請求・プラン画面のトライアル終了日が最大1日ずれて表示されうる**（`frontend/src/pages/Billing.tsx:20-23,209`／`backend/routers/billing.py:54-55,176-177,793-795`）: バックエンドが返す`trial_end`/`current_period_end`はタイムゾーン情報なしのnaive UTC文字列で、`Billing.tsx`の`fmtDate()`が`new Date(iso)`をローカル時刻のgetterで読んでいる。UTC 15:00〜23:59台（JST深夜〜早朝に相当）にトライアル終了・契約更新が発生した顧客は、正しいJST暦日より1日早い日付を見続けることになる。既存候補（2026-08-28発見・`admin_view.py`対象のnaive UTC問題）と同根だが、一般顧客が日常的に見る請求画面という新しい実害範囲を示す具体例として追加した。

いずれも `docs/office_map.html` QUESTS に `stamp:"kouho"` として追記、詳細は `docs/gunrei_kouho.md` の候補一覧に追加した。候補札への手出し（昇格・却下）はしていない。

## 次にやること

- オーナーによる2件の候補の評定（昇格 or 却下）待ち
- 引き続き軍令帳の急務が積まれたら次回の夜勤で着手
