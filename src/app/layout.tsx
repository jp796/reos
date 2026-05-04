import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./ThemeProvider";
import { AppShell } from "./AppShell";
import { ToastProvider } from "./ToastProvider";
import { TermsAcceptModal } from "./TermsAcceptModal";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { PwaRegister } from "./PwaRegister";

// Brand typeface — Montserrat (per 2026 brand guide). One face for
// both body + display so weight choice (Regular/Medium/Semibold/
// Bold) does the visual differentiation, not a separate family.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "REOS · Real Estate OS",
  description: "Private AI transaction chief of staff",
  manifest: "/manifest.json",
  applicationName: "REOS",
  appleWebApp: {
    capable: true,
    title: "REOS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  themeColor: "#0B1B3A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role:
          (session.user as { role?: string }).role ?? null,
      }
    : null;

  // Does the acting user still need to accept the Terms of Use? We
  // look this up once server-side so the modal only ever renders
  // when it should. Owners are pre-accepted in createUser (they
  // authored the terms).
  let needsTerms = false;
  if (session?.user?.email) {
    const row = await prisma.user.findUnique({
      where: { email: session.user.email.toLowerCase() },
      select: { termsAcceptedAt: true },
    });
    needsTerms = !row?.termsAcceptedAt;
  }

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <html lang="en" className={montserrat.variable}>
      {/* suppressHydrationWarning: password manager / grammar extensions
          inject attrs like `bis_register` / `__processed_*` on <body>
          before React hydrates. Only ignores body-level mismatches,
          not anything deeper. */}
      <body
        className="min-h-screen bg-bg text-text antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <ToastProvider>
            <AppShell user={user} signOutAction={doSignOut}>
              {children}
            </AppShell>
            {needsTerms && <TermsAcceptModal signOutAction={doSignOut} />}
            <PwaRegister />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
