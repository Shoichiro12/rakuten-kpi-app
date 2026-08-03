# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 📌 申し送り（セッション開始時に必ず読む）

**このセクションは「決定事項とその実装状態」の台帳。** 過去に「決まったはずのことが
コードにもドキュメントにも残らず、後のセッションで繰り返し議論される」事故が複数回起きた
（例: past_due UI・機能ロックが3〜4回「未回答」として再浮上した）。再発防止のルール:

1. **オーナーが方針を決めたら、その場でこの表に1行追加する**（実装が後日でも先に書く）
2. **実装が完了したら「実装済み」に更新し、コミットハッシュを書く**
3. 新しいセッションで作業を始める前に、この表の「未実装」を確認する

| 決定事項 | 決定日 | 状態 |
|---|---|---|
| 機能ロック: 未契約者は主要APIを使えない（402→/billing誘導）。`require_active_subscription` | 2026-07-29 | 実装済み（backend/subscription_guard.py） |
| past_due/unpaid は「未契約」ではなく「支払い確認が取れていない」表示＋ポータル導線 | 2026-07-29 | 実装済み（Billing.tsx） |
| 退会時にコンサル問い合わせ・フィードバック記録は削除しない（営業記録として保持。プライバシーポリシー第5条と整合） | 2026-07-28 | 実装済み（削除対象に含めない、が実装） |
| Stripe顧客の重複防止（メールで既存顧客を検索して再利用） | 2026-07-28 | **未実装**（公開後でよい、と決定済み。実装時はcheckout作成前にemail検索） |
| 専門家確認（法務文面・インボイス様式） | 2026-07-29 | **未実施**（審査完了と機能ロック実装後にまとめて手配、と決定）。**優先確認事項に「特商法第26条（営業目的取引の適用除外）への依拠」を追加（2026-07-30）**: 解約を問い合わせ経由（2〜3営業日以内に手続き完了）に変更した設計は、顧客全員が「営業のために」契約する前提で26条の適用除外に依拠している。この依拠の妥当性を最優先で確認してもらうこと |
| 解約はポータル自己完結ではなく問い合わせ経由（受付後2〜3営業日以内に手続き完了）。**Stripeカスタマーポータルの「顧客によるサブスクリプションのキャンセル」は意図的に無効化**しており、「解約ボタンがない」は不具合ではない（直さないこと）。アプリ内はフィードバック category="cancel"（解約について）で受付、通知メール件名は【解約リクエスト】で始まる | 2026-07-30 | 実装済み（feedback.py / notifications.py / Billing.tsx / FeedbackModal.tsx / lp/tokushoho.html / lp/terms.html）。ポータル側のキャンセル無効化も**実施済み（2026-07-30、Stripeダッシュボードで本番・テスト両環境とも設定・保存を確認）**。**動作確認済み（2026-07-30）**: テストモードの実ポータル画面でキャンセルボタン非表示・Billing.tsx「解約をご希望の場合」セクション表示（ローカル/本番とも）・「解約について」送信で通知メール実送信成功（Renderログ `フィードバック通知メールを送信しました` で確認、宛先はNOTIFY_EMAIL） |
| 退会（アカウント削除）は契約中（trialing/active/past_due/unpaid）はブロックし、先に解約（問い合わせ経由）を完了してもらう。退会APIはStripe契約に触れないため、契約中に退会を通すと「ログイン不可なのに課金継続」事故になる | 2026-07-30 | 実装済み（routers/account.py が409を返す＋AccountSettings.tsx が案内表示・ボタン無効化）。**本番動作確認済み（2026-07-30）**: trialingのdemoアカウントで DELETE /api/account → 409 Conflict＋UI案内・ボタン無効化を実画面確認。※ローカル（認証無効）では409より先に「認証が無効な環境では削除不可」の400が返る仕様 |
| Supabase Redirect URLs に `https://app.ureshiru.com/**` を追加（旧URLと併存） | 2026-07-29 | 実装済み（Total URLs: 2。Site URL も https://app.ureshiru.com に切替済み） |
| Render カスタムドメイン app.ureshiru.com 有効化＋Stripe Webhook URL を https://app.ureshiru.com/api/stripe/webhook に変更（whsec不変） | 2026-07-29 | 実装済み（Verified/Certificate Issued、/api/health 200確認） |
| 旧Render(Oregon)・旧Vercelプロジェクトの削除 | 2026-07-29 | **未実施**（新環境の安定運用を数日確認してから） |
| 4万SKU CSV取込のメモリ実測 → Render Starter で不足なら Standard へ | 2026-07-29 | **未実施** |
| テスト・デモ用アカウントのカード登録除外: env `EXEMPT_TEST_EMAILS`（カンマ区切り・既定 `test@gmail.com`・空文字設定で無効化）に載ったメールは `/api/billing/checkout` で Stripe Checkout を通さず trialing をDBに直接作成する。判定はJWT検証済みメールのみ。**このメールの受信箱を持つ人は無料で全機能を使えるため、本番は自社管理のメールに差し替えること** | 2026-07-30 | 実装済み（backend/billing.py `is_exempt_test_email` / routers/billing.py `create_checkout`）。**本番envは差し替え済み（2026-07-30）**: Render `EXEMPT_TEST_EMAILS=demo@ureshiru.com` を設定・再デプロイし、demo@ureshiru.com の本番サインアップでカード登録なしtrialing作成・ダッシュボード表示を確認。※exemptアカウントはStripe契約を持たないため `/api/billing/diagnose` に「DBに subscription ID がありません」warnが出るが仕様どおり |
| 本番Stripe設定の確認（セキュリティ報告書2026-07-29のフォロー）: `STRIPE_WEBHOOK_SECRET` はRender envに設定済みで、`/api/billing/diagnose` は ok:true・webhook未設定警告なし（=webhook_secret_set true）。税率は10%・内税（総額¥22,000のまま内訳表示）で契約にも付与済み | 2026-07-30 | 確認済み |
| LPフォーカス状態（Hallmark audit punch list対応）: `:focus-visible` はC案刷新時に導入済みだったが、暗色地（CTAバンド・フッター）でリングが背景に同化していたため紙色に反転、`lp/style.css`（privacy/terms/tokushoho）にも追加 | 2026-07-30 | 実装済み（955f95f） |
| アクション提案ロジック第1段階（設計ドキュメント`action_logic_unified_2026-08-01.md`）の6決定: ①RMSジャンルベンチマークは手入力欄で対応（無ければ自店集計→デフォルトへフォールバック）②ROASは2段構え（100%割れ=出血アラート維持、300%未満+Limit CPO超過=停止候補は第2段階で実装）③CTRも2段構え（1%=既存緊急アラート維持、2%=新診断基準）④母数ゲートは月次430に換算（週100×30÷7。従来は月次も100で実質機能していなかった）⑤新商品はRPP診断の最低クリック50に引き上げ（KW単位50クリックの商品粒度読み替え）⑥診断パターン12（商品タイプ分離）は商品マスタ拡張まで見送り | 2026-08-01 | 第1段階実装済み（gates.py / benchmarks.py / products4カラム / genre_benchmarksテーブル）。第2段階実装済み（diagnosis.py の8分類、ROAS300%+Limit CPO複合条件、停止候補の試算+セカンドベスト併記、原価率設定済み商品のcpo_over判定有効化）。第3段階実装済み（item_targetsテーブル、target_calc.pyの確定公式MIN(現状,前年)、実績なし商品の推定+承認フロー、商品分析CSV取込時の自動再計算、目標設定画面のアイテム別セクション。※一括入力UIは別チケットのまま）。第4段階は旧3-G（広告予算按分）を取りやめ、v2（売上予算按分＋ギャップ逆算）として実装済み（次行参照） |
| アクション提案ロジック第4段階v2（売上予算按分＋ギャップ逆算）の決定: ①旧3-G「広告予算そのものの月次按分・上限管理」は**不要と確定**（作らない。広告費をいくらかけられるかは会社ごとの判断のため、許容広告費は都度入力・保存しない）②店舗全体の目標CVR・客単価は案1＝Target手入力を指標ごとに優先→無ければMIN(現状,前年)を店舗合算(site_uu軸)に適用③ギャップ逆算は順序型（アクセス→CVR→客単価のウォーターフォール踏襲）。CVR改善上限=MAX(現状,前年)＝過去到達水準、実績なしはベンチマーク解決値④アイテム別目標との整合性は「合計が月次予算を超えるときだけ警告」・強制同期なし⑤季節指数はMonthlyItemSales店舗合算が正（RPPフォールバックはconfidence上限medium）、有効月=月次430UU通過月のみ、24ヶ月+=high/12〜23=medium/12未満=均等按分/0ヶ月=新規店舗「まず1ヶ月データ収集」案内。指数・按分値は保存せず都度算出⑥予算年度起点はshops.budget_year_start_month（既定1月） | 2026-08-02 | 実装済み（revenue_plan.py / routers/revenue_plan.py / shops.annual_sales_budget+budget_year_start_month / GET /api/revenue-plan / RevenuePlanPanel.tsx / 目標設定画面の年間売上予算セクション / sample_data 14ヶ月化。コミット ae7d697・9013304・fd81a9d・b7fc631）。**本番検証済み（2026-08-02）**: デプロイ反映・`/api/security-status` ok:true・shopsカラム追加・デモ再生成後の按分（confidence=medium/有効14ヶ月）・実画面（案A/案B並列、12ヶ月プレビュー）を確認 |
| 第4段階v2の追加機能（手動補正・12ヶ月フル逆算）の決定: ①**サンプル再生成はShopの設定値を上書きしない**（現在値がNULLのときだけデモ値を入れる。UIで設定した年間予算が再生成で消える事象への対応）②月次売上予算は`targets.target_sales_budget`で月単位の手動補正が可能（null=自動按分）。**保存は専用API `POST /api/revenue-plan/override` のみで、既存 `POST /api/targets`（KGIフォーム）には絶対に載せない**（フォーム保存のたびに補正が消える事故になる）③**手動補正しても他月へは再配分しない**（12ヶ月合計と年間予算の乖離はフロントで情報表示）④12ヶ月フル逆算の目標CVR・客単価は基準月ロジックの対象月一般化（現状値=その月以前の直近実績月、前年値=その月の前年同月、MIN採用。Target手入力が指標ごとに常に勝つ）。前年同月経由で季節性が目標値に反映されるため月ごとに値が変わるのは仕様⑤CPCは各月のRPP実績、無い月は直近実績月で代用（CPCの季節性はスコープ外・UIに注記）⑥過去月にも逆算を表示する（事後検証用）⑦**`revenue_plan.py` のDBアクセスはプリフェッチ3クエリに集約する規約**（月ループ内で `db.query` を呼ばない。素朴ループだと1リクエスト約80クエリになる） | 2026-08-02 | 実装済み（sample_data.py上書きガード / targets.target_sales_budget / routers/revenue_plan.py override / revenue_plan.py build_context・build_month_cascade / 目標設定画面の年間目標プランナー表（サマリ⇄詳細切替・インライン編集）。コミット 36879fa・fc61c30・8ee6242・7f55cfd）。**本番検証済み（2026-08-02）**: `/api/security-status` ok:true・12ヶ月カスケード（応答666ms・全月にrequired_access/target_cvr(basis)/cpc_source等）・目標設定画面のサマリ⇄詳細切替・インライン編集で手動バッジ＋必要アクセス/広告費/達成率の再計算・解除で自動按分復帰・12ヶ月合計と年間予算の差分表示・**サンプル再生成で起点月9月が保持される（ガードの実証）** を実画面で確認 |
| 17パターン改善アクションの動的生成の決定: ①アクション文言は**参照資料の言い回しを使わず自社作成**（publicリポジトリのため。研修名のコード内言及も一般表現に置換済み）②決め打ちの17行テーブルは持たず、`focus`（未達KPIのウォーターフォール順）から見出し・打ち手を動的合成（1KPI未達=3件/複数=各2件、店舗全体・商品ページの2スコープ）③矛盾ケース（KPI全達成×売上未達）は特定KPIを名指ししない総合型見出し。**評価ランクは現行の△・優先度高を維持**（参照資料は○相当だが「診断は正直に・甘くしない」方針を優先。オーナー確認済み）④低母数=アクセス打ち手のみ／判定不可(パターン17)=目標・データ整備の案内⑤ジャンル・商品階層への展開は**今回見送り**（店舗レベルで効果を見てから別チケット。GAP行にはYoY集計が無くAPI拡張が必要） | 2026-08-02 | 実装済み（matrix_actions.py / evaluation.py の「売上のみ未達」時の空ラベルコメント崩れ修正 / /api/evaluation/matrix に actions 追加 / EvaluationMatrix.tsx 表示=ダッシュボード・GAP両画面。16通り＋特殊系の機械列挙で文の破綻なしを確認。コミット c9f828a・6aa349c）。**本番検証済み（2026-08-02）**: matrixレスポンスのactions返却（パターン14「アクセス・客単価を改善しましょう」shop4件/product4件）・実画面のカード表示・`/api/security-status` ok:true・publicリポジトリのrawファイルで研修名の不在を確認 |
| アイテム別目標の一括入力UI（計画書 `docs/jisso_keikaku_item_targets_bulk_2026-08-03.md`）: ①保存方式は一括1リクエスト `POST /api/item-targets/bulk`（対象月共通・1トランザクション、検証エラー時は全体ロールバック）。単発 `POST /api/item-targets` と `_upsert_one` で確定公式のコードパスを共有。②性能はプリフェッチ最適化せず素直なループ（低頻度の明示保存のため許容。revenue_planの高頻度表示系とは性質が違う、とオーナー承認）③絞り込み前提（商品名/管理番号検索・ジャンル大分類・未設定のみ）。ジャンルは一覧API `GET /api/item-targets` の各行に `genre_u1/u2/u3` を追加（実績優先→商品マスタのカテゴリ）④CSV入出力は第2段階に見送り（「Excelで一気に入れたい」要望が出たら着手。masters.pyのexport/import作法を流用予定） | 2026-08-03 | 区切り1(バックエンド)・区切り2(フロント)実装済み。**本番検証済み（2026-08-03、b1b5d0e）**: demoアカウントで3件（ACC-001/002/003）をまとめて入力→一括保存で目標CVR・客単価・必要アクセスが確定公式で一括算出・未保存バッジ/件数/ボタン活性、検索(プロテイン→1件)・未設定のみ(6件)・ジャンルドロップダウン(スポーツ=backend genre由来)を実画面で確認。`/api/security-status` ok:true（item_targets含む全テーブルRLS保護・unprotected空） |
| UIバックログ（計画書 `docs/jisso_keikaku_ui_backlog_2026-08-03.md`・5点承認済み）: 区切りA=テーブルソート共通化（`components/table/useTableSort`+`SortableTh`。降順→昇順→解除、null常に末尾、絞り込み後にソート適用の順で統一）、区切りB=期間UI刷新＋年次（**表示系4画面のみ。診断・アラート系は月次のまま＋注記**。年次=暦年固定・年間売上予算と突き合わせ）、区切りC=ダッシュボード再構成（案A=3層の強弱＋効率指標の表圧縮）。デザインスキルはskills.shから導入（CLAUDE.md Commands節参照・gitignore済み） | 2026-08-03 | **区切りA実装済み・本番検証済み（1b2224c）**: 商品別KPI(CVR降順/昇順)・アイテム別目標(必要アクセス)・RPP(広告費)の列クリックソートを実画面確認。適用5画面=商品別KPI/RPP/GAP/商品マスタ/アイテム別目標。**区切りB実装済み・本番検証済み（53cea66）**: period=yearly を dashboard/gap4本/products/export2本に追加（率は分子分母を年合算後に再計算・前期比=前年・商品ドリルダウンは商品単位合算で月跨ぎ重複排除・`get_shop_yearly`/`period_utils.py`/`MIN_ACCESS_SAMPLE_YEARLY=5220`）。年次のKGI目標=annual_sales_budget→月次targets年内合算フォールバック。PeriodSelector刷新（セグメント＋実集計期間ラベル常時表示＋ラベルクリックでピッカー＋最新データへ。週次ピッカーは日曜起点週に丸め）。**年次中は診断系（今日やること/評価マトリクス/アラート/アクション提案/売上予算プラン/ActionSummary/ActionPanel）を呼ばず注記表示**。本番実画面: ダッシュボード年次(達成率49.9%=1496万/3000万・注記・診断非表示)・GAP年次(KGIツリー年合算・目標未設定表示)・月次リグレッション・security-status ok:true を確認。**区切りC実装済み・本番検証済み・オーナーOK済み（cee19a4）**: ダッシュボードを3層構成に再編。1層=KGIヒーロー（売上vs目標・達成率バー・**着地見込み=進行中期間のみ実績÷経過割合**）＋売上3分解（週次=RPP軸/月次・年次=商品分析軸をgap/shopから取得。**軸を混ぜない**）。2層=今日やること→アラート→評価マトリクス→施策のその後。3層=利益・広告投資4枚（標準カード）＋詳細指標12個を`<details>`表に圧縮（既定畳み・CPO/CPCは下がる方が良い色反転・Limit CPO超過行ハイライト）＋グラフ帯＋売上予算プラン/アクセス逆算。旧「店舗全体の実績」hero4枚はヒーロー帯と重複のため削除 |
| Supabase Auth の確認メール（Confirm signup）を日本語化＋独自SMTP（Gmail）で送信。**設定はすべてSupabaseダッシュボード側で、コード・envには一切持たない**。設定場所は Authentication → Emails。SMTP は Sender email `sales@ureshiru.com`／Sender name `ウレシル`／Host `smtp.gmail.com`／Port `587`／Username `shoichiro.nakamura.0601@gmail.com`（送信認証はこのGmailアカウント。**パスワードはこのアカウントのGoogleアプリパスワード**で、名前は `ureshiru-supabase-auth`。値はダッシュボードのみ・ここには書かない）。**注意点**: (a) Gmail SMTP はFromに認証アカウント以外（sales@…）を使うと受信側で「gmail.com 経由」と表示される（動作上は問題なし。消すには独自ドメイン認証＝SendGrid等への移行が必要）。(b) Gmail の送信上限は概ね1日500通。登録が増えたら SendGrid 等へ切替を検討。(c) テンプレのSubject/BodyはカスタムSMTP設定前は編集不可（読み取り専用）になる仕様 | 2026-08-03 | 実装済み・本番動作確認済み。Confirm signupテンプレを日本語化して保存（件名`【ウレシル】メールアドレスの確認をお願いします`）。**実登録テストで日本語メール受信を確認（2026-08-03、k11mm121@gmail.com宛）**。※途中 `535 5.7.8 Username and Password not accepted`（auth-logs）でつまずいたが、原因はアプリパスワード（Gmailは4文字区切り表示・スペースごと貼ると弾かれる／2段階認証必須）。スペースを抜いて再入力で解決。**追加対応（2026-08-03）**: 同じトーンで Reset password（件名`【ウレシル】パスワード再設定のご案内`）と Change email address（件名`【ウレシル】メールアドレス変更の確認`）の2テンプレも日本語化・保存済み（場所は同じ Authentication → Emails。SMTP設定は共通のため変更なし）。Magic Link は利用有無未確認のため英語のまま据え置き。**追加対応2（2026-08-03）**: Emails画面の**Security セクション**（Authenticationセクションとは別枠の「操作完了の事後通知」）のうち、Password changed（件名`【ウレシル】パスワードが変更されました`）と Email address changed（件名`【ウレシル】メールアドレスが変更されました`）も日本語化・保存済み。**後者は `{{ .OldEmail }}`／`{{ .Email }}` で変更前後のアドレスを本文に併記**（乗っ取りに気づきやすくするため）。両方ともトグルは元からON。同セクションの Phone number changed / Sign-in method linked・removed / MFA method added・removed は**全てトグルOFF＝未使用のため未翻訳**（MFA等を導入する際に合わせて日本語化すること） |
| サイドバー折りたたみ（計画書 `docs/jisso_keikaku_sidebar_collapse_2026-08-03.md`・3点承認済み）: ①折りたたみ時のラベル補完は **`title` 属性を使わずCSS自作ツールチップ**（`title` は表示が1〜2秒遅く、キーボードフォーカスでは出ない。折りたたみ時はラベルが唯一の手掛かりのため `group-hover` に加え `group-focus-visible` でも表示。ツールチップは `aria-hidden` で、読み上げ名は `aria-label` が担う）②トグルは**上部ロゴ行の右端**・lucide の `PanelLeftClose`/`PanelLeftOpen`（目線の起点が上・下部は項目数が多く埋もれるため）③**幅のアニメーションは入れない（即時切替）**。`width` のトランジションは毎フレーム再レイアウトが走り、商品マスタのような重いテーブルを右に抱えると確実にカクつく。**「ふわっと動かす」要望は出ていない＝再浮上しても入れない**④折りたたみ時のアクティブ表示は「アイコンの赤角丸ボックス」＋「行左端の3px縦バー」の2点（64px幅では塗りだけでは見落とす）⑤永続化は `localStorage`（キー `ureshiru:sidebar-collapsed`・lazy initializerで初回描画から確定値・例外は握りつぶす）。スマホ幅のハンバーガーとドラッグ幅可変は**今回スコープ外** | 2026-08-03 | 実装済み（`frontend/src/components/layout/Sidebar.tsx` 単体の変更。App.tsx は無変更＝`<main className="flex-1">` が残り幅を自動で埋めるため）。ついでに全ナビ項目へ `focus-visible` リングと `touch-manipulation` を追加。**検証済み**: `npm run build` 型エラー0／ヘッドレスChromeで展開・折りたたみ・ホバーとフォーカス時のツールチップ表示・リロード後の維持（幅64pxで復帰）を実画面確認。**本番反映済み（68a1c38）**。**追加対応（同日・オーナー指摘）**: サイドバーを畳んでも商品マスタ・目標設定の中身が広がらなかった。原因はこの2画面だけ `max-w-4xl mx-auto`（896px）で頭打ちだったこと（ダッシュボード・GAP・商品別KPI・RPPは元から上限なし）。**上限を撤廃して全幅に統一**（フォーム・カードも横に伸びるのは承知のうえで許容）。**ページ直下のコンテナに `max-w-*` を戻さないこと**（戻すとサイドバー折りたたみの意味が無くなる）。ただし**表・注記など個々のブロックに付ける上限幅は別**で、全幅化の副作用（列数の少ない表の間延び・注記の1行が長すぎる）への対策として意図的に入れている: 目標設定の年間目標プランナー表は `max-w-2xl`（サマリ5列）/`max-w-5xl`（詳細9列）＋`tabular-nums`、その周辺の注記3箇所は `max-w-3xl` |
| 数字とグラフの見せ方の全画面展開（計画書 `docs/jisso_keikaku_design_rollout_2026-08-04.md`／規則 `docs/ui_number_and_chart_rules_2026-08-04.md`／知識 `docs/ui_design_knowledge_2026-08-04.md`）: **オーナー承認済み2点** ①進め方は「先に共通部品を作り、画面には貼るだけにする」＝**区切り0（共通部品）→1（ダッシュボード）→2（商品別KPI・RPP）→3（フォーム系4画面）→4（GAP分析）**、各区切りでデプロイして目視②**GAP分析のロジックツリーは各ノードを弾丸グラフにする**（枝は残す。色だけ差し替える案・ツリーをやめる案は不採用）。**未決**: GAPの右サイドのアクションパネルの扱い（VISIONの「最終地点はアクション」に照らすと今より強くするのが筋）／GAPのドリルダウンUI自体を触るか（推奨は触らない）／表の金額を丸めるか生値のままか。**方針の要点**: 金額は万・億（日本語圏は1万単位で数えるため K/M は使わない）、割合指標の前期比は「%」でなく「pt」（数値の正しさの問題）、良い方向は指標ごと（CPC・CPO・広告費は下がったら緑／クリック数・注文件数・アクセス・売上原価・店舗運営経費は中立）、目標進捗は進捗バーでなく弾丸グラフ（上限100%で目標超過を表現できないため）。**採らないもの**: ダークテーマ・ネオン・グラスモーフィズム・3D（`ui_design_knowledge` の決定） | 2026-08-04 | **区切り0実装済み**（`lib/format.ts` / `lib/metrics.ts` / `components/kpi/{Delta,BulletChart,Stat,Sparkline}.tsx` / `components/chart/defaults.ts` を新規作成。既存画面は未変更＝表示は何も変わっていない）。`npm run build` 型エラー0。**区切り1以降は未着手** |

