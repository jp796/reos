/**
 * NextAuth v5 configuration for REOS.
 *
 * - Google provider (reuses the existing GOOGLE_CLIENT_ID / SECRET
 *   from the Gmail integration; Google allows the same client to
 *   request basic profile scopes in addition to the Gmail scopes)
 * - Database strategy via Prisma adapter
 * - Whitelist via AUTH_ALLOWED_EMAILS env var (comma-separated)
 * - New users auto-attach to the single REOS account with a role
 *   matching their email position in the whitelist (first = owner,
 *   rest = coordinator)
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

/**
 * Naming-collision shim for @auth/prisma-adapter.
 *
 * The adapter hardcodes `p.account.*` when it stores OAuth credentials.
 * REOS already has a top-level `Account` model (the tenant — "Real
 * Broker LLC"), so we added a separate `AuthAccount` model to hold
 * OAuth rows. This proxy exposes `authAccount` under the alias
 * `account` ONLY to the adapter, so the rest of the codebase keeps
 * using `prisma.account` for the tenant without collision.
 */
const adapterPrisma = new Proxy(prisma, {
  get(target, prop: string | symbol, receiver) {
    if (prop === "account") {
      return (target as unknown as { authAccount: unknown }).authAccount;
    }
    return Reflect.get(target, prop, receiver);
  },
}) as typeof prisma;

function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fail loudly at boot in production if the auth config is incomplete.
 * In dev we only warn, so local tinkering doesn't require the full
 * OAuth dance to be set up.
 */
function checkAuthConfig() {
  const missing: string[] = [];
  if (!process.env.AUTH_SECRET) missing.push("AUTH_SECRET");
  if (!process.env.AUTH_GOOGLE_ID && !process.env.GOOGLE_CLIENT_ID) {
    missing.push("AUTH_GOOGLE_ID or GOOGLE_CLIENT_ID");
  }
  if (!process.env.AUTH_GOOGLE_SECRET && !process.env.GOOGLE_CLIENT_SECRET) {
    missing.push("AUTH_GOOGLE_SECRET or GOOGLE_CLIENT_SECRET");
  }
  if (allowedEmails().length === 0) missing.push("AUTH_ALLOWED_EMAILS");

  if (missing.length === 0) return;
  const msg =
    "[auth] Missing required env vars: " +
    missing.join(", ") +
    ". See deploy/CLOUD_RUN_RUNBOOK.md §3 for the full list.";
  // Skip validation during `next build` — secrets are injected at
  // runtime (Cloud Run --set-secrets), not at build time. Next.js
  // sets NEXT_PHASE during builds. We still warn so a misconfigured
  // image is loud at runtime.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.warn(msg + " (skipped — build phase)");
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  }
  console.warn(msg);
}

checkAuthConfig();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(adapterPrisma),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret:
        process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    /**
     * Gate: reject any email NOT on the whitelist before a user /
     * auth_account record is created. Returning false prevents sign-in.
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const allow = allowedEmails();
      if (allow.length === 0) return false; // closed by default
      return allow.includes(email);
    },
    async session({ session, user }) {
      // Stamp the session with role + accountId from our User row.
      if (session.user && user?.id) {
        const u = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, accountId: true },
        });
        if (u) {
          (session.user as typeof session.user & {
            role: string;
            accountId: string | null;
          }).role = u.role;
          (session.user as typeof session.user & {
            role: string;
            accountId: string | null;
          }).accountId = u.accountId;
        }
      }
      return session;
    },
  },
  events: {
    /**
     * On first sign-in, link the new User row to the single REOS
     * account (the "owner-account" created during seed). The first
     * email in AUTH_ALLOWED_EMAILS becomes owner, everyone else
     * becomes coordinator.
     */
    async createUser({ user }) {
      const account = await prisma.account.findFirst({ select: { id: true } });
      if (!account) return;

      const email = user.email?.toLowerCase() ?? "";
      const allow = allowedEmails();
      const role = allow.indexOf(email) === 0 ? "owner" : "coordinator";

      // The owner is the party who authored the terms — they don't
      // need to agree to themselves. Coordinators DO need to click
      // through the ToU on first sign-in.
      const termsAcceptedAt = role === "owner" ? new Date() : null;

      await prisma.user.update({
        where: { id: user.id },
        data: { accountId: account.id, role, termsAcceptedAt },
      });
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
