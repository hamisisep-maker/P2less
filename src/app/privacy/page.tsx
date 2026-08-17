export const metadata = { title: "Privacy Policy — P2Less" };

export default function Privacy() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated: 2026-08-13</em></p>
      <p>
        P2Less is a conversational access platform that connects an organization&apos;s
        own messaging number (e.g. WhatsApp) to that organization&apos;s existing
        software systems, so authorized users can retrieve information and perform
        permitted actions through chat.
      </p>
      <h2>What we process</h2>
      <ul>
        <li>The messages you send to a connected organization number, and the replies generated.</li>
        <li>Your messaging identifier (e.g. phone number) to identify you to the organization you contact.</li>
        <li>Operational metadata (timestamps, request identifiers) for security and auditing.</li>
      </ul>
      <h2>How we use it</h2>
      <p>
        Only to route your request to the correct organization, authenticate and
        authorize you, call the organization&apos;s configured systems, and return a
        response. Data is isolated per organization and is not sold.
      </p>
      <h2>Security</h2>
      <p>
        Credentials are encrypted at rest; sensitive actions require step-up
        verification; access is permission-controlled; and secrets are never exposed
        in messages or logs.
      </p>
      <h2>Data requests</h2>
      <p>
        To access or delete your data, contact the organization you communicated
        with, or the platform operator, who will action the request.
      </p>
      <h2>Contact</h2>
      <p>Contact the operator of your P2Less deployment for any privacy question.</p>
    </div>
  );
}
