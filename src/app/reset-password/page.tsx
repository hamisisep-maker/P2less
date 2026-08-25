import Link from "next/link";
import { Logo } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)", backgroundSize: "36px 36px" }} />
        <Logo dark />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight">Set a new password.</p>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Choose something you haven't used before. You'll be signed in right after.
          </p>
        </div>
        <div className="relative text-xs text-white/40">P2Less Platform · MVP</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
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
        </div>
      </div>
    </div>
  );
}
