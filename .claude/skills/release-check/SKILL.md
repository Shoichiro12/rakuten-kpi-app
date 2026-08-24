---
name: release-check
description: 本番デプロイ前の定例。レビュー → 検証 → 申し送り更新 → 作業報告の順で通す。「/release-check」「デプロイ前チェック」「pushしていい？」で起動。
---

# デプロイ前チェック（/release-check）

順番どおりに通す。1つでも「高」の指摘や検証失敗があれば止めてオーナーに報告する。

1. `reviewer` に差分レビューを依頼（`git diff origin/main` 相当）
2. `qa` にローカル検証を依頼（tsc / vite build / 契約状態×API / 該当機能）
3. `pmo` に申し送り台帳の更新を依頼（今回の実装で「実装済み」に変わる行、新しい決定）
4. 価格・法的文面・Stripe設定に触れていれば `/price-check` も通す
5. `sagyou-houkoku` スキルで作業報告書を作る
6. 最後に「push してよい状態か」を1行で判定し、未検証の項目を並べてオーナーに渡す

push とデプロイはオーナーが行う。デプロイ後の本番確認（`/api/health`、`/api/security-status`、実画面）は `qa` に依頼する。
