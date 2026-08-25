import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/ui";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const current = await getCurrentUser();
  if (current) redirect(current.isSuperAdmin ? "/admin" : "/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)", backgroundSize: "36px 36px" }} />
        <Logo dark />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight">Let's get you back in.</p>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Enter the email on your account and we'll send a link to set a new password.
          </p>
        </div>
        <div className="relative text-xs text-white/40">P2Less Platform · MVP</div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-2xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">We'll email you a link to set a new one.</p>
          <ForgotPasswordForm />
          <p className="mt-6 text-center text-sm text-muted">
            <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