## ⚠️ セキュリティ最優先事項: 新しいテーブルには必ずRLSを（顧客データ漏洩の防止）

**このプロダクトは他社（EC事業者）の売上データを預かる。データ漏洩は一度でも起こしてはならない。**

### 実際に起きたこと（2026-07）

`models.Base.metadata.create_all()` で作成したテーブルは **RLSが無効のまま** `public` スキーマに置かれる。
Supabase は `public` スキーマを Data API (PostgREST) 経由で公開するため、
**フロントのJSに埋め込まれた anon キーだけで、誰でも全データを読み書きできる状態だった。**

実際に未ログイン・anonキーのみで商品名・売上・目標値の実データが取得できることを確認済み。
Supabase Security Advisor に `rls_disabled_in_public` の Critical が9テーブル分出ていた。

補足: **anonキーが漏れていたわけではない。** anonキーは公開が前提の値で、
本来の防御はRLSが担う。そのRLSが無効だったため防御がゼロだった。

### 現在の防御（3重）

1. **起動時に自動強制** … `migrations._enforce_rls_pg()` が `pg_tables` を走査し、
   RLS未適用のテーブルを自動で `ENABLE ROW LEVEL SECURITY` する。
   **新しいモデルを追加してもデプロイすれば自動で塞がる。** 冪等。
