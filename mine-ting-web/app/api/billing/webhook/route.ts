import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";

async function setEntitlement(email: string, plan: "free" | "pro", source: string, validUntil?: string | null) {
  const secret = process.env.MINE_TING_BACKEND_ADMIN_SECRET;
  if (!secret || !BACKEND_URL) throw new Error("Backend entitlement bridge is not configured");
  const response = await fetch(`${BACKEND_URL}/admin/entitlement`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Secret": secret
    },
    body: JSON.stringify({ email, plan, source, validUntil: validUntil || null })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Entitlement update failed: ${response.status} ${text}`);
  }
}

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, error: "Missing Stripe signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    const raw = await request.text();
    event = stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Stripe signature error", error);
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = session.metadata?.mineTingEmail || session.customer_details?.email || session.customer_email || "";
      if (email) await setEntitlement(email, "pro", "stripe");
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const emailFromMetadata = subscription.metadata?.mineTingEmail || "";
      let email = emailFromMetadata;
      if (!email && subscription.customer) {
        const customer = await stripe.customers.retrieve(String(subscription.customer));
        if (!customer.deleted) email = customer.email || "";
      }
      if (email) {
        const active = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(subscription.status);
        const periodEnd = (subscription as any).current_period_end;
        const validUntil = active && periodEnd ? new Date(Number(periodEnd) * 1000).toISOString() : null;
        await setEntitlement(email, active ? "pro" : "free", "stripe", validUntil);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handling error", error);
    return NextResponse.json({ ok: false, error: "Webhook handling failed." }, { status: 500 });
  }
}
