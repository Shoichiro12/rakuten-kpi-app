# 実装計画: サイドバー折りたたみ機能 2026-08-03

指示書「サイドバー折りたたみ機能」への回答案と実装方針。調査は指示書側で完了済みのため、
確認事項2点への回答と、触るファイル・実装の中身だけを簡潔にまとめる。

対象: `frontend/src/components/layout/Sidebar.tsx`（＋必要なら `App.tsx` は変更なしの見込み）
スコープ外: スマホ幅のハンバーガー・オーバーレイ、ドラッグでの幅可変

---

## 1. 確認事項への回答案

### Q1. 折りたたみ時のツールチップ表示方法

**回答案: `title` 属性は使わず、CSSだけの自作ツールチップ（ホバー＋キーボードフォーカス対応）にする。**

`title` を採らない理由:

- 表示までブラウザ既定で1〜2秒の遅延があり、「アイコンが何か分からない」状態が体感で長い
- **キーボードフォーカスでは出ない**。折りたたみ時はラベルが唯一の手掛かりなので、Tab移動中に何も分からなくなる
- 見た目（フォント・位置・タイミング）がOS依存で、アプリの見た目と揃わない

代わりの実装（ライブラリ追加なし・Tailwindのみ）:

```
<NavLink className="group relative ..." aria-label="ダッシュボード">
  <Icon aria-hidden />
  <span aria-hidden className="pointer-events-none absolute left-full ml-2 ...
        opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
    ダッシュボード
  </span>
</NavLink>
```

- **アクセシブルな名前は `aria-label` で担保**し、
  見た目のツールチップは `aria-hidden` の装飾に徹する（読み上げの二重化を防ぐ）
  → web-design-guidelines「Icon-only buttons need `aria-label`」に準拠
- ホバーだけでなく **`group-focus-visible` でも出す**（キーボード操作でも内容が分かる）
  → 同「Use `:focus-visible` over `:focus`」に準拠
- transition は **`opacity` のみ**（`transition-all` は使わない）。`motion-reduce:transition-none` を付ける
  → 同「Animate `transform`/`opacity` only」「Never `transition: all`」「Honor `prefers-reduced-motion`」に準拠
- 展開時はツールチップを出さない（ラベルが見えているため）

補足: `aside` に `overflow-hidden` は付けない（ツールチップがサイドバー外へはみ出すため）。

### Q2. トグルボタンの配置・アイコン

**回答案: サイドバー上部のロゴ行の右端に1つだけ置く。アイコンは lucide の `PanelLeftClose` / `PanelLeftOpen`。**

- 位置: 上部（ロゴ「楽天EC / KPI管理」と同じ行の右端）。折りたたみ時はロゴを隠し、ボタンを中央寄せにする
  - 上部にした理由: 目線の起点が上にあること、下部ブロックは項目数が多くボタンが埋もれること、
    ページを開いた直後にすぐ触れる位置であること
- アイコン: 開閉の対を持つ `PanelLeftClose`（展開中に押す＝閉じる）/ `PanelLeftOpen`（折りたたみ中に押す＝開く）。
  lucide-react は導入済みなので依存追加なし。`ChevronLeft/Right` より「サイドバーの操作」であることが明確
- ボタン自体もアイコンのみなので `aria-label`（「サイドバーを折りたたむ」/「サイドバーを展開する」）と
  `aria-expanded` を付け、`focus-visible:ring` を入れる

---

## 2. 実装方針

### 2-1. 状態と永続化

- `Sidebar.tsx` 内に `const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')`
  （**lazy initializer**。初回描画から確定値なので展開→折りたたみのちらつきが出ない）
- 書き込みは `useEffect` で `localStorage.setItem(KEY, collapsed ? '1' : '0')`
- キーは `ureshiru:sidebar-collapsed`
- localStorage が使えない環境（プライベートモード等）でも落ちないよう read/write とも try/catch
- ※ これはアプリ本体のコードであり、Claude Artifactsの localStorage 制限とは無関係（指示書のとおり）

状態を `App.tsx` に持ち上げるかは、**今回は持ち上げない**。折りたたみ幅を必要とするのは
サイドバー自身だけで、`<main className="flex-1">` は残り幅を自動で埋めるため、
App.tsx は無変更で済む（＝差分を最小にできる）。

