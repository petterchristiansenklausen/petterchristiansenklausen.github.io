import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

export const runtime = "nodejs";

export async function GET() {
  try {
    const token = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
    if (!token) return NextResponse.json({ ok:false, stage:"auth", error:"missing_token" }, { status:503 });

    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2D+IAAAAASUVORK5CYII=";
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
      body:JSON.stringify({
        model:"openai/gpt-5.6-luna",
        messages:[{
          role:"user",
          content:[
            {type:"text",text:"Health check. Reply only OK."},
            {type:"image_url",image_url:{url:image,detail:"low"}}
          ]
        }],
        max_tokens:8,
        stream:false
      })
    });

    const data = await response.json().catch(()=>({}));
    return NextResponse.json({
      ok:response.ok,
      status:response.status,
      model:"openai/gpt-5.6-luna",
      errorType:data?.error?.type || null,
      errorMessage:data?.error?.message || null,
      answered:Boolean(data?.choices?.[0]?.message?.content)
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok:false, stage:"exception", error:error instanceof Error ? error.message : "unknown" }, { status:500 });
  }
}
