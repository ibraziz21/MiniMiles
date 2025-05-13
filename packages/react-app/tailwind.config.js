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
			'poppins' :['Poppins', 'sans-serif']
		},
  		colors: {
			primarygreen:"#219653"
  		},
		backgroundImage: {
			"point-card":"url('/svg/balance-card-bg.svg')",
			"action-button":"url('/svg/action-pill-bg.svg')",
			"partner-quest":"url('/svg/partner-quest-bg.svg')",
			"onboarding":"url('/svg/onboarding-bg.svg')",
			"claim":"url('/svg/claim.svg')",
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
