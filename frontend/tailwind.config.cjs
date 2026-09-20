/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        navy: { DEFAULT: '#0a1428', light: '#111f3d', dark: '#050b17', surface: '#0f1c36' },
        gold: { DEFAULT: '#d4af37', light: '#f0d878', dim: '#a68a2e' },
        risk: {
          critical: '#f43f5e',
          high: '#f59e0b',
          medium: '#38bdf8',
          low: '#34d399',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -8px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px rgba(212,175,55,0.15), 0 8px 30px -8px rgba(212,175,55,0.25)',
      },
      backgroundImage: {
        'radial-fade': 'radial-gradient(circle at 20% 0%, rgba(212,175,55,0.08), transparent 40%)',
      },
    },
  },
  plugins: [],
};
