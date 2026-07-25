/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite validar builds em paralelo com `next dev` sem disputar a pasta
  // `.next` (ex.: NEXT_DIST_DIR=.next-build npm run build).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['playwright', '@prisma/client', 'prisma'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'playwright'];
    }
    return config;
  },
};

module.exports = nextConfig;
