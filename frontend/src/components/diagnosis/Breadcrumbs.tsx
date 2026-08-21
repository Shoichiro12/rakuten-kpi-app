interface Crumb {
  label: string
  onClick?: () => void
}

/** ドリルダウンの掘った軌跡（計画書 docs/jisso_keikaku_dashboard_drilldown_2026-08-22.md v5モックのシグネチャ）。
 * 「全体 › アクセス › スポーツ（大） › 商品名」のように現在地までの階層を常時表示する。
 * クリック可能な要素は親要素へ戻る導線として機能する。 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length <= 1) return null
  return (
    <nav aria-label="ドリルダウンの階層" className="flex items-center gap-1.5 text-xs text-muted flex-wrap mb-3">
      {items.map((c, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-line">›</span>}
            {c.onClick && !isLast ? (
              <button
                type="button"
                onClick={c.onClick}
                className="hover:text-ink hover:underline"
              >
                {c.label}
              </button>
            ) : (
              <span className={isLast ? 'font-semibold text-ink' : ''}>{c.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
