import { useState } from 'react'
import {
  LayoutDashboard, TrendingUp, Package, Upload, Target,
  ChevronRight, ChevronLeft, CheckCircle, Sparkles, X,
  BarChart3, ArrowRight, Megaphone, Boxes, FileDown, BookOpen,
  ExternalLink,
} from 'lucide-react'
import { api } from '../lib/api'
import { HELP_URL, EXTERNAL_LINK_PROPS } from '../lib/links'

interface OnboardingModalProps {
  onComplete: () => void
}

/** サイドバーの並び順に合わせた画面一覧（「毎日見る」と「設定・取込み」に分類）。 */
const SCREENS_DAILY = [
  { icon: LayoutDashboard, label: 'ダッシュボード', desc: 'KPIサマリ・達成率・⚠️アラート・今日やるべきこと' },
  { icon: TrendingUp, label: 'GAP分析', desc: 'ショップ→ジャンル→商品の3段階で課題を特定' },
  { icon: Package, label: '商品別KPI', desc: '商品ごとのKPI一覧・LimitCPO超過を警告' },
  { icon: Megaphone, label: 'RPP広告実績', desc: '取込み済み広告データの週次・月次閲覧と診断' },
]

const SCREENS_SETUP = [
  { icon: Upload, label: 'データ取込み', desc: '楽天RMSのCSVをドラッグ&ドロップするだけ' },
  { icon: Boxes, label: '商品マスタ・原価', desc: '原価を入れると利益（Rev・ROI）が計算される' },
  { icon: Target, label: '目標設定', desc: 'KGI売上目標・KPI目標・経費率を月別管理' },
  { icon: FileDown, label: 'レポート出力', desc: '集計KPIをCSVで書き出して共有' },
]

const KPI_CHAIN = [
  { label: '売上（KGI）', color: 'bg-blue-600', sub: '最終目標' },
  { label: 'アクセス（UU）', color: 'bg-indigo-500', sub: 'どれだけ見られたか' },
  { label: '転換率（CVR）', color: 'bg-violet-500', sub: 'どれだけ買ったか' },
  { label: '客単価（Av）', color: 'bg-purple-500', sub: 'いくら買ったか' },
]

