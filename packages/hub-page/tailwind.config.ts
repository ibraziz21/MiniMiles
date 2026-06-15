import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        akiba: {
          teal: "#238D9D",
          ink: "#0D0E0C",
          muted: "#504C4C",
          paper: "#FCFCFC",
          card: "#F7F7F7",
          line: "#E2E2E2",
          tint: "#EAF7F9",
        },
      },
      fontFamily: {
        sterling: ["var(--font-sterling)", "Georgia", "serif"],
        sans: ["DM Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 24px 80px rgba(13, 14, 12, 0.08)",
        chip: "0 4px 24px rgba(13, 14, 12, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
