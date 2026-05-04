/**
 * Generate PNG icons for the PWA manifest + Apple touch icon from
 * public/icon.svg. Idempotent — re-run any time the SVG changes.
 *
 *   node scripts/generate-pwa-icons.mjs
 */

import sharp from "sharp";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "public", "icon.svg");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(src);

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-256.png", size: 256 },
  { name: "icon-384.png", size: 384 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of sizes) {
  const out = join(outDir, name);
  await sharp(svg).resize(size, size).png().toFile(out);
  // eslint-disable-next-line no-console
  console.log("✓", name);
}

// Maskable icon — same source but with extra padding so the OS
// icon-mask doesn't crop the logo. We scale the SVG content to 80%
// of the canvas before raster.
const maskableSvg = readFileSync(src, "utf8").replace(
  '<rect x="0" y="0" width="512" height="512" rx="96"',
  '<rect x="0" y="0" width="512" height="512" rx="0"',
);
writeFileSync(join(outDir, "icon-maskable.svg"), maskableSvg);
await sharp(Buffer.from(maskableSvg))
  .resize(512, 512)
  .png()
  .toFile(join(outDir, "icon-maskable-512.png"));
console.log("✓ icon-maskable-512.png");
