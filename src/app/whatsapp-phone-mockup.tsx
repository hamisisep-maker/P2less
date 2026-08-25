"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Wifi, Signal, BatteryFull, Mic } from "lucide-react";

type Message = { from: "them" | "me"; text: string; time: string };
type Scene = { org: string; initials: string; customer: string; messages: Message[] };

// One scene per real audience this product serves (landing-content.ts's
// AUDIENCES), each with the org that's actually replying — not always
// "P2Less" — since the whole point is P2Less stays invisible behind
// someone else's own number.
const SCENES: Scene[] = [
  {
    org: "Hamzone Technologies", initials: "HZ", customer: "Amir Hassan",
    messages: [
      { from: "them", text: "Send me my payslip.", time: "9:41" },
      { from: "me", text: "Sure. I'll need to verify it's you first. I've sent a 6-digit code.", time: "9:41" },
      { from: "them", text: "482913", time: "9:42" },
      { from: "me", text: "Verified. Here's your payslip for August 2026. Anything else?", time: "9:42" },
    ],
  },
  {
    org: "Riverside Academy", initials: "RA", customer: "Amina Yusuf",
    messages: [
      { from: "them", text: "What's John's fee balance this term?", time: "8:14" },
      { from: "me", text: "Checking John's account now, one moment.", time: "8:14" },
      { from: "me", text: "John's balance is KES 18,500 for this term.", time: "8:15" },
      { from: "them", text: "Thank you so much.", time: "8:15" },
    ],
  },
  {
    org: "Kilimani Retail", initials: "KR", customer: "Brian Otieno",
    messages: [
      { from: "them", text: "Where's my order?", time: "1:07" },
      { from: "me", text: "Order #4521 is out for delivery, arriving by 6pm today.", time: "1:07" },
      { from: "them", text: "Perfect, thank you.", time: "1:08" },
    ],
  },
  {
    org: "Nairobi Hospital", initials: "NH", customer: "Grace Njeri",
    messages: [
      { from: "them", text: "When is my next appointment?", time: "11:23" },
      { from: "me", text: "You're booked with Dr. Wanjiru on Thursday at 10am.", time: "11:23" },
      { from: "them", text: "Can we move it to Friday instead?", time: "11:24" },
      { from: "me", text: "Done. Friday at 10am, confirmed.", time: "11:24" },
    ],
  },
];

const STEP_MS = 2600;
const SCENE_PAUSE_MS = 3400;

// A generic phone-chat mockup in WhatsApp's well-known green, not a
// screenshot of the real app or its logo — same "recognizable, not
// scraped" convention as channel-badges.tsx's icon glyphs. Cycles through
// one scene per real audience (school, hospital, retail, payroll), slowly
// enough to actually read, with the header showing the ORG that's
// replying (P2Less stays invisible) and a one-time caption naming who's
// messaging in.
export function WhatsAppPhoneMockup() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const scene = SCENES[sceneIdx];

  useEffect(() => {
    const atEnd = shown >= scene.messages.length;
    const t = setTimeout(
      () => {
        if (atEnd) {
          setSceneIdx((i) => (i + 1) % SCENES.length);
          setShown(0);
        } else {
          setShown((n) => n + 1);
        }
      },
      atEnd ? SCENE_PAUSE_MS : STEP_MS,
    );
    return () => clearTimeout(t);
  }, [shown, scene.messages.length]);

  const visible = scene.messages.slice(0, shown);

  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <div className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle,var(--color-accent-soft),transparent_70%)] blur-2xl" aria-hidden="true" />

      <div className="relative rounded-[2.5rem] border-[10px] border-ink bg-ink shadow-[var(--shadow-card-hover)]">
        <div className="absolute left-1/2 top-0 z-10 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-ink" aria-hidden="true" />

        <div className="flex h-[560px] flex-col overflow-hidden rounded-[1.75rem] bg-white">
          <div className="flex items-center justify-between px-5 pb-1 pt-2 text-[11px] font-semibold text-white" style={{ background: "#075E54" }}>
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <Signal size={12} /> <Wifi size={12} /> <BatteryFull size={13} />
            </div>
          </div>

          <div key={scene.org} className="animate-in flex items-center gap-2.5 px-3 py-2.5 text-white" style={{ background: "#075E54" }}>
            <ChevronLeft size={20} />
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-[11px] font-bold">{scene.initials}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">{scene.org}</div>
              <div className="text-[10px] text-white/80">online</div>
            </div>
          </div>

          <div key={scene.org + "-body"} className="flex flex-1 flex-col justify-end space-y-2 overflow-hidden px-3 py-3" style={{ background: "#ECE5DD" }}>
            <div className="animate-in mx-auto rounded-full bg-black/5 px-3 py-1 text-center text-[10px] text-black/50">{scene.customer} · new conversation</div>
            {visible.map((m, i) => (
              <div
                key={i}
                className={"animate-in flex max-w-[80%] flex-wrap items-end gap-1.5 rounded-lg px-3 py-2 text-[13px] leading-snug shadow-sm " + (m.from === "me" ? "ml-auto rounded-tr-none" : "rounded-tl-none bg-white")}
                style={m.from === "me" ? { background: "#DCF8C6" } : undefined}
              >
                <span>{m.text}</span>
                <span className="ml-auto shrink-0 text-[10px] text-black/40">{m.time}</span>
              </div>
            ))}
            {shown < scene.messages.length && scene.messages[shown]?.from === "me" && (
              <div className="ml-auto w-fit rounded-lg px-3 py-2 shadow-sm" style={{ background: "#DCF8C6" }}>
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: "#ECE5DD" }}>
            <div className="flex-1 rounded-full bg-white px-3.5 py-2 text-[11px] text-faint">Message</div>
            <div className="grid h-8 w-8 place-items-center rounded-full text-white" style={{ background: "#075E54" }}>
              <Mic size={14} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
