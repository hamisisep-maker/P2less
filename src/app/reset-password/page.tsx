import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <AuthShell>
      {token ? (
        <>
          <h1 className="text-2xl font-semibold">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted">Must be at least 8 characters.</p>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Reset link missing</h1>
          <p className="mt-1 text-sm text-muted">This page needs a reset link from your email to work. Request a new one below.</p>
          <Link href="/forgot-password" className="mt-6 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">Request a reset link</Link>
        </>
      )}
    </AuthShell>
  );
}
