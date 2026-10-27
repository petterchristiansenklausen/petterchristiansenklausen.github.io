import { X509Certificate,createHash } from "node:crypto";
import { NextResponse } from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const URLs=[
 "https://www.apple.com/appleca/AppleIncRootCertificate.cer",
 "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
 "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer"
] as const;
// TEMPORARY PUBLIC-ROOT RETRIEVAL ONLY. No user input, secrets, DB or tokens.
export async function GET(){
 try {
  const certs=[];
  for(const url of URLs){
   const response=await fetch(url,{signal:AbortSignal.timeout(12000),cache:"no-store",redirect:"error"});
   if(!response.ok)throw Error("apple_root_http_error");
   const bytes=Buffer.from(await response.arrayBuffer());
   if(bytes.length<500||bytes.length>10000)throw Error("apple_root_size_invalid");
   const cert=new X509Certificate(bytes);
   if(!cert.ca||cert.subject!==cert.issuer||!cert.verify(cert.publicKey))throw Error("apple_root_invalid");
   certs.push({url,subject:cert.subject,sha256:createHash("sha256").update(bytes).digest("hex"),b64:bytes.toString("base64")});
  }
  return NextResponse.json({roots:certs},{headers:{"Cache-Control":"no-store"}});
 }catch{
  return NextResponse.json({error:"root_retrieval_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
 }
}