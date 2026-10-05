import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_URL = process.env.NEXT_PUBLIC_MINE_TING_API_URL || "";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token || "");
    const image = String(body.image || "");

    if (!token) return NextResponse.json({ ok: false, error: "Logg inn for å lagre bilder i skyen." }, { status: 401 });
    if (!image.startsWith("data:image/")) return NextResponse.json({ ok: false, error: "Ugyldig bilde." }, { status: 400 });
    if (image.length > 8_000_000) return NextResponse.json({ ok: false, error: "Bildet er for stort." }, { status: 413 });

    const meResponse = await fetch(`${BACKEND_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const me = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !me?.user?.id) {
      return NextResponse.json({ ok: false, error: "Innloggingen er utløpt." }, { status: 401 });
    }

    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ ok: false, error: "Kunne ikke lese bildet." }, { status: 400 });

    const mime = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `mine-ting/${me.user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const blob = await put(path, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: mime,
      cacheControlMaxAge: 31536000
    });

    return NextResponse.json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (error) {
    console.error("upload route", error);
    return NextResponse.json({ ok: false, error: "Kunne ikke lagre bildet i skyen." }, { status: 500 });
  }
}
