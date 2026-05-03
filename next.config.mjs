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
  // pdfjs-dist must be external too — pdf-parse bundles it but uses
  // a runtime dynamic import for pdf.worker.mjs that webpack can't
  // statically resolve.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Force the standalone build to copy pdfjs-dist's worker bundle
  // into the deployed image. Without this Next's file-tracing misses
  // the runtime dynamic import that pdfjs uses for its "fake worker"
  // fallback in Node, and uploads fail with:
  //   "Setting up fake worker failed: Cannot find module
  //    '/app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'"
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/pdfjs-dist/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    ],
  },
  poweredByHeader: false,

  // Security headers applied to every response. Audit passes:
  //   - HSTS (force HTTPS for 2 years, subdomains)
  //   - X-Frame-Options DENY (no clickjacking)
  //   - X-Content-Type-Options nosniff (no MIME-sniff attacks)
  //   - Referrer-Policy strict-origin-when-cross-origin
  //   - Permissions-Policy locks unused browser features
  //   - Cross-Origin-Opener-Policy isolates the tab
  //
  // CSP intentionally omitted — Next 15 inlines hash-less scripts in
  // dev/prod that a strict CSP would block. Add when we audit every
  // inline script (or move to a nonce-based CSP via middleware).
  async headers() {
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value:
          "camera=(), microphone=(self), geolocation=(), payment=(self), usb=(), interest-cohort=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "X-DNS-Prefetch-Control", value: "on" },
    ];
    return [
      // Apply to everything except Next's static / image pipeline so we
      // don't break inline scripts or pre-rendered chunk caching.
      {
        source: "/((?!_next/static|_next/image|favicon).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
