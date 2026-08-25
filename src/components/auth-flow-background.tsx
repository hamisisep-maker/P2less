// Ambient background for AuthShell's left panel — no chat bubbles, no
// readable text, just motion: a small dot travels a path from a "customer"
// node, through a "P2Less" node, out to a "your system" node, and a second
// dot travels the return path back — the shape of a conversation round
// trip, not its literal content. Sits behind the Logo/footer as a quiet
// background layer, the same role the grid-pattern overlay already plays.
const OUT_PATH = "M 70 90 C 160 150, 160 260, 210 320 C 250 370, 260 430, 320 480";
const BACK_PATH = "M 320 480 C 260 430, 250 370, 210 320 C 160 260, 160 150, 70 90";

export function AuthFlowBackground() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d={OUT_PATH} fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="1" strokeDasharray="2 8" strokeLinecap="round" />

      <circle cx="70" cy="90" r="4" fill="white" fillOpacity="0.08" />
      <circle cx="210" cy="320" r="4.5" fill="white" fillOpacity="0.1" />
      <circle cx="320" cy="480" r="4" fill="white" fillOpacity="0.08" />

      <circle r="3" fill="var(--color-accent)" fillOpacity="0.35">
        <animateMotion dur="5.5s" repeatCount="indefinite" path={OUT_PATH} />
        <animate attributeName="opacity" values="0;0.35;0.35;0" keyTimes="0;0.08;0.85;1" dur="5.5s" repeatCount="indefinite" />
      </circle>
      <circle r="2.5" fill="var(--color-accent)" fillOpacity="0.2">
        <animateMotion dur="5.5s" begin="2.75s" repeatCount="indefinite" path={BACK_PATH} />
        <animate attributeName="opacity" values="0;0.2;0.2;0" keyTimes="0;0.08;0.85;1" dur="5.5s" begin="2.75s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
