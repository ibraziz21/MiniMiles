const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = {
      fs: false,
    };
    return config;
  },
  images: {
    remotePatterns: [
      {
        // Supabase storage — merchant logos and partner images
        protocol: 'https',
        hostname: 'qmhmwkjmwcvlipotvkly.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Cloudinary — product and merchant images uploaded via dashboard
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/dg2ruzsqd/**',
      },
    ],
  },
  devIndicators: false,
  allowedDevOrigins: ['192.168.100.6', '192.168.100.186'],
};

module.exports = nextConfig;
