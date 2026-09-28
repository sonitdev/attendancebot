import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep the local dev server independent from `next build`. A production build
  // must not replace chunks currently served to a developer's browser.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.INTERNAL_API_URL || 'http://localhost:5131'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
