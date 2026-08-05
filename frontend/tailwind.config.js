/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'Noto Sans JP', 'sans-serif'],
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
        ink: '#111827',
        rakuten: {
          red: '#bf0000',
          gold: '#c8a000',
        },
      },
    },
  },
  plugins: [],
}
