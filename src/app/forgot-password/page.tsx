import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const current = await getCurrentUser();
  if (current) redirect(current.isSuperAdmin ? "/admin" : "/dashboard");

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">We'll email you a link to set a new one.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
