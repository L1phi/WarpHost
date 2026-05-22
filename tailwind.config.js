/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      },
      boxShadow: {
        'cyan-glow': '0 0 34px rgba(34, 211, 238, 0.32)',
        'green-glow': '0 0 26px rgba(74, 222, 128, 0.22)'
      }
    }
  },
  plugins: []
}
