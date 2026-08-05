/** すべての button / a / select / summary に付ける。outline は必ず focus-visible のリングで置き換える */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary'

/** 暗い面（Sidebarなど）ではリングを白に */
export const FOCUS_RING_ON_DARK =
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70'

/** 44px+ のタッチターゲット */
export const TAP_TARGET = 'min-h-11 touch-manipulation'
