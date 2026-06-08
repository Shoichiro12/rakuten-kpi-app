/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        rakuten: {
          red: '#bf0000',
          gold: '#c8a000',
        },
      },
    },
  },
  plugins: [],
}
