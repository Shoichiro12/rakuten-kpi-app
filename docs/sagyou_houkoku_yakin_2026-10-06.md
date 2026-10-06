# 夜勤 作業報告（2026-10-06）

## 前段: 普請（急務対応）

`docs/office_map.html` の QUESTS に `stamp:"wait"`（急務）の項目は0件。評定待ちの新規項目も無し。
STATUS（領国・評定・守り・軍費）を実態と照合した結果も変更不要と判断した:

- 評定: GitHub上のオープンPRは0件 → 「議案なし」のまま変更不要
- 守り: 最新の `security/security_check_2026-10-05.md` と一致 → 「10/5検分 高0」のまま変更不要
- 軍費: `.claude/agents/infra-ops.md` のコスト内訳（$7+$25+$1+$0+$0=$33）と一致 → 「月 約$33」のまま変更不要

よって普請は今回対象なし。

## 後段: 巡回（発見専用フェーズ）

既存の `docs/office_map.html` QUESTS・`docs/gunrei_kouho.md`（候補一覧・却下済み）・CLAUDE.md申し送り台帳と
照合した上で、新規候補を2件発見した（いずれも機械的なgit検索・実コードとの突き合わせで裏取り済み）。

1. **`.claude/agents/designer.md:22`** — 「LPの規則」節の「C案トークン」行が挙げる `paper #fdfcf9` /
   `bg-alt #f4f1ea` の2値は、LPの現行値（`lp/index.html` の `:root`。`lp/style.css` 冒頭コメントも
   「index.html側が正」と明記）ではなく、`#ffffff` / `#fafaf9`（2026-08-31のLPリニューアル2a確定版で
   変更済み、CLAUDE.md:147に経緯の記録あり）。挙げられている値は実は **CLAUDE.md:429-430のアプリ側
   （ダッシュボード）デザイントークン表の`paper`・`bg-alt`と完全一致**しており、designer.mdのLP節が
   別システム（アプリ）のトークンを混入させていることを確認した。残り5値（ink/sage/sage-deep/alert/up）
   はLPの現行値と一致している。
2. **`.claude/agents/kpi-analyst.md:13`** — 「評価は `evaluate_matrix()` の17パターン + ◎○△×」という
   記述が、評価ランクを4種類としているが、`backend/evaluation.py` の `evaluate_matrix()` 自身のdocstring
   （120-124行目）は `rank: '◎' | '○' | '△' | '×' | '−'` と5種類を明記しており、実装（145-150行目）でも
   「売上が判定不可」の分岐（パターン17）で実際に `"rank": "−"` を返すことを確認した。16パターン（1〜16）
   は◎○△×のいずれかだが、残り1パターン（17・判定不可）だけ別の記号を使う、という内訳がkpi-analyst.md
   には書かれていない。

両候補とも `docs/office_map.html` QUESTS（`stamp:"kouho"`）と `docs/gunrei_kouho.md`（候補一覧）に
追記済み。修正は行っていない（巡回は発見のみ、CLAUDE.md「🌙 夜勤の掟」9参照）。

## 次にやること

- 上記2件の昇格・却下判断はオーナーが行う
- 急務（`stamp:"wait"`）が追加されたら、次回の夜勤が普請として着手する
