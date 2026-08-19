import { Wrench } from "lucide-react";
import { Logo } from "./ui";

export function MaintenanceScreen({ message, onLogout }: { message: string; onLogout: () => Promise<void> }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,_var(--color-accent-soft),_transparent_45%)] p-6">
      <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
        <div className="mb-4 flex justify-center"><Logo /></div>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Wrench size={22} />
        </div>
        <h1 className="font-display text-lg font-semibold">We&apos;ll be right back</h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <form action={onLogout} className="mt-6">
          <button type="submit" className="text-xs font-medium text-faint underline hover:text-muted">Sign out</button>
        </form>
      </div>
    </div>
  );
}
