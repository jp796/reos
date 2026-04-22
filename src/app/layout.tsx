import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./ThemeProvider";
import { AppShell } from "./AppShell";
import { auth, signOut } from "@/auth";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "REOS · Real Estate OS",
  description: "Private AI transaction chief of staff",
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

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-bg text-text antialiased">
        <ThemeProvider>
          <AppShell user={user} signOutAction={doSignOut}>
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
