"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clsx } from "clsx";

// Real gap found 2026-08-23, asked directly ("check on the passwords for
// fields they should have toggle"): every password field in the app (login,
// both password-change forms, and the three connector-credential fields —
// API key, bearer token, basic-auth password) was a bare type="password"
// input with no way to check what you typed before submitting. One shared
// component instead of fixing five files independently — a separate client
// file (not added to components/ui.tsx, which several server components
// import directly; a "use client" there would force those to become client
// components too).
export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={clsx(className, "pr-9")} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-muted"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
