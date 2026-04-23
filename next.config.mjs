/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce .next/standalone — a self-contained server bundle. Cloud
  // Run / Docker can copy just that + .next/static + public and run
  // `node server.js`, no `npm install` at runtime.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Exclude native / CJS-only modules from the server bundler so Node
  // loads them normally at runtime instead of webpack re-wrapping them.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
