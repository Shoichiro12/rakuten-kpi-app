# 夜勤 作業報告（2026-09-01）

## 前段: 普請（急務対応）

`docs/office_map.html` QUESTS の先頭の急務（`stamp:"wait"`）は
「lp/README.mdの陳腐化のこと」（2026-08-25巡回発見・2026-08-26急務昇格）だった。

**対応内容**: `lp/README.md` の2箇所を実態に合わせて修正した。

1. **ファイル構成節**: 「shot-hero.jpg / shot-1〜5-*.jpg（工程画像。掲載は主役工程の2.0・4.0のみ、
   1/3/5はファイルのみ保持）」という2026-08-20時点の記述が、2026-08-24のLPエッセイ型全面刷新
   （「5つの工程」セクション自体の廃止）を反映できていなかった。`index.html` を実際にgrepし、
   画像参照が `shot-hero.jpg`（og:image）のみであることを確認したうえで、shot-1〜5は全て未使用
   （ファイルは削除せず残置）と明記する形に修正した。
2. **デプロイ節**: 「Vercelの旧プロジェクトはStripe審査完了までは残す」という未来形の記述が、
   CLAUDE.md記載のとおり2026-08-24に旧Vercelプロジェクト（`ureshiru`/`ureshiru-lp`）が
   既に削除済みという事実と食い違っていた。過去形に修正。

コード変更なし（`lp/`はビルド工程の無い静的HTMLのため、ドキュメント修正のみで完結）。

`docs/office_map.html` QUESTSから当該項目を除去し、`docs/gunrei_kouho.md` の候補一覧の
該当行を「実装済み」に更新、CLAUDE.md「📌 申し送り」台帳にも1行追記した。

## 評定待ち

なし。今回の対応はドキュメント修正のみで、オーナー判断が必要な分岐は発生しなかった。

## 巡回で見つけた候補（2件）

`docs/gunrei_kouho.md` の候補一覧・却下済み、`docs/office_map.html` QUESTSの既存急務・後日、
CLAUDE.md申し送り台帳と重複しないことを確認したうえで、以下2件を新規候補として積んだ
（`docs/office_map.html` QUESTSに`stamp:"kouho"`で追加、`docs/gunrei_kouho.md`に詳細記載）。

1. **`docs/mail_ureshiru_addresses_2026-07-30.md`への幽霊参照**: `docs/jisso_keikaku_comp_invite_2026-08-31.md:185`
   がこのファイルを参照しているが、`git log --all --diff-filter=A --name-only` で全ブランチ・
   全履歴を検索しても一度も存在しない。CLAUDE.mdルール6が警告する「参照はあるが実体が無い」型。
2. **マルウェアスキャン機能（`backend/malware.py`）の記録漏れとカバレッジ漏れ**:
   (a) 2026-08-22導入のこの機能（Cloudmersive API、CSV/ZIPアップロードのスキャン。
   Stripe審査の「マルウェア対策」エビデンス）がCLAUDE.md・`docs/`のどこにも一切記載されていない。
   (b) 実カバレッジも漏れている——`import_csv.py`の4箇所は`scan_bytes()`を呼ぶが、同日に
   追加された`masters.py`（カテゴリ・商品マスタCSV取込）・`targets.py`（目標マスタCSV取込）・
   `item_targets.py`（アイテム別目標CSV取込）の計4エンドポイントは一度も呼んでいない。

いずれも発見のみで修正はしていない。昇格・却下はオーナー判断。

## 次にやること

- QUESTSの次の急務（`stamp:"wait"`）は「課金設定の診断パネルが一般ユーザーにも見えること」
  （優先度中・規模小）。次回夜勤の普請候補。
- 上記2件の候補（幽霊参照・マルウェアスキャン記録漏れ）は、オーナー確認のうえ昇格するか
  却下するかの判断待ち。