### 2-2. 幅と切り替え

- 展開 `w-56`（224px、現状どおり）⇄ 折りたたみ `w-16`（64px）
- **幅のアニメーションは入れない（即時切替）**。`width` のトランジションは毎フレーム
  レイアウト再計算が走り、商品マスタのような重いテーブルを右に抱えた状態では
  カクつきやすい。ガイドラインの「animate transform/opacity only」にも沿う
- 既存の `transition-colors`（ホバー色）はそのまま

### 2-3. 折りたたみ時の見た目

- ナビ項目: アイコンのみ中央寄せ。`justify-center` ＋ アイコンサイズは維持
- **アクティブ状態**: 展開時は現状どおり行全体が `bg-rakuten-red`。
  折りたたみ時は (a) アイコンを囲む角丸ボックスを `bg-rakuten-red`、
  (b) 行の左端に3pxの縦バー、の2点で示す。
  幅64pxだと塗り面積が小さく見落としやすいため、左端バーを併用して「現在地」を確実に伝える
- 下部ブロック（アカウント設定・使い方ガイド・ヘルプページ・不具合要望・ログアウト）も同じ扱いで
  アイコンのみ＋ツールチップ。ヘルプページの外部リンク `ExternalLink` 小アイコンは折りたたみ時は非表示
- メールアドレス表示・`v1.0.0` は折りたたみ時は非表示（64pxに収まらないため）
- ロゴ行は折りたたみ時「楽天EC / KPI管理」を隠し、トグルボタンのみ中央

### 2-4. ついでに直す（低リスク・ガイドライン準拠）

- ナビ項目・下部ボタンに `focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset` を追加。
  折りたたみ時はキーボード操作でどこにいるか分かる必要があるため、今回まとめて入れる
- 既存の `title={maskEmail(userEmail)}`（ログアウトボタン）は、アクセシブルな名前と競合するので整理する

---

## 3. 区切りと検証

1本の区切りで完結（Sidebar.tsx 単体の変更）。

| 手順 | 内容 |
|---|---|
| 1 | Sidebar.tsx 実装 |
| 2 | `cd frontend && npm run build`（tsc 型エラー0） |
| 3 | `web-design-guidelines` スキルで Sidebar.tsx をレビュー |
| 4 | ローカル実画面で確認（折りたたみ⇄展開、リロード後の維持、アクティブ表示、Tab移動でツールチップ、商品マスタの横スクロール余裕） |
| 5 | push → 本番デプロイ確認 → 実画面検証 |

CLAUDE.md の申し送り表には、実装完了時に1行追加する。

---

## 4. 確認事項 → **3点ともオーナー承認済み（2026-08-03）**

1. ツールチップ: `title` ではなく CSS自作（ホバー＋フォーカス、名前は `aria-label` で担保）→ **承認**
2. トグル: 上部ロゴ行の右端・`PanelLeftClose`/`PanelLeftOpen` → **承認**
3. 幅のアニメーションなし（即時切替）→ **承認。「ふわっと動かしたい」要望は無し**
   （後のセッションで再浮上しても入れない。理由は2-2のとおり）

「ついでに直す」の `focus-visible` リング追加も承認済み。

---

## 5. 実装結果（2026-08-03）

`frontend/src/components/layout/Sidebar.tsx` 単体の変更で完了。`App.tsx` は無変更
（`<main className="flex-1">` が残り幅を自動で埋めるため）。

検証:

- `cd frontend && npm run build` … 型エラー0
- `web-design-guidelines`（Web Interface Guidelines）でのレビュー結果を反映
  - icon-only に `aria-label` / 装飾アイコンに `aria-hidden` / `outline-none` は `focus-visible` リングで置換
  - `transition: all` は使わず `transition-colors`・`transition-opacity` のみ、ツールチップは `motion-reduce:transition-none`
  - 追加修正: ラベル span に `min-w-0`（flex子要素のtruncate）、行に `touch-manipulation`（タブレットの二度押し遅延）
- ヘッドレスChromeでの実画面確認 … 展開・折りたたみ・ホバー時ツールチップ・
  Tab移動時のツールチップとフォーカスリング・リロード後の維持（幅64pxで復帰）

**残**: 本番デプロイと本番実画面での検証。
