import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { verifier } from '../lib/billing/apple';

// Public roots are DER/base64, never private keys. Production remains disabled.
test('configured Apple roots are valid trust anchors when provided',()=>{
 const raw=process.env.MIN_MAT_APPLE_ROOTS_BASE64;
 if(!raw)return; // Main / CI environments without Preview secrets
 const roots=JSON.parse(raw);
 assert.ok(Array.isArray(roots)&&roots.length>=2&&roots.length<=5);
 const subjects=roots.map((s:unknown)=>{
  assert.equal(typeof s,'string');
  const cert=new X509Certificate(Buffer.from(s as string,'base64'));
  assert.equal(cert.ca,true);
  assert.equal(cert.subject,cert.issuer);
  assert.equal(cert.verify(cert.publicKey),true);
  return cert.subject;
 });
 assert.ok(subjects.some((s:string)=>s.includes('Apple Root CA - G3')));
 assert.doesNotThrow(()=>verifier('Sandbox'));
 assert.doesNotThrow(()=>verifier('Production'));
});