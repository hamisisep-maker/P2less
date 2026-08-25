// Registration reframe, 2026-08-25 — single source of truth for the
// useCases/channelsNeeded option lists. Previously duplicated only inside
// settings-form.tsx (with a comment asking to keep it in sync with /onboard's
// form, which no longer even has these fields since Phase 1). Now shared by
// the Settings page and the Phase 2 Explore wizard.
export const USE_CASE_OPTIONS: { value: string; label: string }[] = [
  { value: "automate_conversations", label: "Automate WhatsApp conversations for my customers" },
  { value: "sell_products", label: "Sell products & manage orders/delivery" },
  { value: "connect_systems", label: "Connect my existing software/systems" },
  { value: "developer_api", label: "I'm a developer — building on the API" },
  { value: "exploring", label: "Just exploring" },
];

export const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "messenger", label: "Facebook Messenger" },
  { value: "telegram", label: "Telegram" },
  { value: "web_chat", label: "Our website (chat widget)" },
  // Phase 3, 2026-08-26 — email was mislabeled "coming soon" here even
  // though activateEmailChannel() is a real, working connection (Resend
  // Inbound). SMS/Instagram genuinely aren't built yet, so they stay as
  // interest-only options.
  { value: "email", label: "Email" },
  { value: "sms_interested", label: "SMS (coming soon, let us know you need it)" },
  { value: "instagram_interested", label: "Instagram (coming soon, let us know you need it)" },
];
