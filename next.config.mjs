/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Exclude native / CJS-only modules from the server bundler so Node
  // loads them normally at runtime instead of webpack re-wrapping them.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
