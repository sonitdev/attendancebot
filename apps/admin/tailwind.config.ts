import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        botanical: {
          DEFAULT: '#023F26',
          dark: '#012919',
          light: '#035936',
          soft: 'rgba(2, 63, 38, 0.08)',
        },
        lime: {
          DEFAULT: '#c4d701',
          ink: '#023f26',
        },
        shell: '#f2f6f4',
        canvas: '#f7faf9',
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },
      boxShadow: {
        'glass-card': 'inset 0 1.5px 1px rgba(255, 255, 255, 1), 0 8px 24px -4px rgba(15, 23, 42, 0.04)',
        'glass-card-hover': 'inset 0 1.5px 1px rgba(255, 255, 255, 1), 0 16px 36px -6px rgba(2, 63, 38, 0.09)',
        'glass-panel': 'inset 0 1.5px 1px rgba(255, 255, 255, 1), 0 20px 50px -12px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
