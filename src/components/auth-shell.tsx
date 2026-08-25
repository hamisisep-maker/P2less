import { Logo } from "@/components/ui";
import { ChannelChatMockup } from "@/app/channel-chat-mockup";
import { version } from "../../package.json";

// Shared shell for /login, /forgot-password, /reset-password — one place
// to keep them visually consistent. Left panel is a dark teal-to-ink
// gradient (not flat black), the same multi-channel chat mockup used on
// the homepage hero running as its "video," and real attribution/version
// info instead of a wall of marketing copy.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[linear-gradient(160deg,var(--color-accent-ink),var(--color-ink))] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.5) 1px,transparent 1px)", backgroundSize: "36px 36px" }} />
        <Logo dark />
        <div className="relative flex flex-1 items-center justify-center py-6">
          <ChannelChatMockup />
        </div>
        <div className="relative flex items-center justify-between text-xs text-white/40">
          <span>Powered by Hamzone Technologies</span>
          <span>P2Less Platform · MVP · v{version}</span>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
