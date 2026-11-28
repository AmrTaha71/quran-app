const PURPLE = {
  50: '#F7F2FB', 100: '#EEE3F6', 200: '#DCC6EC', 300: '#C29FDD', 400: '#A06FC9', 500: '#7F44B0',
  600: '#652A93', 700: '#4C0B7A', 800: '#3A065F', 900: '#2A0446', 950: '#1A022C',
};
const GOLD = {
  50: '#FDF9EC', 100: '#FAF0CF', 200: '#F5E09E', 300: '#F0C85A', 400: '#E3B443', 500: '#C9A227',
  600: '#A6821C', 700: '#86651A', 800: '#6B5017', 900: '#4F3B12', 950: '#2E220A',
};

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
        // 2026-11-28 (owner: «ده عك»): ~900 emerald/teal/blue classes still drew Tailwind's green and blue.
        // Jasmine Night in one place: those scales are the app purple, amber is the app gold.
        emerald: PURPLE, teal: PURPLE, cyan: PURPLE, sky: PURPLE, blue: PURPLE,
        amber: GOLD,
        // Item 8.3: the unused 'quran' (pastel) and 'primary' (blue) scales
        // were deleted — zero uses in src/.
        // 2026-11-12: was a blue-grey scale that clashed with the emerald
        // and gold brand. Now a green-grey that matches it. 400 and lighter
        // fail AA as text on white, so body text should use 500 or darker.
        accent: {
          50: '#F5F2F7',
          100: '#E3DCE8',
          200: '#C6B9CF',
          300: '#A391B0',
          400: '#715E7F',
          500: '#5E4A6D',
          600: '#4E3B5B',
          700: '#3C2D46',
          800: '#2D2136',
          900: '#1C1322',
        },
        ink: {
          DEFAULT: '#251C2B',
          2: '#43534C',
          3: '#5f6e66',
        },
        'amber-link': '#85551B',
        'emerald-deep': '#24053B',
        cream: {
          DEFAULT: '#FFFCF3',
          deep: '#F4F1EA',
        },
        gold: '#86651A',
        'hairline-emerald': 'rgba(58, 6, 95, 0.18)',
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
