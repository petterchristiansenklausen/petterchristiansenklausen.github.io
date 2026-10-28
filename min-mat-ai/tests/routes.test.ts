import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/billing/[...path]/route';
import {POST as legacy} from '../app/api/chef/route';
import {appEnvironment} from '../lib/billing/apple';
// HTTP behavior tests intentionally run in an isolated Sandbox simulation.
// Production flags are tested separately by mode.test.ts.
process.env.VERCEL_ENV='preview';
process.env.MIN_MAT_BILLING_ENVIRONMENT='Sandbox';
const req=(path:string,body?:any,headers:Record<string,string>={})=>new NextRequest('https://example.test/api/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
test('billing is explicitly disabled by default',async()=>{
 delete process.env.MIN_MAT_BILLING_ENABLED;
 const response=await GET(req('billing/config'));assert.deepEqual(await response.json(),{enabled:false});
 assert.equal((await POST(req('billing/test-topup',{amount:100}))).status,503);
});
test('production client cannot self-assert Sandbox with headers or JSON',async()=>{
 process.env.MIN_MAT_BILLING_ENABLED='true';
 const response=await POST(req('billing/test-topup',{amount:100,environment:'Sandbox'},{'x-environment':'Sandbox','x-minmat-client':'copied-app-token'}));
 assert.equal(response.status,401);
});
test('legacy client token cannot bypass active billing',async()=>{
 process.env.MIN_MAT_BILLING_ENABLED='true';assert.equal((await legacy(req('chef',{}, {'x-minmat-client':'anything'}))).status,426);
});
test('unverified Apple app transaction is rejected, not treated as Sandbox',async()=>{
 delete process.env.MIN_MAT_APPLE_ROOTS_BASE64;
 await assert.rejects(appEnvironment('forged.sandbox.signature'));
});
test('invalid JSON and oversized body rejected before account/provider work',async()=>{
 process.env.MIN_MAT_BILLING_ENABLED='true';
 assert.equal((await POST(new NextRequest('https://example.test/api/billing/test-topup',{method:'POST',body:'{'}))).status,400);
 assert.equal((await POST(new NextRequest('https://example.test/api/billing/test-topup',{method:'POST',body:'x'.repeat(1500001)}))).status,413);
});
