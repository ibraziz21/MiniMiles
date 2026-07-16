/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // Consolidated site structure — old routes point to their new homes.
      // /partners is parked at src/app/_partners for a future revisit
      // (possibly unified with the merchant system).
      { source: "/partners", destination: "/merchants", permanent: false },
      { source: "/rewards", destination: "/", permanent: false },
      {
        source: "/hub",
        destination: process.env.NEXT_PUBLIC_PASS_URL ?? "https://pass.akibamiles.com",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
