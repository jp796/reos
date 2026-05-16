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
      // Required for the self-serve signup flow: the Stripe webhook
      // creates a User row by email BEFORE the user has ever signed
      // in with Google. NextAuth refuses to link an OAuth account
      // to a pre-existing User by email unless this flag is set —
      // safe here because (a) the email was verified by Stripe at
      // payment, (b) we never auto-create a User outside the webhook
      // path, and (c) Google itself verifies the email it returns.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    /**
     * Gate: who's allowed to sign in?
     *
     *   1. Anyone on AUTH_ALLOWED_EMAILS (legacy single-tenant gate
     *      for JP's account + invited TCs)
     *   2. Anyone whose email matches a User row attached to an
     *      Account with an active subscription (self-serve signup
     *      path — Stripe webhook materializes the User after payment;
     *      this signIn callback then lets them through on first OAuth)
     *   3. Anyone with a pending AccountMembership invite (so a TC
     *      invited to a brokerage can accept by signing in)
     *
     * Returning false prevents sign-in. Everything else is rejected.
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      // (1) Static allowlist
      const allow = allowedEmails();
      if (allow.includes(email)) return true;

      // (2) Active paid account
      try {
        const u = await prisma.user.findUnique({
          where: { email },
          select: {
            account: {
              select: { subscriptionStatus: true },
            },
          },
        });
        if (u?.account?.subscriptionStatus === "active") return true;
      } catch (err) {
        console.warn("[auth.signIn] paid-account lookup failed:", err);
      }

      // (3) Pending invite
      try {
        const invite = await prisma.accountMembership.findFirst({
          where: { email, revokedAt: null, acceptedAt: null },
          select: { id: true },
        });
        if (invite) return true;
      } catch (err) {
        console.warn("[auth.signIn] invite lookup failed:", err);
      }

      return false;
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
      const email = user.email?.toLowerCase() ?? "";
      const allow = allowedEmails();

      // Multi-tenant routing. Email-specific overrides take precedence
      // (used when a TC's primary email is on a generic provider like
      // gmail.com); a domain map handles whole-brokerage cases.
      const EMAIL_TO_ACCOUNT: Record<string, string> = {
        "clear2closetm@gmail.com": "417realestate-mo",
      };
      const DOMAIN_TO_ACCOUNT: Record<string, string> = {
        "417realestate.com": "417realestate-mo",
      };
      const domain = email.split("@")[1] ?? "";
      const explicitAccountId =
        EMAIL_TO_ACCOUNT[email] ?? DOMAIN_TO_ACCOUNT[domain];

      let accountId: string;
      let role: string;
      if (explicitAccountId) {
        // Tenant owner = first user signing in for that account.
        const existingOwner = await prisma.user.findFirst({
          where: { accountId: explicitAccountId, role: "owner" },
          select: { id: true },
        });
        accountId = explicitAccountId;
        role = existingOwner ? "coordinator" : "owner";
      } else {
        const fallback = await prisma.account.findFirst({
          select: { id: true },
        });
        if (!fallback) return;
        accountId = fallback.id;
        role = allow.indexOf(email) === 0 ? "owner" : "coordinator";
      }

      // Owner skips ToU (they authored it); coordinators click
      // through on first sign-in.
      const termsAcceptedAt = role === "owner" ? new Date() : null;

      await prisma.user.update({
        where: { id: user.id },
        data: { accountId, role, termsAcceptedAt },
      });

      // For new tenant owners, set them as the account's owner_user_id
      // (the schema column is required; the placeholder gets replaced
      // here on first owner sign-in).
      if (role === "owner" && explicitAccountId) {
        await prisma.account.update({
          where: { id: accountId },
          data: { ownerUserId: user.id },
        });
      }

      // Auto-accept any pending AccountMembership invites that match
      // the new user's email. This is what powers cross-tenant
      // collaboration: a TC's home account is whatever they were
      // routed to above, but they ALSO get access to every brokerage
      // that invited their email — no manual "accept" step.
      try {
        await prisma.accountMembership.updateMany({
          where: {
            email: email,
            userId: null,
            revokedAt: null,
          },
          data: {
            userId: user.id,
            acceptedAt: new Date(),
          },
        });
      } catch (err) {
        // Non-fatal — membership linkage can be retried on next sign-in
        console.warn("[auth.createUser] membership auto-accept failed:", err);
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
