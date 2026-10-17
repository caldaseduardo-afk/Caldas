/** @type {import('next').NextConfig} */
const config = {
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
