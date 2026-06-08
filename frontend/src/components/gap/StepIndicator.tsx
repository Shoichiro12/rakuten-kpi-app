import { CheckCircle } from 'lucide-react'

const STEPS = [
  {
    num: 1,
    title: 'ショップ全体',
    desc: 'KGI・KPIを確認',
  },
  {
    num: 2,
    title: 'ジャンル別に絞る',
    desc: '差分の大きいジャンルを特定',
  },
  {
    num: 3,
    title: '商品別に絞る',
    desc: '課題商品を特定する',
  },
]

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3
  onStepClick: (step: 1 | 2 | 3) => void
}

export default function StepIndicator({ currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div className="bg-white rounded-xl border shadow-sm px-6 py-4">
      <div className="flex items-center">
        {STEPS.map((step, i) => {
          const done = step.num < currentStep
          const active = step.num === currentStep
          const clickable = step.num <= currentStep

          return (
            <div key={step.num} className="flex items-center flex-1 min-w-0">
              {/* ステップ */}
              <button
                onClick={() => clickable && onStepClick(step.num as 1 | 2 | 3)}
                disabled={!clickable}
                className={`flex items-center gap-3 min-w-0 text-left transition-opacity ${
                  clickable ? 'cursor-pointer' : 'cursor-default opacity-40'
                }`}
              >
                {/* アイコン */}
                <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                  done
                    ? 'bg-green-500 text-white'
                    : active
                    ? 'bg-gray-900 text-white ring-4 ring-gray-200'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {done ? <CheckCircle size={18} /> : step.num}
                </div>

                {/* テキスト */}
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${
                    active ? 'text-gray-900' : done ? 'text-green-700' : 'text-gray-400'
                  }`}>
                    STEP {step.num}：{step.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${active ? 'text-gray-500' : 'text-gray-300'}`}>
                    {step.desc}
                  </p>
                </div>
              </button>

              {/* コネクター */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-3 h-px bg-gray-200 relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-green-400 transition-all duration-500"
                    style={{ width: done ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
