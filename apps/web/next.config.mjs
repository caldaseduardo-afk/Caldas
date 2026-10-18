/** @type {import('next').NextConfig} */
const config = {
  async headers() {
    const production = process.env.NODE_ENV === 'production';
    const scriptPolicy = production
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'`,
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          ...(production
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000',
                },
              ]
            : []),
        ],
      },
    ];
  },
  async rewrites() {
    // Next forwards WebSocket upgrades, Cookie and the original Origin.
    return [
      {
        source: '/realtime',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/realtime`,
      },
    ];
  },
};
export default config;
