/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#000000',
          hover: '#5A7AEF',
          light: 'rgba(107, 138, 255, 0.1)',
        },
      },
    },
  },
  plugins: [],
}
