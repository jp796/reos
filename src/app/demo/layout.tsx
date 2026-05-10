/**
 * /demo layout — wraps every public sandbox page with:
 *   - DemoGuard: client-side fetch interceptor + "block" hook so
 *     no demo gesture ever POSTs to /api/*.
 *   - DemoShell: the AppShell-mirroring chrome (sidebar + top bar +
 *     persistent banner) that makes /demo feel like the real app.
 *
 * The root layout (src/app/layout.tsx) already wraps in
 * ThemeProvider + ToastProvider, and AppShell short-circuits for
 * /demo paths so we render our own chrome here.
 */

import { DemoGuard } from "./_components/DemoGuard";
import { DemoShell } from "./_components/DemoShell";

export const metadata = {
  title: "REOS · Live demo",
  description:
    "Click around a real REOS workspace. No signup required. Mock data only.",
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DemoGuard>
      <DemoShell>{children}</DemoShell>
    </DemoGuard>
  );
}
