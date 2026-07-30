/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/shop", destination: "/merchants", permanent: true },
      { source: "/shop/:slug", destination: "/merchants/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
