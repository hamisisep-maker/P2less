import "server-only";
import { db } from "./db";
import { sendWhatsAppText } from "./transport";
import type { Driver } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Delivery dispatch — real driver-matching for a delivery order. Every step is
// a genuine confirmed event (a driver actually replying YES, a real timeout
// elapsing) — nothing here is ever assumed or simulated. Two moving parts:
//
// 1. Zone-based delivery pricing (manual, dashboard-defined — no Maps API).
// 2. Driver assignment: offer the trip to one available driver at a time, wait
//    up to OFFER_TIMEOUT_MS for a real reply, move to the next on decline/
//    timeout, mark the driver busy once assigned so nobody is double-booked.
//    A background poller (see instrumentation.ts) advances trips whose offer
//    has expired — this file only decides WHAT to do, not WHEN to check.
// ─────────────────────────────────────────────────────────────────────────────

export const OFFER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per driver, then move on

export type DeliveryZoneLike = { id: string; name: string; description: string | null; fee: number };

/** Match a free-text delivery address against the tenant's manually-defined
 *  zones by name/description word overlap — same spirit as product matching.
 *  Returns the best match, or null if nothing matches confidently. */
export function matchDeliveryZone(address: string, zones: DeliveryZoneLike[]): DeliveryZoneLike | null {
  const q = address.toLowerCase();
  const scored = zones
    .map((z) => {
      const haystack = `${z.name} ${z.description ?? ""}`.toLowerCase();
      const words = haystack.split(/[\s,;—–-]+/).filter((w) => w.length > 3);
      const matched = words.filter((w) => q.includes(w));
      return { zone: z, score: matched.length };
    })
    .filter((s) => s.score > 0);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].zone;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Is this driver's own confirmed window covering right now? Never assumed —
 *  only true if they told us today's window and we're inside it. */
export function isAvailableNow(d: Pick<Driver, "availableDate" | "availableFrom" | "availableUntil">): boolean {
  if (d.availableDate !== todayISO() || !d.availableFrom || !d.availableUntil) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = d.availableFrom.split(":").map(Number);
  const [uh, um] = d.availableUntil.split(":").map(Number);
  return nowMin >= fh * 60 + fm && nowMin <= uh * 60 + um;
}

/** Try to advance a trip: offer it to the next eligible driver who hasn't
 *  already been offered it. Called right after a delivery order is confirmed,
 *  and again by the poller whenever an offer expires unanswered. */
export async function tryAssignTrip(tripId: string): Promise<void> {
  const trip = await db.deliveryTrip.findUnique({ where: { id: tripId }, include: { order: true } });
  if (!trip || (trip.status !== "searching" && trip.status !== "offered")) return;

  const alreadyOffered = new Set((trip.offeredDriverIds as string[] | null) ?? []);
  const candidates = await db.driver.findMany({ where: { tenantId: trip.tenantId, active: true, busy: false } });
  const next = candidates.find((d) => !alreadyOffered.has(d.id) && isAvailableNow(d));

  if (!next) {
    // No one left to try — every eligible driver either declined, timed out, or
    // isn't available right now. Say so honestly, to the customer AND leave it
    // visible on the dashboard, rather than going quiet or inventing an ETA.
    await db.deliveryTrip.update({ where: { id: trip.id }, data: { status: "failed" } });
    const order = await db.order.findUnique({ where: { id: trip.orderId }, include: { tenant: { include: { numbers: true } } }, });
    const contact = order ? await db.contact.findUnique({ where: { id: order.contactId } }) : null;
    const fromId = order?.tenant.numbers[0]?.phoneNumberId;
    if (order && contact && fromId) {
      await sendWhatsAppText(fromId, contact.address, `We're having trouble finding an available driver for order ${order.reference} right now. We'll keep trying and update you as soon as we have one — sorry for the wait.`);
    }
    return;
  }

  await db.deliveryTrip.update({
    where: { id: trip.id },
    data: { status: "offered", driverId: next.id, offerExpiresAt: new Date(Date.now() + OFFER_TIMEOUT_MS), offeredDriverIds: [...alreadyOffered, next.id] },
  });
  // Held (not confirmed) as soon as an offer goes out — otherwise a second order
  // arriving seconds later could offer the SAME driver a different trip while
  // they're still deciding on this one. Released on decline/timeout/failure.
  await db.driver.update({ where: { id: next.id }, data: { busy: true } });
  const order = await db.order.findUnique({ where: { id: trip.orderId }, include: { tenant: { include: { numbers: true } } } });
  const fromId = order?.tenant.numbers[0]?.phoneNumberId;
  if (fromId) {
    await sendWhatsAppText(
      fromId,
      next.phone,
      `New delivery for order ${order!.reference}: deliver to ${order!.deliveryAddress}. Are you available to take this now? Reply YES to accept, or NO if you can't.`,
    );
  }
}

