/**
 * Edge-runtime middleware — gate every route behind a NextAuth session
 * cookie, except the explicit allowlist below.
 *
 * We don't import the full `auth()` helper here because it pulls in the
 * Prisma adapter, which is Node-only. Instead we do a fast cookie-
 * presence check in the Edge runtime, and let page/route-level `auth()`
 * calls do the actual user validation + whitelist enforcement.
 *
 * Public routes (exempt from the check):
 *   - /login              (sign-in page)
 *   - /api/auth/*         (NextAuth endpoints)
 *   - /share/*            (public read-only timeline links)
 *   - /api/integrations/** /webhook routes (called by Google/FUB)
 *   - Next.js internals (_next, favicon, static assets)
 */
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/share",
  "/terms",
  "/privacy", // public privacy policy — required by Meta / LinkedIn OAuth reviews
  "/data-deletion", // data-deletion instructions — Meta app-review requirement
  "/data-deletion-status", // status page returned by the Meta data-deletion callback
  "/api/data-deletion", // Meta data-deletion callback (POST signed_request)
  "/intake", // public lead-capture form + POST
  "/api/intake",
  "/demo", // public clickable sandbox — no DB writes, mock data only
  "/signup", // public self-serve signup form
  "/api/signup", // signup-start endpoint that creates the Stripe Checkout Session
  "/vs", // programmatic competitor-comparison SEO pages (/vs/dotloop, etc.)
  "/api/analytics/vsl", // public VSL watch-progress beacon (homepage video)
];

// Webhook + automation-tick endpoints — third parties (Google Pub/Sub,
// FUB) and Cloud Scheduler call these and can't send a session cookie.
// Keep a narrow pattern so we don't accidentally expose generic API
// routes. Each endpoint enforces its own shared-secret / signature
// check inside the route handler.
const WEBHOOK_PATTERNS: RegExp[] = [
  /^\/api\/integrations\/[^/]+\/webhook(\/|$)/,
  /^\/api\/integrations\/gmail\/push(\/|$)/,
  /^\/api\/automation\/[^/]+\/tick(\/|$)/,
  /^\/api\/automation\/morning-tick(\/|$)/,
  /^\/api\/admin\/seed-brokerage-profiles(\/|$)/,
  /^\/api\/stripe\/webhook(\/|$)/,
];

// Routes intentionally callable without a session — e.g. Cloud Run
// health probes. Deliberately exact-match so we don't expose anything
// under /api/health/*.
const PUBLIC_EXACT = new Set<string>(["/api/health", "/"]);

// NextAuth v5 session cookie names (dev vs prod secure variant).
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  // Legacy NextAuth v4 name, just in case older cookies exist
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  if (WEBHOOK_PATTERNS.some((re) => re.test(pathname))) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const hasSession = SESSION_COOKIES.some(
    (name) => req.cookies.get(name)?.value,
  );

  if (hasSession) return NextResponse.next();

  // Unauthenticated:
  //   - API routes → JSON 401 (the client handles it, we don't want
  //     a 307 redirect masquerading as an API response)
  //   - everything else → bounce to /login with callbackUrl preserved
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", pathname + (search ?? ""));
  return NextResponse.redirect(loginUrl);
}

// Match everything except Next.js internals + static file extensions.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|woff|woff2|ttf|otf|map)$).*)",
  ],
};