2. **可視化** … `GET /api/security-status` が `unprotected` を返す。
   ここが空でなければ即対応が必要。
3. **このドキュメント**

### 新しいモデルを追加するときの必須確認

- `UserScopedMixin` を継承する（ユーザー単位のデータ分離。`tenancy.py` 参照）
- デプロイ後に `GET /api/security-status` で `ok: true` / `unprotected: []` を確認する
- **RLSを無効化するコードを書かない。** どうしても必要なら理由をここに追記すること
- **`backend/sample_data.py` を一緒に更新する。** 新しいテーブル・フィールドを追加する機能実装のたびに、`generate_sample_data()` に生成処理を足す（起動時削除も忘れずに）。サンプルデータが実スキーマから遅れると、デモ・動作確認・オンボーディングが壊れる。

### なぜアプリが壊れないか

バックエンド(FastAPI)は `DATABASE_URL` でテーブル所有者(`postgres`ロール)として直接接続しており、
**所有者はRLSをバイパスする**。そのためポリシーを1つも作らなくてもアプリの動作は変わらず、
Data API 経由の anon / authenticated アクセスだけが全拒否される。
（`FORCE ROW LEVEL SECURITY` は所有者にも適用されてしまうので使わないこと）

楽天（Rakuten）出店者向けのKPI管理アプリ。FastAPIバックエンド + React/Viteフロントエンドの2構成。楽天RMSからエクスポートしたCSVを取り込み、KGI→KPIのロジックツリー分解・GAP分析・RPP広告実績を可視化する。UI・コメント・エラーメッセージはすべて日本語。

