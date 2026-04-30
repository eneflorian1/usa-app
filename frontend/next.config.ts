import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ['enef.site', '*.enef.site'],
  async rewrites() {
    return [
      {
        source: '/api/nego/:path*',
        destination: 'http://localhost:5000/api/nego/:path*',
      },
      {
        source: '/api/:path*',
        destination: 'http://localhost:5000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
