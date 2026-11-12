/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        arabic: ['"Noto Naskh Arabic"', '"Amiri"', 'serif'],
        sans: ['"Cairo"', 'system-ui', 'sans-serif'],
      },
      colors: {
        quran: {
          green: '#E8F5E9',
          greenDark: '#2E7D32',
          greenBorder: '#A5D6A7',
          red: '#FFEBEE',
          redDark: '#C62828',
          redBorder: '#EF9A9A',
          yellow: '#FFFDE7',
          yellowDark: '#F9A825',
          yellowBorder: '#FFF59D',
        },
        primary: {
          50: '#E3F2FD',
          100: '#BBDEFB',
          200: '#90CAF9',
          300: '#64B5F6',
          400: '#42A5F5',
          500: '#1E88E5',
          600: '#1976D2',
          700: '#1565C0',
          800: '#0D47A1',
          900: '#0A3D7C',
        },
        // 2026-11-12: was a blue-grey scale that clashed with the emerald
        // and gold brand. Now a green-grey that matches it. 400 and lighter
        // fail AA as text on white, so body text should use 500 or darker.
        accent: {
          50: '#F2F7F4',
          100: '#DCE8E1',
          200: '#B9CFC3',
          300: '#91B0A0',
          400: '#5E7F70',
          500: '#4A6D5F',
          600: '#3B5B4E',
          700: '#2D463C',
          800: '#213631',
          900: '#13221E',
        },
        ink: {
          DEFAULT: '#1c2b26',
          2: '#43534C',
          3: '#5f6e66',
        },
        'amber-link': '#85551B',
        'emerald-deep': '#053B27',
        cream: {
          DEFAULT: '#FFFCF3',
          deep: '#EFE3C6',
        },
        gold: '#86651A',
        'hairline-emerald': 'rgba(6, 95, 70, 0.18)',
        'hairline-amber': 'rgba(180, 83, 9, 0.2)',
        'hairline-input': '#8d877b',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'bounce-slow': 'bounceSlow 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        bounceSlow: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};