## この製品が目指しているもの（必読）

**事業コンセプトは [`docs/VISION.md`](docs/VISION.md) を参照。実装や優先順位に迷ったらそこに立ち返る。**

要約すると、これは「楽天の分析ツール」ではなく **ECコンサルティングをAIで民主化する** ためのプロダクトで、
最終形は EC事業者の**意思決定OS**（AIストアマネージャー）。ダッシュボードを見せることが目的ではなく、
店舗が「次に何をすればいいか」を判断できる状態を作ることが目的。

そのため、コードを書くときは以下を判断基準にする（詳細は VISION.md 末尾）:

- **出力の最終地点は数値ではなく次のアクション。** 数値を並べただけの画面は未完成とみなす。
- **データが無いときこそ意思決定を止めない。** 「データがありません」で画面全体を隠さず、
  「今わかること」と「まだわからないこと」を切り分けて提示する。
  （実例: 商品分析データがあるのにRPP未取込というだけで月次が全面空白になる不具合があった）
- **将来のモール横展開（Amazon/Shopify等）に備え、モール固有の取込み層とKPI計算ロジック層を混ぜない。**

## Commands

開発（Windows）はリポジトリ直下の `start.bat` がバックエンドとフロントを別ウィンドウで同時起動する。個別に動かす場合:

