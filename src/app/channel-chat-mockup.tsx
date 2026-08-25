"use client";

import { useEffect, useState } from "react";
import { Wifi, Signal, BatteryFull, Mic } from "lucide-react";

type Message = { from: "them" | "me"; text: string; time: string };
type Channel = { name: string; color: string; bubble: string; icon: string };

const ICON_PATHS: Record<string, string> = {
  whatsapp:
    "M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.07-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18a7.9 7.9 0 0 1-4.24-1.23l-.3-.19-3.05.8.82-2.97-.2-.31A7.94 7.94 0 1 1 12 20zm4.36-5.85c-.23-.12-1.38-.68-1.6-.76-.21-.08-.37-.12-.53.12-.15.23-.6.76-.74.92-.14.15-.27.17-.5.06-.23-.12-.98-.36-1.87-1.15-.69-.62-1.16-1.38-1.3-1.61-.13-.23-.01-.36.1-.47.11-.11.23-.27.35-.41.11-.14.15-.23.23-.39.08-.15.04-.29-.02-.41-.06-.12-.53-1.28-.73-1.75-.19-.46-.39-.4-.53-.4-.14-.01-.29-.01-.45-.01-.15 0-.4.06-.61.29-.21.23-.8.78-.8 1.9s.82 2.2.93 2.36c.12.15 1.62 2.47 3.92 3.47.55.24.98.38 1.31.48.55.18 1.05.15 1.45.09.44-.07 1.38-.57 1.57-1.11.19-.55.19-1.02.14-1.11-.06-.1-.21-.16-.44-.27z",
  messenger:
    "M12 2C6.5 2 2 6.15 2 11.5c0 3.05 1.47 5.77 3.78 7.55V22l3.45-1.9c.9.25 1.85.38 2.77.38 5.5 0 10-4.15 10-9.5S17.5 2 12 2zm1.02 12.79-2.55-2.72-4.98 2.72 5.48-5.82 2.61 2.72 4.9-2.72-5.46 5.82z",
  instagram:
    "M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zM12 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zm0 10.16A4 4 0 1 1 12 8a4 4 0 0 1 0 8zm6.4-10.4a1.44 1.44 0 1 1 0-2.88 1.44 1.44 0 0 1 0 2.88z",
  email:
    "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.01L12 12l8-5.99V6H4zm16 12V8.24l-7.4 5.55a1 1 0 0 1-1.2 0L4 8.24V18h16z",
  x: "M17.75 3h3.06l-6.69 7.65L22 21h-6.16l-4.83-6.32L5.5 21H2.44l7.16-8.19L2 3h6.32l4.37 5.78L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z",
  widget: "M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5",
};

const CHANNELS: Record<string, Channel> = {
  whatsapp: { name: "WhatsApp", color: "#075E54", bubble: "#DCF8C6", icon: ICON_PATHS.whatsapp },
  messenger: { name: "Messenger", color: "#0084FF", bubble: "#DCEEFF", icon: ICON_PATHS.messenger },
  instagram: { name: "Instagram", color: "#C13584", bubble: "#FCE4EC", icon: ICON_PATHS.instagram },
  email: { name: "Email", color: "#4f46e5", bubble: "#E5E7FF", icon: ICON_PATHS.email },
  x: { name: "X", color: "#12131f", bubble: "#E9E9EC", icon: ICON_PATHS.x },
  widget: { name: "Website widget", color: "#0d9488", bubble: "#CCFBF1", icon: ICON_PATHS.widget },
};

type Scene = { org: string; channel: keyof typeof CHANNELS; customer: string; messages: Message[] };

