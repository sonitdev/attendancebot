import type { NextConfig } from 'next';

const miniAppUrl = process.env.NEXT_PUBLIC_TELEGRAM_MINI_APP_URL || process.env.TELEGRAM_MINI_APP_URL;
const miniAppHostname = miniAppUrl ? new URL(miniAppUrl).hostname : undefined;

const nextConfig: NextConfig = {
  ...(miniAppHostname ? { allowedDevOrigins: [miniAppHostname] } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 't.me',
      },
      {
        protocol: 'https',
        hostname: '*.telegram.org',
      },
    ],
  },
  async rewrites() {
    const apiTarget = process.env.INTERNAL_API_URL || 'http://127.0.0.1:5131';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiTarget}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
