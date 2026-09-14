# 夜勤 作業報告（2026-09-14）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` を確認したところ、`stamp:"wait"`（急務）は**0件**だった
（残るのは `stamp:"kouho"` の候補9件と `stamp:"later"` の後日2件のみ）。着手対象が無いため、
前段の実装作業は行わなかった。

STATUS（領国・評定・守り・軍費）の実態照合で1点動きがあった:

- 評定「議案なし」… `list_pull_requests`（open）を確認したところ、週次security-checkルーチンが
  作成した [PR #106](https://github.com/Shoichiro12/rakuten-kpi-app/pull/106)
  （`docs/office_map.html`・`security/index.md`・`security/security_check_2026-09-14.md`の3ファイル
  のみ変更、`mergeable_state: clean`、CIは`Cloudflare Pages`のみで`success`）が開いていた。
  CLAUDE.md「🔀 自動マージの基準」（`docs/`・`security/`等のみの変更・コンフリクトなし・CIグリーン）
  を満たしていたため、夜勤の自己判断でマージした（マージコミット`2afad31`）。マージ後は改めて
  オープンPR0件を確認し、「評定: 議案なし」は実態と一致する状態に戻った
- 守り「9/7検分 高0」… マージした週次security-checkの結果により`security/security_check_2026-09-14.md`
  が新設され、当STATUSは既に「9/14検分 高0」へ更新済み（PR #106の変更内容として反映されていたもの
  をそのまま取り込んだ形。夜勤側で追加更新の必要は無かった）
- 軍費「月 約$33」… `.claude/agents/infra-ops.md`のコスト内訳（$7+$25+約$1+$0=$33）と一致。変更不要

急務が無かったため、それ以外の普請作業は行っていない。

## 後段: 巡回（発見専用フェーズ）

`docs/gunrei_kouho.md`（候補一覧11件・却下済み1件）と`docs/office_map.html` QUESTSの既存候補9件・
CLAUDE.md申し送り台帳と照合したうえで、直近の機能追加（管理画面からの無償アカウント招待、
2026-08-31〜09-04）を中心にコード・ドキュメントを見比べ、新規候補を2件発見した（1晩3件までの
枠内）。

1. **招待メールの有効期限表示「1時間」が仮値のまま実測されていない**
   （`backend/notifications.py:30` `_INVITE_EXPIRES_LABEL_DEFAULT = "1時間"`、
   `backend/routers/admin_comp.py`の`send_invite()`呼び出し2箇所とも`expires_label`引数を
   渡していないため常にこの既定値を使う）。2026-08-31の実装時点でCLAUDE.mdに「仮の既定値、
   実測して§4のexpires_labelを必要なら調整」と明記されていたが、その後の2026-09-01・09-04の
   本番検証はいずれも招待発行直後にリンクをクリックする形で行われており、「表示どおり実際に
   1時間で切れるか」自体は一度も実測されていない。表示と実際のSupabaseトークンTTLが食い違うと、
   顧客が案内を信じたのに早期にリンクが切れて開けない、という問い合わせに繋がりうる。
   実測には管理者による実招待発行＋時間差クリックという本番操作が必要なため、Claude Code
   セッション単独では検証できない
2. **CLAUDE.md:153が招待メール文面の関数を実在しない`invite_body()`という名前で参照している**。
   2026-09-04のHTML化で`invite_body_text()`/`invite_body_html()`の2関数に分割済み
   （`grep -n "^def " backend/mail_templates.py`で確認）だが、CLAUDE.md側の記述は分割前の
   単一名のまま残っていた。同じ行の「文面は2箇所にある」という見出しも、HTML化以降は実質
   3箇所（テキスト・HTML・フロントのプレビュー）になっている。申し送りルール6が警告する
   「記述と実装の食い違い」の実例。なお実装自体は正しく、フロントの`buildInvitePreview()`は
   現行`invite_body_text()`と一言一句一致することを突き合わせ済み（機能上のバグは無い、
   ずれているのは説明文のみ）

いずれも`docs/office_map.html` QUESTSに`stamp:"kouho"`として追記、`docs/gunrei_kouho.md`
候補一覧に詳細行を追加した。既存の急務・候補・却下済み・CLAUDE.md記載事項とは重複しないことを
確認済み。

## 評定待ち

なし。

## 巡回で見つけた候補

2件（上記「後段: 巡回」参照）。夜勤は候補札（`kouho`）に手を出さない方針のとおり、昇格・却下は
オーナー判断に委ねる。