```powershell
# バックエンド（cwd = backend/、ポート8000）
cd backend
py -3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
# → API: http://localhost:8000 / Swagger: http://localhost:8000/docs

# フロント（cwd = frontend/、ポート5173）
cd frontend
npm install      # 初回のみ
npm run dev      # 開発サーバー（/api を 127.0.0.1:8000 にプロキシ）
npm run build    # tsc 型チェック + vite build（CIの代わり。型エラー0必須）
```

依存導入: backend は `pip install -r backend/requirements.txt`。

**AIエージェント用スキル（UI作業時）**: skills.sh のデザインスキルを利用する。`.agents/` `.claude/skills/` `skills-lock.json` は第三者コンテンツのため**gitignore済み・コミットしない**（2026-08-03決定）。新しい環境では `npx skills add vercel-labs/agent-skills` で再導入し、使うのは `web-design-guidelines`（UIレビュー）・`vercel-react-best-practices`・`vercel-composition-patterns` の3つ（他は削除してよい）。shadcnスキルは**このリポジトリがshadcn/ui未使用のため対象外**。

**テストフレームワークは未導入**（pytest等なし）。検証は (1) `cd backend && py -3 -c "from main import app"` のimport確認、(2) `cd frontend && npm run build` の型チェック、(3) uvicorn起動して `curl` でエンドポイントを叩く、で行う。ロジック単体検証は対象関数をその場で `py -3 -c "..."` 呼び出しする。

## Windows固有の注意

- `vite.config.ts` のプロキシ先は `http://127.0.0.1:8000`（`localhost` 不可）。Windows+Node18+では `localhost` がIPv6 `::1` を先に引き、IPv4でbindするuvicornへのフォールバックが遅延して「Failed to fetch」になるため、IPv4直指定で固定している。**この設定を `localhost` に戻さないこと。**
- 「Failed to fetch」の典型原因は、**古い`uvicorn`プロセスがポート8000を掴んだまま旧コードを返している**ケース。新エンドポイントが404/挙動不一致なら、まず`:8000`を掴むプロセスを停止して再起動する。

## アーキテクチャ

### バックエンド（`backend/`）

