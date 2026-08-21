/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['BIZ UDPGothic', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', 'sans-serif'],
        num: ['Inter', 'BIZ UDPGothic', 'sans-serif'],
        display: ['Poppins', 'Noto Sans JP', 'sans-serif'],
        mono: ['Inconsolata', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['12px', '1.6'],
        sm: ['14px', '1.6'],
        base: ['16px', '1.6'],
        lg: ['20px', '1.4'],
        xl: ['24px', '1.3'],
        hero: ['32px', '1.2'],
      },
      colors: {
        primary: { DEFAULT: '#3B82F6', ink: '#1D4ED8' },
        secondary: { DEFAULT: '#8B5CF6', ink: '#6D28D9' },
        success: { DEFAULT: '#16A34A', ink: '#15803D' },
        warning: { DEFAULT: '#D97706', ink: '#92400E' },
        danger: { DEFAULT: '#DC2626', ink: '#B91C1C' },
        surface: '#FFFFFF',
        rakuten: {
          red: '#bf0000',
          gold: '#c8a000',
        },
        // ドリルダウン再設計（2026-08-22）のデザイントークン。CLAUDE.md「デザイントークン」表が正。
        paper: '#fdfcf9',
        'bg-alt': '#f4f1ea',
        line: '#e5dfd4',
        ink: '#383731',
        'ink-strong': '#2e2d29',
        sub: '#504b42',
        muted: '#6b6559',
        sage: {
          DEFAULT: '#78927b',
          soft: '#eef2ec',
          deep: '#4c6850',
        },
        alert: {
          DEFAULT: '#c2382f',
          bg: '#fbe9e7',
        },
        up: {
          DEFAULT: '#17714d',
          bg: '#e3f0e8',
        },
      },
    },
  },
  plugins: [],
}
