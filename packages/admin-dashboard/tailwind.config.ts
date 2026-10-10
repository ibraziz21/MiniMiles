import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens — spec §8.1 (admin-dashboard-pwa-ui-overhaul-spec.md)
        canvas: "#F6F8FA",
        surface: "#FFFFFF",
        "surface-subtle": "#F1F5F4",
        ink: "#0F172A",
        "ink-muted": "#475569",
        border: "#D7E0E3",
        info: "#0369A1",
        warning: "#B45309",
        danger: "#B91C1C",
        success: "#15803D",
        primary: {
          DEFAULT: "#0F766E",
          strong: "#115E59",
          foreground: "#ffffff",
        },
        brand: "#238D9D",
        admin: {
          DEFAULT: "#1e293b",
          accent: "#238D9D",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Shape scale — spec §8.3 (controls/cards/sheets)
        control: "6px",
        card: "10px",
        sheet: "14px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