/** Scan for offers that expired with no reply and move each to the next driver.
 *  Called on a fixed interval by the background poller — this is the ONLY
 *  thing that advances a trip when a driver simply never responds. */
export async function advanceExpiredOffers(): Promise<number> {
  const expired = await db.deliveryTrip.findMany({ where: { status: "offered", offerExpiresAt: { lt: new Date() } } });
  for (const trip of expired) {
    if (trip.driverId) {
      // This driver didn't answer in time — free them up for other offers, they
      // are NOT being penalized, just no longer holding this specific offer.
      await db.driver.update({ where: { id: trip.driverId }, data: { busy: false } }).catch(() => {});
    }
    await tryAssignTrip(trip.id);
  }
  return expired.length;
}

/** Parse "8am to 6pm" / "08:00-18:00" style ranges. Deliberately REFUSES to
 *  guess when am/pm is ambiguous ("8 to 6" alone) — asks again instead, same
 *  never-assume principle as everywhere else in this system. */
function parseTimeRange(text: string): { from: string; until: string } | null {
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const m = text.match(re);
  if (!m) return null;
  const [, h1s, min1, ap1r, h2s, min2, ap2r] = m;
  const h1 = parseInt(h1s, 10);
  const h2 = parseInt(h2s, 10);
  const ap1 = (ap1r || "").toLowerCase();
  const ap2 = (ap2r || "").toLowerCase();
  const unambiguous1 = !!ap1 || h1 > 12 || h1 === 0;
  const unambiguous2 = !!ap2 || h2 > 12 || h2 === 0;
  if (!unambiguous1 || !unambiguous2) return null;
  const to24 = (h: number, min: string | undefined, ap: string) => {
    let hour = h;
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${(min ?? "00").padStart(2, "0")}`;
  };
  return { from: to24(h1, min1, ap1), until: to24(h2, min2, ap2) };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Everything a DRIVER can say to the bot, handled entirely separately from
 *  the customer conversation engine — structured commands, not small talk.
 *  Priority: respond to an active offer first, then a delivery-completion
 *  report, then availability. Returns the reply text; the caller decides how
 *  to deliver it (driver messages don't get a Conversation/Message row —
 *  they're not customer chat history). */
export async function handleDriverMessage(driver: Driver, text: string): Promise<string> {
  const lower = text.toLowerCase().trim();
  const numRow = await db.whatsAppNumber.findFirst({ where: { tenantId: driver.tenantId, status: "active" } });

  // 1) An active OFFER awaiting accept/decline takes priority over anything else.
  const offered = await db.deliveryTrip.findFirst({ where: { driverId: driver.id, status: "offered" }, include: { order: true } });
  if (offered) {
    const decline = /\b(no|nope|can'?t|cannot|busy|not available|decline|sorry)\b/i.test(lower);
    const accept = !decline && /\b(yes|yeah|yep|ok|okay|sure|available|i'?ll take it|accept|around|close)\b/i.test(lower);
    if (accept) {
      await db.deliveryTrip.update({ where: { id: offered.id }, data: { status: "assigned", assignedAt: new Date() } });
      const order = offered.order;
      const contact = await db.contact.findUnique({ where: { id: order.contactId } });
      if (contact && numRow?.phoneNumberId) {
        await sendWhatsAppText(numRow.phoneNumberId, contact.address, `Good news — a driver has been assigned to your order ${order.reference} and is on the way! We'll let you know the moment it's delivered.`);
      }
      return `Great, you're assigned! Please pick up order ${order.reference} and deliver to: ${order.deliveryAddress}. Reply DELIVERED once it's dropped off.`;
    }
    if (decline) {
      await db.deliveryTrip.update({ where: { id: offered.id }, data: { status: "searching", driverId: null, offerExpiresAt: null } });
      await db.driver.update({ where: { id: driver.id }, data: { busy: false } });
      void tryAssignTrip(offered.id); // move fast — don't wait for the 5-minute poller
      return `No problem — thanks for letting us know quickly.`;
    }
    return `Sorry, just to confirm — can you take this delivery? Reply YES or NO.`;
  }

  // 2) An ASSIGNED trip they're carrying out right now — watch for a delivered report.
  const assigned = await db.deliveryTrip.findFirst({ where: { driverId: driver.id, status: "assigned" }, include: { order: true } });
  if (assigned) {
    if (/\b(delivered|dropped off|drop off|done|complete|completed|finished)\b/i.test(lower)) {
      await db.deliveryTrip.update({ where: { id: assigned.id }, data: { status: "delivered", deliveredAt: new Date() } });
      await db.driver.update({ where: { id: driver.id }, data: { busy: false } });
      const order = assigned.order;
      const contact = await db.contact.findUnique({ where: { id: order.contactId } });
      if (contact && numRow?.phoneNumberId) {
        await sendWhatsAppText(numRow.phoneNumberId, contact.address, `Your order ${order.reference} has been delivered! How did it go — any issues (late, damaged, etc.)? Just reply and let us know.`);
        const convo = await db.conversation.findFirst({ where: { tenantId: driver.tenantId, contactId: contact.id, numberId: numRow.id, status: { not: "closed" } } });
        if (convo) {
          await db.conversation.update({ where: { id: convo.id }, data: { status: "awaiting_delivery_feedback", context: { ...(convo.context as object), awaitingFeedbackTripId: assigned.id } } });
        }
      }
      return `Marked as delivered — thanks!`;
    }
    // Rule: a driver can never cancel a trip already assigned to them (agreed
    // "strict" rule) — anything else while carrying an active trip is treated
    // as a normal message, not a way out of the delivery.
  }

  // 3) Otherwise, this is about today's availability.
  if (/\b(not available|unavailable|can'?t work|off today|no work today|not working)\b/i.test(lower)) {
    if (driver.busy) return `Noted for later — but you're currently on an active delivery, so let's get that done first. Reply DELIVERED once it's dropped off.`;
    await db.driver.update({ where: { id: driver.id }, data: { availableDate: todayISO(), availableFrom: null, availableUntil: null } });
    return `Got it — noted you're not available today. Thanks for letting us know!`;
  }
  const range = parseTimeRange(text);
  if (range) {
    const hasExistingToday = driver.availableDate === todayISO() && driver.availableFrom && driver.availableUntil;
    if (hasExistingToday) {
      // Strict rule: a same-day change may only SHRINK the already-confirmed
      // window, never extend it — extending needs a human, not a WhatsApp text.
      const shrinks = minutesOf(range.from) >= minutesOf(driver.availableFrom!) && minutesOf(range.until) <= minutesOf(driver.availableUntil!);
      if (!shrinks) {
        return `You already confirmed ${driver.availableFrom}–${driver.availableUntil} today. I can only shorten that window over WhatsApp, not extend it — please contact the business directly if you need to extend.`;
      }
    }
    await db.driver.update({ where: { id: driver.id }, data: { availableDate: todayISO(), availableFrom: range.from, availableUntil: range.until } });
    return `Got it — you're set as available today from ${range.from} to ${range.until}. We'll reach out here if a delivery comes up.`;
  }
  return `Hi! Are you available today? If yes, reply with your hours, e.g. "8am to 6pm". If not, just say "not available today".`;
}

const POLL_INTERVAL_MS = 30 * 1000;
declare global {
  // eslint-disable-next-line no-var
  var __p2lessDispatchPoller: NodeJS.Timeout | undefined;
}

/** Starts the ONE background loop that advances trips whose driver-offer timed
 *  out. Guarded against double-starting (Next dev mode can re-run
 *  instrumentation on hot reload) via a global flag. */
export function startDispatchPoller(): void {
  if (globalThis.__p2lessDispatchPoller) return;
  globalThis.__p2lessDispatchPoller = setInterval(() => {
    advanceExpiredOffers().catch((e) => console.error("[dispatch-poller]", e));
  }, POLL_INTERVAL_MS);
}