- `main.py` がエントリ。起動時に `models.Base.metadata.create_all()` でSQLite（`rakuten_kpi.db`）にテーブルを自動生成する（マイグレーションツールなし＝モデル変更は手動でDB削除 or ALTER）。全例外は `global_exception_handler` が `{"detail": str(exc)}` のJSON 500に変換。CORSは `localhost:5173`/`3000` のみ許可。
- ルーターは `backend/routers/` 配下（dashboard / import_csv / targets / gap_analysis / products / actions / evaluation / export / account）。**規約: 全エンドポイントは常にJSONを返す（データ無しでも `{}`/`[]`）。** フロントはこれに依存している。
- **クエリパラメータの列挙値は `typing.Literal[...]` で型注釈する。** `Query(..., enum=[...])` はPydantic v2環境ではバリデーションされず不正値が素通りする既知の落とし穴があり、`period`/`level`/`period_type` 等はすべて `Literal` に統一済み。

### マルチテナント（ユーザー別データ分離）— `backend/tenancy.py`

- 全データテーブルは `UserScopedMixin` を継承し `user_id` 列（SupabaseユーザーUUID）を持つ。**新しいモデルを追加するときは必ず `UserScopedMixin` を継承すること**（継承しないと全ユーザー共有になる）。
- 絞り込みはSQLAlchemyイベントで自動適用: `do_orm_execute` が全 SELECT/UPDATE/DELETE に `user_id = 現在ユーザー` を付与（`with_loader_criteria`。集計クエリや `Query.delete()` にも効く）、`before_flush` がINSERT行に user_id をスタンプ。**ルーター側で user_id を意識する必要はない**が、生SQL（`text()`）には自動適用されないので手動で絞ること。
- 現在ユーザーは `auth.UserContextMiddleware`（ASGI）がContextVar `tenancy.current_user_id` にセットする。FastAPIの同期依存関係内でContextVarをセットしても伝播しない（スレッドプールのコンテキストコピー）ため、ミドルウェア方式。
- 認証無効（ローカル開発）時は `user_id IS NULL` の行のみ対象＝従来どおり単一ユーザーで動く。
- ユニーク制約は user_id 込み。既存DBは起動時の `migrations.run_migrations()` が user_id 列追加・Postgresの制約張り替えを冪等に実行。マルチテナント化以前のデータ（user_id NULL）は env `LEGACY_DATA_USER_ID` で特定ユーザーに割り当て可能。

### アカウント管理

- フロント: `/account`（`AccountSettings.tsx`）＝メール変更・パスワード変更（Supabase `updateUser`）・退会。`Login.tsx` にパスワードリセットメール送信、`ResetPassword.tsx` は `PASSWORD_RECOVERY` イベント時にApp.tsxが表示。
- バックエンド: `routers/account.py`。退会（`DELETE /api/account`）＝本人の全データ削除 + Supabase Admin APIでユーザー削除。**env `SUPABASE_SERVICE_ROLE_KEY` 必須**（未設定は501）。service_roleキーは絶対にフロントへ渡さない。

### KPI計算は `backend/calculations.py` が単一の真実

全KPIの計算式は `calc_kpis()` に集約。重複実装せずここを参照・修正する。定義上の注意:
- `roi = gp / ad_cost`（**粗利ベース＝ROASの粗利版**。財務的なROI=純利益/投資ではない）。アラート閾値 `roi < 100` は「広告費が粗利を超過＝赤字」の意味で正しい。
- `cvr = cv / ct`（クリック→注文）。一方 `MonthlyItemSales.cvr` は「訪問UU→注文」で**母数が異なる**。アクセス指標の2軸（`rpp_click` / `site_uu`）と低母数除外ルール（`is_reliable`）の定義は **`backend/access_definitions.py` が単一の真実**。アクセス関連の値を返す新APIは必ず `access_axis` を含め、同一画面で両軸を混在させない。
- `rev`（利益残）= `gp - (ad_cost + steady_cost)`、`steady_cost = gross * expense_rate`（`expense_rate` は `Target` 由来、既定0.15）。

### データモデル（`backend/models.py`）と取り込み2系統

CSVパースは `backend/routers/import_csv.py`。エンコーディング/スキップ行はRMSの書式に合わせて固定:

1. **RPP広告レポート（Shift-JIS, 先頭8行スキップ）** → 2テーブルに同時書き込み:
   - `RppWeekly` … 既存集計テーブル。dashboard / gap_analysis / products が**集計に使うのはこちらのみ**。
   - `RppSales` … 生データ保管。週次/月次両対応、720h/12hの2アトリビューション値（`gross_720`/`gross_12`等）を保持。`/api/import/rpp/{periods,sales,summary}` の新エンドポイント専用。
   - 計測期間文字列から週次/月次を自動判別（`2026年03月01日〜07日`=weekly / `2026年03月`=monthly）。
   - ⚠️ **二重計上注意**: 1インポートで両テーブルに書く設計のため、`RppSales` を使う新たな集計を足すと `RppWeekly` 由来の既存集計と二重計上になりうる。役割分離を守ること。
2. **月次商品分析（UTF-8 BOM, 先頭5行スキップ）** → `MonthlyItemSales`。ジャンルが大/中/小（`genre_u1/u2/u3`）に分割済み、アクセス・CVR等を保持。
   - `MonthlyAnalysis` は旧スキーマ（レガシー）。新規はなるべく `MonthlyItemSales` を使う。

### 週次/月次の期間ロジック（gap_analysis.py / dashboard.py）

- `weekly`: `RppWeekly.week_start`（日曜始まり）の完全一致でフィルタ。
- `monthly`: `func.strftime("%Y-%m", RppWeekly.week_start) == ym` で集計。⚠️ 月跨ぎの週は開始日の月に丸められるため、`MonthlyItemSales` の正確な月次値とは僅差が出る既知の制約。
- 前月（前期）は必ずリクエストの `year_month` から `_prev_month()` で導出する（`today` 依存にしない）。
- KGIツリー（`/api/gap/kpi-tree`）は `KGI = アクセス × CVR × 客単価` をすべて `RppWeekly` 由来で統一（access=クリック数ct）。`MonthlyAnalysis.access_count` は母数が異なるため使わない。
- ジャンルGAP（`/api/gap/genre`）は `RppWeekly.genre` の `/` 区切りを階層分解し、`level`(u1/u2/u3) と `parent` で絞り込む。既存レスポンスキーは維持し階層情報キーを追加する後方互換方針。

