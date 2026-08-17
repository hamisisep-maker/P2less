import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// M-Pesa (Safaricom Daraja) STK Push — real Lipa na M-Pesa "push to phone".
//
// Configure via .env (sandbox is free — get a consumer key/secret at
// developer.safaricom.co.ke; the sandbox shortcode 174379 + public passkey work
// out of the box). If credentials are absent, isConfigured() is false and the
// billing flow falls back to an instant mock so the demo still runs.
// ─────────────────────────────────────────────────────────────────────────────

function cfg() {
  const env = (process.env.MPESA_ENV || "sandbox").toLowerCase();
  return {
    env,
    base: env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
    key: process.env.MPESA_CONSUMER_KEY || "",
    secret: process.env.MPESA_CONSUMER_SECRET || "",
    shortcode: process.env.MPESA_SHORTCODE || "174379",
    // Public sandbox passkey (safe to default); override in production.
    passkey: process.env.MPESA_PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
    callbackUrl: process.env.MPESA_CALLBACK_URL || `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/api/payments/mpesa/callback`,
  };
}

export function isConfigured(): boolean {
  // Explicit kill-switch: keeps the real key/secret wired in (verified working)
  // but forces every payment through the instant-mock path — e.g. while testing,
  // since Daraja SANDBOX only pushes a real PIN prompt to Safaricom's own test
  // MSISDN (254708374149), never to arbitrary real numbers. Flip off to resume
  // real STK pushes without re-entering credentials.
  if ((process.env.MPESA_FORCE_MOCK || "").toLowerCase() === "true") return false;
  const c = cfg();
  return !!c.key && !!c.secret && /^https?:\/\//.test(c.callbackUrl);
}

/** Normalize a Kenyan number to Daraja's 2547XXXXXXXX / 2541XXXXXXXX form. */
export function normalizeMsisdn(phone: string): string {
  let p = phone.replace(/[^\d]/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  else if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  else if (p.startsWith("254")) { /* ok */ }
  return p;
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const c = cfg();
  const auth = Buffer.from(`${c.key}:${c.secret}`).toString("base64");
  const res = await fetch(`${c.base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`daraja auth ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: string };
  tokenCache = { token: json.access_token, exp: Date.now() + (Number(json.expires_in) - 60) * 1000 };
  return json.access_token;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type StkResult =
  | { ok: true; checkoutId: string; merchantId: string; customerMessage: string }
  | { ok: false; error: string };

/** Send an STK push. On success the user's phone shows the M-Pesa PIN prompt; the
 *  final result arrives asynchronously at the callback URL. */
export async function stkPush(opts: { phone: string; amount: number; accountRef: string; description: string }): Promise<StkResult> {
  const c = cfg();
  const ts = timestamp();
  const password = Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString("base64");
  const msisdn = normalizeMsisdn(opts.phone);
  try {
    const token = await getToken();
    const res = await fetch(`${c.base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        BusinessShortCode: c.shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.max(1, Math.round(opts.amount)),
        PartyA: msisdn,
        PartyB: c.shortcode,
        PhoneNumber: msisdn,
        CallBackURL: c.callbackUrl,
        AccountReference: opts.accountRef.slice(0, 12),
        TransactionDesc: opts.description.slice(0, 20),
      }),
    });
    const json = (await res.json()) as { ResponseCode?: string; CheckoutRequestID?: string; MerchantRequestID?: string; CustomerMessage?: string; errorMessage?: string; ResponseDescription?: string };
    if (json.ResponseCode === "0" && json.CheckoutRequestID) {
      return { ok: true, checkoutId: json.CheckoutRequestID, merchantId: json.MerchantRequestID ?? "", customerMessage: json.CustomerMessage ?? "Check your phone to enter your M-Pesa PIN." };
    }
    return { ok: false, error: json.errorMessage || json.ResponseDescription || "M-Pesa request was not accepted." };
  } catch {
    return { ok: false, error: "Could not reach M-Pesa. Please try again." };
  }
}

/** Parse a Daraja STK callback body → { checkoutId, success, receipt }. */
export function parseCallback(body: unknown): { checkoutId: string; success: boolean; receipt?: string; desc?: string } | null {
  try {
    const cb = (body as { Body?: { stkCallback?: { CheckoutRequestID: string; ResultCode: number; ResultDesc?: string; CallbackMetadata?: { Item: { Name: string; Value: unknown }[] } } } }).Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return null;
    const success = cb.ResultCode === 0;
    const receipt = cb.CallbackMetadata?.Item?.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
    return { checkoutId: cb.CheckoutRequestID, success, receipt: receipt ? String(receipt) : undefined, desc: cb.ResultDesc };
  } catch {
    return null;
  }
}
