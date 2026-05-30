/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/accumulators',
  trailingSlash: true,
  transpilePackages: ['@deriv/core'],
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
