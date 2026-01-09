/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@avail-project/nexus-core'],
  webpack: (config) => {
    // Fallback for Node.js modules in client-side bundles
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
