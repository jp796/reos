/**
 * TEMPORARY diagnostic — GET /api/automation/chromium/tick
 * Public (matches the /api/automation/<x>/tick allowlist). Confirms the
 * Alpine system Chromium + playwright-core launch in the prod container
 * (the two risky bits of the XFA flattener infra). Delete after verifying.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const path = process.env.CHROMIUM_PATH || "(unset)";
  try {
    const mod = await import("playwright-core").catch(() => import("playwright"));
    const { chromium } = mod as typeof import("playwright-core");
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const version = browser.version();
    await browser.close();
    return Response.json({ ok: true, chromiumPath: path, version });
  } catch (err) {
    return Response.json(
      { ok: false, chromiumPath: path, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
