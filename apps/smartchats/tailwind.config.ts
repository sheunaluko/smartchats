import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './core/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sc: {
          bg: 'var(--sc-background)',
          background: 'var(--sc-background)',
          surface: 'var(--sc-surface)',
          'surface-alt': 'var(--sc-surface-alt)',
          'surface-secondary': 'var(--sc-surface-secondary)',
          'surface-tertiary': 'var(--sc-surface-tertiary)',
          separator: 'var(--sc-separator)',
          text: 'var(--sc-text)',
          'text-muted': 'var(--sc-text-muted)',
          primary: 'var(--sc-primary)',
          accent: 'var(--sc-accent)',
          border: 'var(--sc-border)',
          danger: 'var(--sc-danger)',
          success: 'var(--sc-success)',
          warning: 'var(--sc-warning)',
        },
      },
      fontFamily: {
        sans: 'var(--sc-font-sans)',
        mono: 'var(--sc-font-mono)',
      },
      fontSize: {
        'sc-xs': 'var(--sc-text-xs)',
        'sc-sm': 'var(--sc-text-sm)',
        'sc-base': 'var(--sc-text-base)',
        'sc-lg': 'var(--sc-text-lg)',
        'sc-xl': 'var(--sc-text-xl)',
        'sc-2xl': 'var(--sc-text-2xl)',
      },
      borderRadius: {
        sc: 'var(--sc-radius-md)',
        'sc-sm': 'var(--sc-radius-sm)',
        'sc-lg': 'var(--sc-radius-lg)',
      },
      boxShadow: {
        'sc-sm': 'var(--sc-shadow-sm)',
        'sc-md': 'var(--sc-shadow-md)',
        'sc-lg': 'var(--sc-shadow-lg)',
        'sc-xl': 'var(--sc-shadow-xl)',
      },
      spacing: {
        sc: 'var(--sc-space-unit)',
        'sc-0.5': 'var(--sc-space-0\\.5)',
        'sc-1': 'var(--sc-space-1)',
        'sc-1.5': 'var(--sc-space-1\\.5)',
        'sc-2': 'var(--sc-space-2)',
        'sc-3': 'var(--sc-space-3)',
        'sc-4': 'var(--sc-space-4)',
        'sc-6': 'var(--sc-space-6)',
        'sc-8': 'var(--sc-space-8)',
      },
      transitionDuration: {
        'sc-fast': 'var(--sc-motion-fast)',
        'sc-base': 'var(--sc-motion-base)',
      },
      transitionTimingFunction: {
        sc: 'var(--sc-motion-easing)',
      },
    },
  },
  plugins: [],
};

export default config;