### フロントエンド（`frontend/`）

- `src/App.tsx` がルーティング（`/`=Dashboard, `/gap`=GapAnalysis, `/products`=ProductKPI, `/import`=DataImport, `/targets`=TargetSetting, `/rpp`=RppAnalysis）。
- **法的文書（特商法・プライバシーポリシー・利用規約）はこのアプリ内に持たない。** 正はLP（`https://ureshiru.vercel.app` = Stripeに「ビジネスウェブサイト」として登録しているサイト）側にあり、アプリからは `src/lib/links.ts` の `LEGAL_LINKS` を使って外部リンクで飛ばす（フッター・ログイン画面・`/billing` の申込ボタン付近）。
  - **アプリ内に法的ページを作り直さないこと。** 一度アプリ側にも同じページを作ってしまい、価格改定でLP側と食い違う状態を招いた（LP: ¥19,800 / アプリ: ¥22,000）。文書が2箇所にあると必ずズレる。
  - Stripeの審査担当者が見るのは**LP側**。特商法は「購入前」の表示を求めているが、購入導線（`/billing`）から外部リンクで到達できれば要件を満たせる。
  - 独自ドメインへ移行する場合は `lib/links.ts` の `LP_BASE_URL` の1行を直す。
- 価格（月額 ¥20,000税抜 / ¥22,000税込）の表示箇所は**アプリとLPにまたがる**。改定時は下記すべてとStripeのpriceを同時に直す。
  - アプリ: `backend/billing.py` の `PLAN_AMOUNT_LABEL`（＋診断が突き合わせる `PLAN_AMOUNT_JPY`＝税込22000 / `PLAN_AMOUNT_EXCL_TAX_JPY`＝税抜20000 / `TAX_RATE`）
  - **LP（別リポジトリ）**: 料金セクション、特商法の販売価格、利用規約の利用料金
  - Stripe: price の `unit_amount`**総額表示義務があるので税込金額を主表記から外さない**（税抜のみの表示にしない。税抜・税込は同じ視認性で並列表示）。
- **消費税は Stripe Tax（自動税計算）を使わない**（2026-07 に方針変更）。取引ごと0.5%の手数料がかかるため。代わりに次の2つを組み合わせる。
  - Price は【税込 ¥22,000】(`unit_amount=22000`・内税)で登録する。
  - **無料の「税率」(Tax rates)を手動で1つ作り**（10%・`inclusive=true`・日本）、Checkout の `subscription_data.default_tax_rates` に渡す（env `STRIPE_TAX_RATE_ID`）。これで請求書に「消費税 10% ¥2,000（内税）」の内訳が出る（総額は¥22,000のまま）。**適格請求書発行事業者として登録済みなので、顧客の仕入税額控除のために内訳が必要。** 登録番号(T+13桁)はStripeの請求書テンプレート側に設定する（コードでは扱わない）。
  - ⚠️ **`default_tax_rates` と `automatic_tax` は併用できない。** Stripe Tax を有効にするとCheckout作成が拒否される。`automatic_tax` は渡さない（既定=無効）。
  - ⚠️ **envに税率を設定しても既存の契約には遡って適用されない。** 税率を追加・変更したら契約を作り直す必要がある。診断が契約側の `default_tax_rates` を検査する。
- **Managed Payments は明示的に無効化する**（`managed_payments={"enabled": False}` を Checkout に渡す）。Stripeアカウントでは**既定で有効**で、有効だと `default_tax_rates` が `Unsupported parameter` で拒否される。使わない理由は、**Managed Payments が日本国内取引の税務を代行しないから**（Stripeのドキュメントに、間接税を扱うのはシンガポールB2B国内と日本の全国内取引を「除く」国と明記）。国内向けの当サービスでは消費税の責任は自分に残る一方、税率指定と請求書発行はStripe側に握られ、適格請求書（登録番号・税額内訳）を自分で制御できなくなる。アカウント設定でも切れるが、既定が有効なのでコード側で明示しておく。
  - ⚠️ **`PLAN_AMOUNT_EXCL_TAX_JPY`（税抜20000）は表示のための手計算値**で、Stripeの設定から導かれる値ではない（22000 ÷ 1.1）。**消費税率が変わっても自動追従しない。** 税率改定時は Stripeのprice金額・`PLAN_AMOUNT_JPY`・`PLAN_AMOUNT_EXCL_TAX_JPY`・`TAX_RATE`・`PLAN_AMOUNT_LABEL`・特商法ページ・利用規約を**すべて手で**直す。診断が税抜表示と税込金額の整合性を検査するので、価格まわりを触ったら `GET /api/billing/diagnose` を必ず実行する。
- **すべてのAPI呼び出しは `src/lib/api.ts` の `request()` / `parseJson()` ヘルパー経由にする。** `res.text()` → 空ならフォールバック → `JSON.parse` をtry/catch、`Failed to fetch` も捕捉して日本語メッセージ化し、空レスポンスやパース失敗でUIをクラッシュさせない。新しいfetchを直書きしない（FormDataアップロードも同パターンを踏襲）。
- 各ページ・グラフ（Recharts）は空配列/undefined時に「データなし」を表示するガードを入れる。
- 型は `src/types/index.ts` に集約。

#### 画面幅の規約（2026-08-04 決定）

サイドバー折りたたみ（`Sidebar.tsx`、224px ⇄ 64px）を活かすため、**ページ直下のコンテナには `max-w-*` を付けない（全幅）**。幅の制御はブロック（カード）単位で行う。

| ブロックの性格 | 上限幅 | 例 |
|---|---|---|
| 列数の多いテーブル（8列以上） | 付けない（全幅） | 商品マスタの商品一覧、商品別KPI、RPP、GAP |
| 中くらいのテーブル（6〜7列） | `max-w-5xl`（1024px） | アイテム別目標、年間目標プランナー（詳細9列） |
| 列の少ないテーブル（〜5列） | `max-w-2xl`〜`max-w-3xl` | 年間目標プランナー（サマリ5列）、設定済み目標一覧 |
| フォーム系カード | `max-w-3xl`（768px） | 対象月・KGI・KPI目標値・経費設定・店舗設定 |
| 説明・注記テキスト | `max-w-3xl` | 年間目標プランナー周辺の注記3箇所 |

