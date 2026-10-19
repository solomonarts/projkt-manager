/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Report evidence can include up to five files capped at 15 MB each.
    serverActions: { bodySizeLimit: '80mb' },
  },
};

module.exports = nextConfig;
