# 夜勤 作業報告（2026-09-25）

## 前段: 普請

対象なし。`docs/office_map.html` の `QUESTS` に `stamp:"wait"`（急務）は0件だった。

**STATUS自己点検**: 領国・評定・守り・軍費の4項目を実態と照合した。
- 評定「議案なし」… `mcp__github__list_pull_requests`（state: open）で確認、オープンPR 0件。実態どおり
- 守り「9/21検分 高0」… `security/security_check_2026-09-21.md` が最新報告書で、結論サマリに「重大度『高』の新規指摘は無し」と記載。実態どおり
- 軍費「月 約$33」… `.claude/agents/infra-ops.md` のコスト表（Render Starter $7 + Supabase Pro $25 + Cloudflare約$1 + LP/メール$0）と一致。実態どおり（Supabaseプラン自体の実態食い違いは既存候補として別途記録済みのため、STATUS側の変更はしない）

いずれも変更不要と判断し、事実の更新（普請1件のルール外）も今回は発生しなかった。

## 後段: 巡回

新規候補3件を発見。`docs/office_map.html` QUESTS（`stamp:"kouho"`）と `docs/gunrei_kouho.md`（候補一覧）に追記した。

1. **`.claude/agents/designer.md:20`** — 「LPの規則（docs_LP_lowya_dna / hallmark_audit / design_review より）」の見出しが、全履歴に一度も存在しないファイル2件（`LP_lowya_dna`・`LP_hallmark_audit`）を規則の出典として挙げている。CLAUDE.md自身はこの2ファイルを「わざと不在のまま記録している失われた記録」と明確に区別しているが、designer.mdはその区別を引き継がず単純な出典として引用している。
2. **`.claude/agents/planner.md:9` ／ `CLAUDE.md:65`** — 2026-08-01のアクション提案ロジック第1段階の設計書を、2箇所が互いに異なるファイル名（`jisso_keikaku_action_logic_2026-08-01.md` / `action_logic_unified_2026-08-01.md`）で参照しているが、どちらの名前のファイルも全履歴に一度も存在しない。CLAUDE.mdルール4（成果物は実装より先にコミット）が警告する事故の実例と考えられる。
3. **`.claude/agents/developer.md:32-35`** — 「実装後に必ず通すもの」の必須検証に `python -m pytest -q` が含まれるが、`backend/requirements.txt` に pytest の記載は無く、テストファイルも0件のため実行すると `ModuleNotFoundError` で必ず失敗する。CLAUDE.md本文が明記する実際の検証手順（import確認・npm build・curl）とも食い違っており、developer.md側には import確認・curl実行が含まれていない。

いずれも `git log --all --diff-filter=A --name-only` 等での実在チェックを済ませたうえで記録し、既存の候補一覧・却下済み・CLAUDE.md記載事項との重複がないことを確認済み。

## 次にやること

- 上記3件の候補はオーナーの裁可待ち（昇格 or 却下）。夜勤側からの追加対応は無し
- 次回の夜勤も、急務（`stamp:"wait"`）が積まれていればそちらを優先する
