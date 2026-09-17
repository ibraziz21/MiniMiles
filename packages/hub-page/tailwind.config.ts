import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "../skill-games/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        akiba: {
          teal: "#238D9D",
          // Hover/active shade for akiba-teal surfaces — previously
          // hand-copied as a raw hex (`hover:bg-[#1E7E8D]`) into 14
          // independent files; same value, now one name.
          tealDark: "#1E7E8D",
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
        sans: ["var(--font-dm-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        // Shared @akiba/skill-games components use font-poppins for body copy
        // — loaded via next/font/google in layout.tsx (--font-poppins).
        poppins: ["var(--font-poppins)", "sans-serif"],
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