export default function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(0)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleDone, setSampleDone] = useState(false)

  const totalSteps = 5

  const generateSample = async () => {
    setSampleLoading(true)
    try {
      await api.sampleData()
      setSampleDone(true)
    } finally {
      setSampleLoading(false)
    }
  }

  const next = () => {
    if (step < totalSteps - 1) setStep(s => s + 1)
    else onComplete()
  }
  const prev = () => setStep(s => s - 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* 閉じるボタン */}
        <button
          onClick={onComplete}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full hover:bg-gray-100 text-gray-400"
        >
          <X size={16} />
        </button>

        {/* プログレスバー */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* ステップドット */}
        <div className="flex justify-center gap-2 pt-5 pb-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === step ? 'bg-blue-500 w-5' : i < step ? 'bg-blue-300' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* コンテンツ */}
        <div className="px-8 py-6 min-h-[360px] flex flex-col">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepKPIChain />}
          {step === 2 && (
            <StepSampleData
              loading={sampleLoading}
              done={sampleDone}
              onGenerate={generateSample}
            />
          )}
          {step === 3 && <StepScreens />}
          {step === 4 && <StepCSV />}
        </div>

        {/* ナビゲーション */}
        <div className="flex items-center justify-between px-8 pb-6">
          <button
            onClick={prev}
            disabled={step === 0}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:invisible"
          >
            <ChevronLeft size={16} /> 前へ
          </button>

          <span className="text-xs text-gray-400">{step + 1} / {totalSteps}</span>

          <button
            onClick={next}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {step === totalSteps - 1 ? (
              <><CheckCircle size={15} /> 始める</>
            ) : (
              <>次へ <ChevronRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center flex-1 justify-center gap-5">
      <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
        <BarChart3 size={32} className="text-white" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900">楽天EC KPI管理へようこそ</h2>
        <p className="mt-2 text-gray-500 text-sm leading-relaxed">
          楽天の売上・広告データを自動集計し、<br />
          KPIの達成状況と改善ポイントを一目で把握できます。
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 w-full text-xs">
        {[
          { icon: '📊', text: 'RPP広告KPIを自動計算' },
          { icon: '⚠️', text: '改善アラートを自動検出' },
          { icon: '📁', text: 'CSVインポートだけで完結' },
        ].map(({ icon, text }) => (
          <div key={text} className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xl mb-1">{icon}</p>
            <p className="text-gray-600 font-medium">{text}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">初回セットアップは約2分で完了します</p>
    </div>
  )
}

function StepKPIChain() {
  return (
    <div className="flex flex-col flex-1 gap-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">KGI・KPIの考え方</h2>
        <p className="mt-1 text-sm text-gray-500">売上目標（KGI）は3つのKPIに分解できます</p>
      </div>

      <div className="bg-blue-50 rounded-2xl p-5">
        <p className="text-center text-sm font-semibold text-blue-800 mb-4">
          売上（KGI）= アクセス × CVR × 客単価
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {KPI_CHAIN.map(({ label, color, sub }, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`${color} text-white rounded-xl px-3 py-2 text-center`}>
                <p className="text-xs font-bold">{label}</p>
                <p className="text-[10px] opacity-80 mt-0.5">{sub}</p>
              </div>
              {i < KPI_CHAIN.length - 1 && (
                <ArrowRight size={14} className="text-gray-400 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 text-sm">
        <p className="font-semibold text-gray-700">分析の順序</p>
        {[
          { step: '1', text: 'ショップ全体のKPIを確認し、どの指標が悪いかを特定' },
          { step: '2', text: 'ジャンル別に絞り込み、問題のあるカテゴリを発見' },
          { step: '3', text: '商品別で具体的な改善対象を特定する' },
        ].map(({ step, text }) => (
          <div key={step} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
              {step}
            </span>
            <p className="text-gray-600">{text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepSampleData({
  loading, done, onGenerate,
}: { loading: boolean; done: boolean; onGenerate: () => void }) {
  return (
    <div className="flex flex-col flex-1 gap-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">まずデータを用意しましょう</h2>
        <p className="mt-1 text-sm text-gray-500">
          実データがなくてもサンプルで全機能を試せます
        </p>
      </div>

      <div className={`rounded-2xl border-2 p-6 text-center transition-colors ${
        done ? 'border-green-300 bg-green-50' : 'border-dashed border-gray-200 bg-gray-50'
      }`}>
        {done ? (
          <div className="space-y-2">
            <CheckCircle size={32} className="mx-auto text-green-500" />
            <p className="font-semibold text-green-700">サンプルデータを生成しました！</p>
            <p className="text-xs text-green-600">10商品 × 8週間のデータが追加されました</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Sparkles size={32} className="mx-auto text-amber-500" />
            <p className="text-sm font-medium text-gray-700">サンプルデータを生成する</p>
            <p className="text-xs text-gray-500">
              スポーツ用品ショップの想定で<br />10商品×8週間分のデータが作成されます
            </p>
            <button
              onClick={onGenerate}
              disabled={loading}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors"
            >
              {loading ? '生成中...' : '生成する（推奨）'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
        <p className="font-semibold mb-1">実データをお持ちの方</p>
        <p className="text-xs text-blue-600">
          「データ取込み」画面から楽天RMSのRPPレポートCSVをインポートできます。
          サンプルデータを先に試してから切り替えることもできます。
        </p>
      </div>
    </div>
  )
}

function StepScreens() {
  return (
    <div className="flex flex-col flex-1 gap-3">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">画面の使い方</h2>
        <p className="mt-1 text-sm text-gray-500">左のサイドバーから各画面に移動できます</p>
      </div>

      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">毎日見る画面</p>
        <div className="space-y-0.5">
          {SCREENS_DAILY.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
                <Icon size={13} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900">{label}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">設定・取込み</p>
        <div className="space-y-0.5">
          {SCREENS_SETUP.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="w-7 h-7 rounded-lg bg-gray-600 flex items-center justify-center shrink-0">
                <Icon size={13} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900">{label}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StepCSV() {
  return (
    <div className="flex flex-col flex-1 gap-4">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">実データ運用の流れ</h2>
        <p className="mt-1 text-sm text-gray-500">この4ステップで利益まで見える状態になります</p>
      </div>

      <div className="space-y-3">
        {[
          { step: '①', title: '楽天RMSからCSVを2種類書き出す', desc: 'RPP広告レポート（週次）と商品分析（月次）。入手手順は取込み画面にも記載' },
          { step: '②', title: '「データ取込み」にドラッグ&ドロップ', desc: 'RMSのCSVはそのままでOK。列名変更・ヘッダー削除は不要' },
          { step: '③', title: '「商品マスタ・原価」で原価を入力', desc: '利益（Rev）・ROI・Limit CPOが計算できるようになる' },
          { step: '④', title: '「目標設定」でKGI・KPI目標を設定', desc: '達成率とGAPがダッシュボードに表示される' },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
            <span className="text-lg font-bold text-blue-600 w-7 shrink-0">{step}</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <a
        href={HELP_URL}
        {...EXTERNAL_LINK_PROPS}
        className="flex items-center gap-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 transition-colors"
      >
        <BookOpen size={16} className="shrink-0" />
        <span className="flex-1">
          <span className="font-semibold">詳しくはヘルプページへ</span>
          <span className="block text-blue-600 mt-0.5">CSV入手方法・KPI用語集・よくある質問をまとめています。サイドバー下部からいつでも開けます。</span>
        </span>
        <ExternalLink size={13} className="shrink-0 text-blue-400" />
      </a>
    </div>
  )
}
