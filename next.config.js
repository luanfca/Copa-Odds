/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['playwright', '@prisma/client', 'prisma'],
    instrumentationHook: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'playwright'];
    }
    return config;
  },
};

module.exports = nextConfig;
