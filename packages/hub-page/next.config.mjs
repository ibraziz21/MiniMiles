/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@akiba/skill-games"],
  async redirects() {
    return [
      { source: "/shop", destination: "/merchants", permanent: true },
      { source: "/shop/:slug", destination: "/merchants/:slug", permanent: true },
      // walletless-pass-skill-games-spec.md §6.1 — Games replaces Rewards.
      { source: "/rewards", destination: "/games", permanent: true },
    ];
  },
};

export default nextConfig;
