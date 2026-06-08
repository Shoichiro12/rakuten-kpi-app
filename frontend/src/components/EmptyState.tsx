import { useNavigate } from 'react-router-dom'
import { Database, ArrowRight, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'

interface EmptyStateProps {
  onDataGenerated?: () => void
}

export default function EmptyState({ onDataGenerated }: EmptyStateProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const generate = async () => {
    setLoading(true)
    try {
      await api.sampleData()
      setDone(true)
      setTimeout(() => onDataGenerated?.(), 800)
    } catch (e) {
      console.error('[EmptyState] サンプルデータ生成エラー:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-16 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Database size={28} className="text-gray-400" />
      </div>

      <h3 className="text-lg font-bold text-gray-800 mb-1">データがありません</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-xs">
        データをインポートするか、サンプルデータを生成してダッシュボードを確認しましょう。
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={generate}
          disabled={loading || done}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Sparkles size={15} />
          {done ? '生成しました！' : loading ? '生成中...' : 'サンプルデータを生成'}
        </button>

        <button
          onClick={() => navigate('/import')}
          className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-xl transition-colors"
        >
          CSVをインポート
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )
}