- フォーム行の共通コンポーネント（`TargetSetting.tsx` の `Field`）は `grid-cols-3` なので、上限を付けないとラベル列が全体の1/3（1800px画面なら約600px）を占め、ラベルと入力欄が離れる。**`Field` 自体に `max-w-3xl` を持たせてある**
- **ページ直下に `max-w-*` を戻さないこと。** 戻すとサイドバー折りたたみの意味が無くなる（2026-08-03 に実際にこれで指摘を受けた）
- 逆に、**ブロック単位の `max-w-*` を「全幅にすると決めたのに矛盾している」と消さないこと。** 全幅化の副作用（列の少ない表の間延び、1行が長すぎる注記）への対策として意図的に入れている
- 数値の列を持つ表には `tabular-nums` を付ける（桁位置を揃える）
- **データ取込み（`max-w-5xl`）とレポート出力（`max-w-4xl`）はページ直下の上限を残したまま据え置き**。フォーム中心の画面で広げる必要が薄いため（2026-08-04 判断）。統一したくなったらこの2画面も上表のルールに寄せる

#### 数字とグラフの規約（2026-08-04 決定）

**根拠と全文は `docs/ui_number_and_chart_rules_2026-08-04.md`。** ここは実装で必ず守る点だけ。

- **金額は `lib/format.ts` を通す。** 万・億で丸める（`¥965.0K` ではなく `96.5万円`）。日本語圏は1万単位で数えるため。カードとグラフの軸は丸め、**表・ツールチップ・CSVは丸めない**。CSVは `forExport()`（桁区切り・単位なし）を使い、表示用の関数を流用しないこと
- **割合の指標（CVR/CTR/ROAS/ROI/GPR/達成率）の前期比は「%」ではなく「pt」。** `formatPoint()` を使う。`3.42% → 3.24%` は `-5.3%` ではなく `-0.18pt`。これは見た目ではなく数値の正しさの問題
- **良い方向は `lib/metrics.ts` の `direction` から引く。** `up = 緑` を決め打ちしない（CPC・CPO・広告費は下がったら緑、クリック数・注文件数・アクセス・売上原価・店舗運営経費は中立で色を付けない）
- **目標に対する進捗は `components/kpi/BulletChart.tsx`（弾丸グラフ）を使う。進捗バーを使わない**（上限100%なので目標超過を表現できない）
- **デルタは絶対値＋矢印。マイナス記号を使わない。** 比較できないときは空欄にせず4状態を出し分ける（`components/kpi/Delta.tsx`）
- **大きい数字は1画面に1つ、多くて2つ。** `Stat` の `size="hero"` は1画面1回まで
- **日本語ラベルに `uppercase` / `tracking-wide` を付けない**（効かないか間延びする）
- **グラフは `components/chart/defaults.ts` を import する。** グリッドは実線の極薄（破線にしない）、単系列に凡例を出さない、未確定期間は点線
- **しきい値の判定は生の数値で行う**（表示用に丸めた文字列で比較しない）
- 表: 数値は右寄せ＋`tabular-nums`、単位は見出しに1回、**ゼブラ縞は使わない**（背景色は警告行専用に空けておく）

### `.claude/agents/`（任意）

`backend-engineer` / `frontend-engineer` / `data-analyst`(読取専用) / `qa-debugger` の専門サブエージェント定義あり。担当領域は backend=`/backend`、frontend=`/frontend` に分け、同一ファイルの同時編集を避ける運用。

## 楽天RMS CSVフォーマット仕様（インポート処理の実装時は必ず参照）

### ① RPP広告レポート（週次）
- **文字コード:** Shift-JIS
- **skiprows:** 8（9行目がヘッダー、10行目からデータ）
- **期間の取得:** 5行目「集計期間: 全期間で集計 YYYY-MM-DD - YYYY-MM-DD」を正規表現でパース
  - パターン: `集計期間:.*?(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})`
  - ※「計測期間」という列名はデータ行に存在しない

- **主要列名（実際の列名）:**
  | 用途 | 列名 |
  |------|------|
  | 日付 | `日付`（形式: 2026年05月24日〜2026年05月30日）|
  | 商品管理番号 | `商品管理番号` |
  | クリック数 | `クリック数(合計)` |
  | 広告費 | `実績額(合計)` |
  | 売上金額 | `売上金額(合計720時間)` ★12時間版ではなく720時間を使う |
  | 売上件数 | `売上件数(合計720時間)` |
  | CVR | `CVR(合計720時間)(%)` |
  | ROAS | `ROAS(合計720時間)(%)` |

---

### ② 商品分析レポート（月次）
- **文字コード:** UTF-8 BOM付き（utf-8-sig）
- **skiprows:** 5（6行目がヘッダー、7行目からデータ）
- **期間の取得:** 3行目「表示期間,2026年05月から2026年05月」をパース
  - パターン: `表示期間,(\d{4})年(\d{2})月から`

- **主要列名（実際の列名）:**
  | 用途 | 列名 |
  |------|------|
  | 商品管理番号 | `商品管理番号`（RPPとの結合キー）|
  | 商品名 | `商品名` |
  | ジャンル | `ジャンル`（例: 靴 > 靴ケア用品 > 靴ひも）|
  | 売上 | `売上` |
  | 売上件数 | `売上件数` |
  | アクセス人数 | `アクセス人数` |
  | ユニークユーザー数 | `ユニークユーザー数` |
  | 転換率 | `転換率`（形式: "13.45%" → float変換時に%を除去）|
  | 客単価 | `客単価` |
  | 在庫数 | `在庫数` |
  | 在庫0日日数 | `在庫0日日数` |

---

### 両レポートの結合キー
- RPP `商品管理番号` ＝ 商品分析 `商品管理番号`（例: fs01, ns01）

### よくある間違い（禁止事項）
1. RPPの売上に `売上金額(合計12時間)` を使わない → 必ず `720時間`
2. RPPの期間を列から取得しない → 必ず5行目からパース
3. 商品分析をShift-JISで読まない → utf-8-sig
4. 商品分析の転換率をそのままfloat変換しない → %除去してから変換
5. skiprowsをRPP/商品分析で混同しない → RPP=8、商品分析=5
