/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0b1830', light: '#132548', dark: '#060d1c' },
        gold: { DEFAULT: '#d4af37', light: '#e8cd6c' },
      },
    },
  },
  plugins: [],
};
