/**
 * Dynamic Open Graph image at /opengraph-image — Next.js convention.
 * Renders a 1200×630 PNG via @vercel/og's ImageResponse (zero extra
 * dependency, built into Next 14+). Used when REOS links are shared
 * on Slack, X, LinkedIn, FB Messenger, Telegram, iMessage, etc.
 *
 * Re-rendered on demand, cached at the edge — no static asset to
 * regenerate manually.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "REOS — AI transaction coordinator software for real-estate TCs and agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px 80px",
          backgroundColor: "#050E3D", // Real Broker Cobalt
          color: "#FFFFFF",
          fontFamily: "system-ui, -apple-system, Inter, sans-serif",
        }}
      >
        {/* Header — small REOS wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "-0.5px",
          }}
        >
          <span style={{ color: "#FFFFFF" }}>RE</span>
          <span style={{ color: "#00FBF0" }}>OS</span>
          <span
            style={{
              marginLeft: "16px",
              fontSize: "14px",
              fontWeight: 400,
              color: "#A7B0C0",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Real Estate OS
          </span>
        </div>

        {/* Body — keyword-bearing headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              fontSize: "76px",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-1.5px",
              maxWidth: "1000px",
            }}
          >
            AI transaction coordinator software for TCs and agents.
          </div>
          <div
            style={{
              fontSize: "30px",
              fontWeight: 500,
              color: "#BFDDDB",
              maxWidth: "1000px",
              lineHeight: 1.3,
            }}
          >
            Read contracts in 60 seconds. Auto-draft email replies. Per-customer
            compliance audit. Auto-post to LinkedIn.
          </div>
        </div>

        {/* Footer — domain + CTA */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "22px",
          }}
        >
          <span style={{ color: "#BFDDDB" }}>myrealestateos.com</span>
          <span
            style={{
              backgroundColor: "#FF557E",
              color: "#FFFFFF",
              padding: "12px 24px",
              borderRadius: "8px",
              fontWeight: 700,
            }}
          >
            Start free trial →
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
