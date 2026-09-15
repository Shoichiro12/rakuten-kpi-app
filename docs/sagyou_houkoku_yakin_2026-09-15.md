# 夜勤 作業報告（2026-09-15）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` を確認したところ、`stamp:"wait"`（急務）は**0件**だった
（残るのは `stamp:"kouho"` の候補11件と `stamp:"later"` の後日2件のみ）。着手対象が無いため、
前段の実装作業は行わなかった。

STATUS（領国・評定・守り・軍費）の実態照合結果（変更なし）:

- 評定「議案なし」… `list_pull_requests`（open）を確認したところオープンPR0件。実態と一致
- 守り「9/14検分 高0」… 最新の `security/security_check_2026-09-14.md` の日付と一致。実態と一致
- 軍費「月 約$33」… `.claude/agents/infra-ops.md` のコスト内訳（$7+$25+約$1+$0=$33）と一致。変更不要

急務が無かったため、それ以外の普請作業は行っていない。

## 後段: 巡回（発見専用フェーズ）

`docs/gunrei_kouho.md`（候補一覧13件・却下済み1件）と `docs/office_map.html` QUESTSの既存候補、
CLAUDE.md申し送り台帳と照合したうえで、CLAUDE.md「アーキテクチャ」節を中心にコードと突き合わせ、
新規候補を2件発見した（1晩3件までの枠内）。

1. **CLAUDE.md:366のApp.tsxルーティング一覧が古い**。CLAUDE.mdは6ルート
   （`/`・`/gap`・`/products`・`/import`・`/targets`・`/rpp`）のみを記載しているが、実際の
   `frontend/src/App.tsx`（40-53行目）は11ルートある。`/master`（MasterSettings）・
   `/master/categories`（CategoryMaster）・`/billing`（Billing）・`/reports`（Reports）・
   `/account`（AccountSettings）・`/admin`（AdminAccounts）の6ルートが記載から漏れており、
   ちょうど半数が欠落している状態だった
2. **CLAUDE.md:367の法的文書LP参照先が`https://ureshiru.vercel.app`のまま**。実際の
   `frontend/src/lib/links.ts:18`の`LP_BASE_URL`は`https://ureshiru.com`（独自ドメイン）に
   なっている。CLAUDE.md自身の別行（旧Vercelプロジェクト削除、2026-08-24完了）と突き合わせると、
   `ureshiru.vercel.app`というURLは既に削除済みの旧Vercelプロジェクトの可能性が高く、
   この行末尾の「独自ドメインへ移行する場合は〜直せばよい」という将来形の記述も、実際には
   移行が完了済みで参照先の文言だけが取り残されている

いずれも`docs/office_map.html` QUESTSに`stamp:"kouho"`として追記、`docs/gunrei_kouho.md`
候補一覧に詳細行を追加した。既存の急務・候補・却下済み・CLAUDE.md記載事項とは重複しないことを
確認済み。

## 評定待ち

なし。

## 巡回で見つけた候補

2件（上記「後段: 巡回」参照）。夜勤は候補札（`kouho`）に手を出さない方針のとおり、昇格・却下は
オーナー判断に委ねる。特に2件目は、コード側の文言修正に加えてStripe側の「ビジネスウェブサイト」
登録が独自ドメインを指しているかのオーナー確認も必要になる可能性がある。
