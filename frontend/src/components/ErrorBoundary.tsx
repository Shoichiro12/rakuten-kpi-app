import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * 描画中の例外を捕捉して、画面全体が白くなるのを防ぐ。
 *
 * Reactは描画中に例外が投げられるとツリー全体をアンマウントするため、
 * 1コンポーネントの不具合でアプリ全体が真っ白になる（実際に、ショップ全体の
 * 実績が無い月にSTEP3が shopData.current.ctr を参照して発生した）。
 *
 * docs/VISION.md の原則「データが無いときこそ意思決定を止めない」に照らすと、
 * 全画面ホワイトアウトは最悪の挙動。ここで受け止めて、他の情報は見える状態を保つ。
 */

interface Props {
  children: ReactNode
  /** 表示名（どこで落ちたかを利用者に伝える） */
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="m-4 bg-white border border-amber-300 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={18} className="text-amber-600" />
          <span className="text-sm font-semibold text-gray-900">
            {this.props.label ? `${this.props.label}の表示でエラーが発生しました` : '表示エラーが発生しました'}
          </span>
        </div>
        <p className="text-xs text-gray-600 mb-3">
          この部分だけを安全に停止しました。他の画面はそのまま使えます。
          期間や条件を変えると回復する場合があります。
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={this.reset}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-700 flex items-center gap-1"
          >
            <RefreshCw size={12} />再表示する
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1.5 rounded text-gray-500 hover:text-gray-700"
          >
            ページを再読み込み
          </button>
        </div>
        <details className="mt-3">
          <summary className="text-[11px] text-gray-400 cursor-pointer">技術的な詳細</summary>
          <pre className="mt-1 text-[11px] text-gray-500 whitespace-pre-wrap break-all">
            {error.message}
          </pre>
        </details>
      </div>
    )
  }
}
