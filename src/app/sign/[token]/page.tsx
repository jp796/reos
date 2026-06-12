import type { Metadata } from "next";
import { SignClient } from "./SignClient";

export const metadata: Metadata = {
  title: "Sign document — REOS",
  robots: { index: false, follow: false },
};

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SignClient token={token} />;
}
