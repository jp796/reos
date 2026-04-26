import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:  rgb("--brand-50"),
          100: rgb("--brand-100"),
          200: rgb("--brand-200"),
          500: rgb("--brand-500"),
          600: rgb("--brand-600"),
          700: rgb("--brand-700"),
        },
        accent: {
          50: rgb("--accent-50"),
          100: rgb("--accent-100"),
          200: rgb("--accent-200"),
          400: rgb("--accent-400"),
          500: rgb("--accent-500"),
          600: rgb("--accent-600"),
          700: rgb("--accent-700"),
        },
        bg: rgb("--bg"),
        surface: rgb("--surface"),
        "surface-2": rgb("--surface-2"),
        border: rgb("--border"),
        "border-strong": rgb("--border-strong"),
        text: rgb("--text"),
        "text-muted": rgb("--text-muted"),
        "text-subtle": rgb("--text-subtle"),
        success: rgb("--success"),
        warn: rgb("--warn"),
        danger: rgb("--danger"),
        info: rgb("--info"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["3rem", { lineHeight: "1", letterSpacing: "-0.03em" }],
        "display-lg": ["2.25rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-md": ["1.75rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        h1: ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        h2: ["1.125rem", { lineHeight: "1.35", letterSpacing: "-0.01em" }],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
