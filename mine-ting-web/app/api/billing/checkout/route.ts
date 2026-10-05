import Stripe from "stripe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";

export async function POST(request: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID) {
      return NextResponse.json({ ok: false, error: "Betaling er ikke ferdig konfigurert ennå." }, { status: 503 });
    }

    const body = await request.json();
    const token = String(body.token || "");
    if (!token) return NextResponse.json({ ok: false, error: "Logg inn før du oppgraderer til Pro." }, { status: 401 });

    const meResponse = await fetch(`${BACKEND_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const me = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !me?.user?.email) return NextResponse.json({ ok: false, error: "Innloggingen er utløpt." }, { status: 401 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      customer_email: me.user.email,
      client_reference_id: me.user.id,
      allow_promotion_codes: true,
      success_url: `${origin}/?pro=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?pro=cancelled`,
      metadata: {
        mineTingUserId: me.user.id,
        mineTingEmail: me.user.email,
        mineTingPlan: "pro"
      },
      subscription_data: {
        metadata: {
          mineTingUserId: me.user.id,
          mineTingEmail: me.user.email,
          mineTingPlan: "pro"
        }
      }
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("checkout route", error);
    return NextResponse.json({ ok: false, error: "Kunne ikke starte betalingen." }, { status: 500 });
  }
}
