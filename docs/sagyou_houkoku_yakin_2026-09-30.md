# 夜勤作業報告（2026-09-30）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` に `stamp:"wait"`（急務）は0件だった
（`stamp:"kouho"` 36件・`stamp:"later"` 1件のみ）。対象なしのため、この段は
何も行わなかった。

**STATUS（領国・評定・守り・軍費）の実態照合**: 3点とも確認し、いずれも実態と一致していたため
更新なし。
- 評定「議案なし」: `mcp__github__list_pull_requests`（state=open）で実測、オープンPR 0件を確認
- 守り「9/28検分 高0」: `security/security_check_2026-09-28.md` の結論サマリ「重大度『高』の
  新規指摘は無し」と一致
- 軍費「月 約$33」: `.claude/agents/infra-ops.md` のコスト表（Render $7 + Supabase $25 +
  Cloudflare 約$1 + LP/メール $0 = $33）と一致

## 後段: 巡回（発見専用フェーズ）

既存の軍令（QUESTS 36件）・候補一覧（40件）・却下済み（1件）・CLAUDE.md申し送り台帳と照合し、
新規1件を発見した（3件枠のうち1件。他は既存候補との重複、または実害の裏付けが薄く見送り）。

### 新規候補（1件）

**`.claude/agents/designer.md:20-23`（LPの規則の節）が、2回上書きされた古いLP見出し書体決定を
出典として挙げている**

- 何が: designer.mdは「見出しは角ゴシック主役（2026-08-20決定）」とだけ書いているが、この
  2026-08-20決定は①2026-08-23（BIZ UDPGothic統一）②2026-08-31（デザイン案2a、Figtree+Noto
  Sans JPへ変更・8/23決定を上書き）の2回、既にCLAUDE.md本文で上書きされている。
- 裏取り: `lp/index.html:102,106-107,114-116`を実際に確認し、Google Fontsの読み込み・CSS変数
  とも現在はFigtree／Noto Sans JP／Zen Maru Gothicのみで、BIZ UDPGothicは使われていないことを
  確認済み。
- なぜ問題か: designer.mdの規則はLPデザイン判断の一次情報。抽象的な「角ゴシック主役」という
  表現だけで具体的な書体名が書かれておらず、8/23時点の中間状態とも8/31時点の最新実装とも
  見分けがつかない。
- 放置するとどうなるか: 次にLPの書体に関わる相談でdesignerエージェントが呼ばれたとき、古い
  決定を正として案内する、または誤った中間状態の書体を候補に挙げる可能性がある。

`docs/office_map.html` QUESTS（`stamp:"kouho"`）と `docs/gunrei_kouho.md` 候補一覧の両方に
追記済み。修正・昇格・却下はオーナー判断待ち。

### 見送った検討事項（重複・裏付け不足のため候補に挙げなかったもの）

- `.claude/agents/kpi-analyst.md:14`の`MIN_ACCESS_SAMPLE=100`という表記が月次430・年次5220の
  存在を書いていない点 → 既存候補（2026-09-24発見、同じ行のsite_uu/rpp_click出典取り違え）と
  同じ行・近接する論点のため、別候補として切り出さず見送った
- `.claude/agents/legal-finance.md:27`「JuneOne の残骸がないか」が2026-08-06決定（JuneOne表記は
  変更しない）に触れていない点 → `grep`で実際に`backend/`・`frontend/src/`・`lp/`のいずれにも
  「JuneOne」の残存が無いことを確認済みで、現時点で実害・誤検知リスクの具体例が無いため見送った
- `.claude/agents/security.md`フロントマター「security_index.md の更新」という表記 →
  既存候補（2026-09-21、SKILL.md側の同種の命名問題）と近接するため見送った

## 次にやること

- 上記1件の候補の昇格・却下はオーナー判断待ち
- 急務（`stamp:"wait"`）は引き続き0件。次回夜勤も巡回中心になる見込み
