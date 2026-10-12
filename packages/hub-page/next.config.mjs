/** @type {import('next').NextConfig} */
const nextConfig = {
  // Overridable so a verification build (CI, or a release check on a machine
  // with `next dev` running) can write somewhere other than `.next` instead
  // of clobbering the dev server's output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@akiba/skill-games"],
  async redirects() {
    return [
      { source: "/shop", destination: "/merchants", permanent: true },
      { source: "/shop/:slug", destination: "/merchants/:slug", permanent: true },
      // akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §4.2 —
      // Rewards now means the merchant voucher inventory; the old
      // cross-chain-campaign /rewards experience is retired in favor of it.
      { source: "/rewards", destination: "/vouchers", permanent: true },
    ];
  },
};

export default nextConfig;
