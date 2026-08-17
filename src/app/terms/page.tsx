export const metadata = { title: "Terms of Service — P2Less" };

export default function Terms() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", lineHeight: 1.6 }}>
      <h1>Terms of Service</h1>
      <p><em>Last updated: 2026-08-13</em></p>
      <p>
        P2Less provides infrastructure that connects an organization&apos;s messaging
        number to its authorized software systems. By using a P2Less-powered number
        you agree to use it only for legitimate, authorized purposes.
      </p>
      <h2>Acceptable use</h2>
      <ul>
        <li>Access only information and actions you are authorized for.</li>
        <li>Do not attempt to bypass authentication, authorization, or rate limits.</li>
        <li>Organizations remain responsible for the systems they connect and the data they expose.</li>
      </ul>
      <h2>No warranty</h2>
      <p>The service is provided &quot;as is&quot; without warranty. Availability depends on the connected systems.</p>
      <h2>Contact</h2>
      <p>Contact the operator of your P2Less deployment for any question about these terms.</p>
    </div>
  );
}
