import { getVercelOidcToken } from "@vercel/oidc";
import { NextRequest, NextResponse } from "next/server";
import { recordAiUsageLater } from "../../ai-usage";
import { cleanRecipeScan } from "./validation";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const MODEL="openai/gpt-5.6-luna";
const MAX_BODY=1_320_000;
const JPEG_PREFIX="data:image/jpeg;base64,";

const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});

/** Backend-only route; the public client can only reach it through server-side billing. */
export async function POST(request:NextRequest) {
 if(!process.env.MIN_MAT_CLIENT_TOKEN || request.headers.get("x-minmat-client")!==process.env.MIN_MAT_CLIENT_TOKEN) {
  return json({error:"unauthorized"},401);
 }
 try {
  const raw=await request.text();
  if(raw.length>MAX_BODY)return json({error:"request_too_large"},413);
  const input=JSON.parse(raw) as {images?:unknown;language?:unknown};
  if(!Array.isArray(input.images)||input.images.length<1||input.images.length>6) {
   return json({error:"invalid_images"},400);
  }
  const images:string[]=[];
  for(const candidate of input.images){
   if(typeof candidate!=="string"||!candidate.startsWith(JPEG_PREFIX)||candidate.length>1_240_000) {
    return json({error:"invalid_images"},400);
   }
   const encoded=candidate.slice(JPEG_PREFIX.length);
   if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return json({error:"invalid_images"},400);
   const buffer=Buffer.from(encoded,"base64");
   if(buffer.length<800 || buffer.length>930000 || buffer[0]!==0xff || buffer[1]!==0xd8 || buffer[2]!==0xff) {
    return json({error:"invalid_images"},400);
   }
   images.push(candidate);
  }
  const token=process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || await getVercelOidcToken();
  if(!token)return json({error:"provider_unavailable"},503);
  const instructions=[
   "Du er en svært nøyaktig transkribent for norske papir- og familieoppskrifter.",
   "Les alle sidene som én oppskrift, i den oppgitte rekkefølgen.",
   "Les bokmål, nynorsk, dialekter, gammelt norsk språk og håndskrift, inkludert æ, ø og å.",
   "Bruk også kontekst for å forstå bokstaver, men aldri finn på ingredienser, mengder, tider, temperaturer eller steg.",
   "Behold gamle måleenheter (kaffekopp, pott, neve osv.) og dialektord ordrett – ikke konverter dem.",
   "Behold 1/2, 1 pk, ss og ts nøyaktig slik de står når de er lesbare.",
   "Skriv tittelen, ingredienser og trinn i egne lister. Samle sammenhengende setninger til sammenhengende trinn.",
   "rawText skal inneholde din beste trofaste avlesning av alle sider i rekkefølge.",
   "uncertainties: beskriv konkrete ord/tall du ikke kan lese sikkert, med sidetall og gjerne mulige lesninger.",
   "Ved uleselige deler, behold [uleselig] i rawText og marker usikkerheten; IKKE gjett.",
   "Har du ikke nok tekst til både ingredienser og fremgangsmåte, returner tom liste for det du mangler.",
   `Returner KUN gyldig JSON: {"title":"...","ingredients":["..."],"steps":["..."],"rawText":"...","uncertainties":["..."]}.`,
   "Ikke legg til forklaringer, helse- eller sikkerhetsråd eller opplysninger utenfor bildene."
  ].join("\n");
  const response=await fetch("https://ai-gateway.vercel.sh/v1/chat/completions",{
   method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify({model:MODEL, messages:[
    {role:"system",content:instructions},
    {role:"user",content:[
      {type:"text",text:"Tolk denne oppskriften i riktig siderekkefølge. Bevar original språkbruk."},
      ...images.map(url=>({type:"image_url",image_url:{url}}))
    ]}
   ],response_format:{type:"json_object"},max_completion_tokens:3600}),
   signal:AbortSignal.timeout(52000)
  });
  const gateway=await response.json().catch(()=>null);
  recordAiUsageLater("recipe-scan",response.status,gateway,MODEL,token);
  if(!response.ok)return json({error:"provider_unavailable"},502);
  const choice=gateway?.choices?.[0];
  if(!choice||choice.message?.refusal||["length","content_filter"].includes(choice.finish_reason)) {
   return json({error:"unusable_scan"},502);
  }
  if(typeof choice.message?.content!=="string")return json({error:"unusable_scan"},502);
  let decoded:unknown;
  try {decoded=JSON.parse(choice.message.content);}catch{return json({error:"unusable_scan"},502);}
  const cleaned=cleanRecipeScan(decoded);
  if(!cleaned)return json({error:"unusable_scan"},422);
  return json(cleaned);
 }catch {
  // No image contents, user-specific values, or token strings in logs.
  console.warn("recipe_scan_provider_unavailable");
  return json({error:"provider_unavailable"},502);
 }
}
