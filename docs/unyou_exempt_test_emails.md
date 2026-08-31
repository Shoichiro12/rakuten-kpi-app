# EXEMPT_TEST_EMAILS 運用手順と台帳

作成日: 2026-08-26（計画書 `docs/jisso_keikaku_admin_viewer_2026-08-26.md` の区切り5）

**⚠️ 2026-08-31追記: `EXEMPT_TEST_EMAILS`は運用上「使用終了」状態。** 唯一の登録だった
demo@ureshiru.comが管理画面からの無償提供（comp）管理（`docs/jisso_keikaku_comp_management_2026-08-28.md`）
へ移行し、Render環境変数`EXEMPT_TEST_EMAILS`自体が削除された（現在は未設定＝既定の空文字と同義）。
**以後、社内の検証・デモ用アカウントへの無償提供は`/admin`画面のcomp管理機能を使うこと。**
このファイル・`EXEMPT_TEST_EMAILS`の仕組み自体はコードとして残っている（緊急用・開発用の最終手段。
`is_exempt_test_email()`は削除していない）ため、以下の手順は将来また使う可能性を考えて残す。

## 概要

`EXEMPT_TEST_EMAILS` は、社内の検証・デモ用アカウントが Stripe のカード登録（Checkout）を通さずに `trialing` の契約を DB に直接作成し、全機能を無料で使えるようにするための環境変数（カンマ区切りのメールアドレス、大文字小文字は無視）。実装は `backend/billing.py` の `_EXEMPT_TEST_EMAILS` / `is_exempt_test_email()` にあり、`backend/routers/billing.py` の `create_checkout()` がこの判定で Stripe Checkout をスキップする。判定は必ず JWT 検証済みの認証ユーザーのメール（`user.email`）で行い、リクエストボディ等の入力値では判定しない（入力値で判定すると誰でも名乗るだけで課金をバイパスできてしまうため）。

ここに載せたメールの受信箱を持つ人は、そのメールで登録するだけで無料で全機能を使える。**自社が所有・管理しているメールアドレスだけ**を載せること。

## 追加手順（オーナー作業）

1. Render ダッシュボード → 対象サービス（本番: `rakuten-kpi-app-sg`、Singapore）→ Environment を開く
2. `EXEMPT_TEST_EMAILS` の値を編集し、既存値にカンマ区切りで追記する（例: `demo@ureshiru.com,new-test@ureshiru.com`）
3. 保存すると自動で再デプロイされる（Render は環境変数の変更時に自動再起動する構成）。自動で再デプロイされない場合や手動で反映したい場合は「Manual Deploy → Deploy latest commit」を使う
4. **下記の台帳に行を追加する**（追加日・メールアドレス・目的・追加した人・削除予定日）

反映の確認は、対象メールでサインアップしてカード画面を経ずに `trialing` になること、または `GET /api/billing/diagnose` の出力で行う（exempt アカウントは Stripe 契約を持たないため「DBに subscription ID がありません」の warn が出るが、これは仕様どおり）。

## 削除手順（オーナー作業）

1. 同じ画面（Render → `rakuten-kpi-app-sg` → Environment）で `EXEMPT_TEST_EMAILS` のカンマ区切りの値から該当メールを削除する
2. 保存 → 自動再デプロイ（必要なら「Manual Deploy → Deploy latest commit」）
3. **下記の台帳の該当行に削除日を記入する**

**⚠️ 削除を忘れると、そのメールの受信箱を持つ人がずっと無料で全機能を使える状態が続く。** 削除予定日を過ぎたメールが残っていないか、定期的な棚卸しを推奨する。目安は週次セキュリティチェック `/security-check` のタイミングで、下記の台帳と Render の実際の設定値を突き合わせること（台帳にあって Render に無い、Render にあって台帳に無い、のどちらも異常）。

なお、`EXEMPT_TEST_EMAILS` から削除しても、既に作成済みの `trialing` 契約の行が DB から消えるわけではない（その契約は Stripe 側に存在せず Webhook が来ないため、自動では止まらない）。該当アカウントをどう扱うか（`Subscription` 行の status を手動で変える／改めて契約してもらう／退会）は削除時に合わせて決めること。

**⚠️ `/admin`のcomp管理機能へ移行するときの順序（2026-08-31、demo@移行時の教訓）**: 対象メールを
`EXEMPT_TEST_EMAILS`からcomp管理へ切り替えるときは、**必ず「①先にcompを付与する→②その後で
`EXEMPT_TEST_EMAILS`から削除する」の順序を守ること。** 逆順（先にEXEMPTから外し、後でcompを
付与する）にすると、両方の仕組みが有効になっていない空白の数分間、そのアカウントは通常の
未契約ユーザーとして扱われ`_paid`エンドポイントが402を返す状態になる。demo@ureshiru.comの
移行時に実際にこの逆順が起きた（実害は確認されていないが、次回は正しい順序で行うこと）。

## 台帳

**ルール: `EXEMPT_TEST_EMAILS` にメールを追加・削除するたびに、必ずこの表に行を追加・更新する。** Render の設定値だけを変えて台帳を更新しないことが、記録漏れ・放置事故の温床になる。

| 追加日 | メールアドレス | 目的 | 追加した人 | 削除予定日 | 削除日 |
|---|---|---|---|---|---|
| 2026-07-30 | demo@ureshiru.com | トライアル運用テスト用デモアカウント | オーナー | （無期限運用のため未定） | 2026-08-31（`/admin`のcomp管理へ移行のため。`EXEMPT_TEST_EMAILS`変数自体を削除。以後の無償提供の記録は`/admin`のcomp一覧が正） |

## 既定値についての注意

既定値は空文字。env を設定しない限り誰も除外されない（＝全員カード登録が必要）。

過去に既定値が `test@gmail.com` にハードコードされていた時期があり、本番で env の設定を忘れると誰でもそのメールで無料契約を作れる状態だった。これは 2026-08-03 のセキュリティ指摘を受けてコミット `c4ea5b7` で空文字に修正されたが、`CLAUDE.md` の申し送り台帳はその修正を反映しないまま「既定値は `test@gmail.com`」という誤った記載を3週間残し続けた（2026-08-24 に発覚・訂正済み）。

教訓: **コードの実態と記録がずれたまま放置されると、次に読む人が誤った前提で判断する。台帳（このファイル）と Render の実際の設定値、そして `backend/billing.py` の既定値は定期的に突き合わせること。**

## 関連

- `backend/billing.py` … `_EXEMPT_TEST_EMAILS` / `is_exempt_test_email()`（判定の実装と運用ルールのコメント）
- `backend/routers/billing.py` … `create_checkout()`（Checkout をスキップして `trialing` を直接作成する分岐）
- `backend/.env.example` … ローカル開発用の設定例
- `CLAUDE.md` 申し送り台帳「テスト・デモ用アカウントのカード登録除外」行 … 決定の経緯と本番 env 設定の記録
- `docs/security_taiou_2026-08-03.md` … 既定値を空文字に変更した対応記録（コミット `c4ea5b7`）
