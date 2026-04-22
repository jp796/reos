/**
 * Sign-in page — the only route in the app not gated by auth middleware.
 * Shows a single "Sign in with Google" button. The list of allowed
 * emails is checked server-side by NextAuth's signIn callback.
 */

import { signIn } from "@/auth";

interface Props {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl ?? "/";
  const errorCode = sp.error;

  const errorText =
    errorCode === "AccessDenied"
      ? "This Google account isn't authorized to access REOS."
      : errorCode === "Configuration"
        ? "Authentication configuration error — check server logs."
        : errorCode
          ? `Sign-in failed: ${errorCode}`
          : null;

  async function doSignIn() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 shadow-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-brand-500 text-white">
            <span className="font-display text-lg font-semibold">R</span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
            Real Estate OS
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Sign in with your authorized Google account
          </p>
        </div>

        <form action={doSignIn}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text shadow-sm transition-colors hover:border-brand-500 hover:bg-brand-50"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
        </form>

        {errorText && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {errorText}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-text-subtle">
          Private workspace. Access limited to authorized team members.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.75 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