// One scene per channel P2Less answers on, each also standing in for a
// different kind of organization — generic category names, not fictional
// branded companies, since this is illustrating the PRODUCT'S range of
// channels and industries, not any one real customer.
const SCENES: Scene[] = [
  {
    org: "School", channel: "whatsapp", customer: "Khadija",
    messages: [
      { from: "them", text: "What's my child's fee balance?", time: "8:14am" },
      { from: "me", text: "One moment, checking now.", time: "8:14am" },
      { from: "me", text: "Balance is KES 12,300 for this term.", time: "8:15am" },
    ],
  },
  {
    org: "Hospital", channel: "messenger", customer: "Emmanuel",
    messages: [
      { from: "them", text: "Can I get an appointment this week?", time: "11:02am" },
      { from: "me", text: "Yes, Thursday 2pm is open. Should I book it?", time: "11:02am" },
      { from: "them", text: "Yes please.", time: "11:03am" },
      { from: "me", text: "Booked. See you Thursday at 2pm.", time: "11:03am" },
    ],
  },
  {
    org: "Retail shop", channel: "instagram", customer: "Joshua",
    messages: [
      { from: "them", text: "Is the blue jacket still in stock?", time: "3:20pm" },
      { from: "me", text: "Yes, 3 left in size M.", time: "3:20pm" },
      { from: "them", text: "I'll take one.", time: "3:21pm" },
    ],
  },
  {
    org: "Wholesale shop", channel: "email", customer: "Hamisi",
    messages: [
      { from: "them", text: "Send me this month's invoice.", time: "3:52am" },
      { from: "me", text: "Sent, KES 84,200 total for August.", time: "3:52am" },
    ],
  },
  {
    org: "Government", channel: "x", customer: "Amina",
    messages: [
      { from: "them", text: "Is my ID ready for collection?", time: "12:41am" },
      { from: "me", text: "Yes, ready at your registration center.", time: "12:41am" },
    ],
  },
  {
    org: "Hamzone Technologies", channel: "widget", customer: "New visitor",
    messages: [
      { from: "them", text: "What can P2Less do?", time: "10:10pm" },
      { from: "me", text: "I connect your number to your real systems. Ask me anything.", time: "10:10pm" },
    ],
  },
];

const STEP_MS = 3200;
const SCENE_PAUSE_MS = 5200;

// A generic phone-chat mockup, real product colors and layout, not a
// screenshot or trademark asset — same "recognizable, not scraped"
// convention as channel-badges.tsx's icon glyphs. Cycles through one
// scene per real channel and per audience this product serves, slowly
// enough to actually read, with the header/channel identity animating
// in as the org "comes online."
export function ChannelChatMockup() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const [headerKey, setHeaderKey] = useState(0);
  const scene = SCENES[sceneIdx];
  const channel = CHANNELS[scene.channel];

  useEffect(() => {
    const atEnd = shown >= scene.messages.length;
    const t = setTimeout(
      () => {
        if (atEnd) {
          setSceneIdx((i) => (i + 1) % SCENES.length);
          setShown(0);
          setHeaderKey((k) => k + 1);
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
          <div className="flex items-center justify-between px-5 pb-1 pt-2 text-[11px] font-semibold text-white transition-colors duration-500" style={{ background: channel.color }}>
            <span>9:41</span>
            <div className="flex items-center gap-1">
              <Signal size={12} /> <Wifi size={12} /> <BatteryFull size={13} />
            </div>
          </div>

          <div key={headerKey} className="header-rise-in flex items-center gap-2.5 px-3 py-2.5 text-white transition-colors duration-500" style={{ background: channel.color }}>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d={channel.icon} /></svg>
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">{scene.org}</div>
              <div className="header-online flex items-center gap-1 text-[10px] text-white/80">
                <span>{channel.name}</span><span aria-hidden="true">·</span><span>online</span>
              </div>
            </div>
          </div>

          <div key={headerKey + "-body"} className="flex flex-1 flex-col justify-end space-y-2 overflow-hidden px-3 py-3" style={{ background: "#ECE5DD" }}>
            <div className="animate-in mx-auto rounded-full bg-black/5 px-3 py-1 text-center text-[10px] text-black/50">{scene.customer} · new conversation</div>
            {visible.map((m, i) => (
              <div
                key={i}
                className={"animate-in flex max-w-[80%] flex-wrap items-end gap-1.5 rounded-lg px-3 py-2 text-[13px] leading-snug shadow-sm " + (m.from === "me" ? "ml-auto rounded-tr-none" : "rounded-tl-none bg-white")}
                style={m.from === "me" ? { background: channel.bubble } : undefined}
              >
                <span>{m.text}</span>
                <span className="ml-auto shrink-0 text-[10px] text-black/40">{m.time}</span>
              </div>
            ))}
            {shown < scene.messages.length && scene.messages[shown]?.from === "me" && (
              <div className="ml-auto w-fit rounded-lg px-3 py-2 shadow-sm" style={{ background: channel.bubble }}>
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
            <div className="grid h-8 w-8 place-items-center rounded-full text-white transition-colors duration-500" style={{ background: channel.color }}>
              <Mic size={14} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
