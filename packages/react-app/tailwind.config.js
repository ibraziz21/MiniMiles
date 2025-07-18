/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
		fontFamily: {
			'poppins' :['Poppins', 'sans-serif'],
			DM: ["DM Sans", "sans-serif"],
			sterling: ['var(--font-sterling)']
		},
  		colors: {
				primarygreen: "#238D9D"
  		},
		backgroundImage: {
			"point-card":"url('/svg/balance-card-bg.svg')",
			"action-button":"url('/svg/action-pill-bg.svg')",
			"partner-quest":"url('/svg/partner-quest-bg.svg')",
			"onboarding":"url('/svg/onboarding-bg.svg')",
			"claim":"url('/svg/claim.svg')",
			"app":"url('/svg/app.svg')",
		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
