import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {wallet,event,reserve,settle,commitUsableResult,applyPurchase,type Account} from '../lib/billing/ledger';
import {canTopUp} from '../lib/billing/auth';
import {usable} from '../lib/billing/validation';
import type {DB} from '../lib/billing/db';
const pg=new PGlite();
before(async()=>{await pg.exec(await readFile('sql/003_billing.sql','utf8'));});
after(async()=>pg.close());
const tx=<T>(fn:(db:DB)=>Promise<T>)=>pg.transaction(db=>fn(db as unknown as DB));
async function account(credits=10):Promise<Account>{
 const a:Account={id:randomUUID(),sub:randomUUID(),environment:'Sandbox'};
 await pg.query('INSERT INTO billing.customers(id,apple_sub) VALUES($1,$2)',[a.id,a.sub]);
 await tx(async db=>{await wallet(db,a);await event(db,a,'seed',credits,'test_grant');});return a;
}
const snapshot=(a:Account)=>tx(db=>wallet(db,a));
async function ready(a:Account,id:string){await pg.query("UPDATE billing.requests SET state='ready',result='{}' WHERE customer_id=$1 AND request_id=$2",[a.id,id]);}
test('successful result charges once only after acknowledgement',async()=>{
 const a=await account(),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','hash',2));assert.equal((await snapshot(a)).balance,10);
 await ready(a,id);await tx(db=>settle(db,a,id,true));await tx(db=>settle(db,a,id,true));
 assert.equal((await snapshot(a)).balance,8);assert.equal((await snapshot(a)).reserved,0);
});
test('failed AI releases reservation exactly once; late ACK cannot debit',async()=>{
 const a=await account(),id=randomUUID();await tx(db=>reserve(db,a,id,'chef','hash',2));
 await tx(db=>settle(db,a,id,false));await tx(db=>settle(db,a,id,false));await tx(db=>settle(db,a,id,true));
 assert.equal((await snapshot(a)).balance,10);assert.equal((await snapshot(a)).reserved,0);
});
test('timeout and client crash automatically release expired reservation',async()=>{
 const a=await account(),id=randomUUID();await tx(db=>reserve(db,a,id,'chef','h',2));
 await pg.query("UPDATE billing.requests SET expires_at=now()-interval '1 second' WHERE request_id=$1",[id]);
 assert.equal((await snapshot(a)).reserved,0);assert.equal((await snapshot(a)).balance,10);
 assert.equal(await tx(db=>settle(db,a,id,true)),'released');
});
test('reused request ID does not reserve twice and rejects a changed payload',async()=>{
 const a=await account(),id=randomUUID();await tx(db=>reserve(db,a,id,'chef','h',2));
 assert.equal((await tx(db=>reserve(db,a,id,'chef','h',2))).fresh,false);
 await assert.rejects(tx(db=>reserve(db,a,id,'chef','changed',2)));
 assert.equal((await snapshot(a)).reserved,2);
});
test('competing requests cannot reserve more than available balance (serialized PGlite transactions)',async()=>{
 const a=await account(3);
 const results=await Promise.allSettled([tx(db=>reserve(db,a,randomUUID(),'chef','a',2)),tx(db=>reserve(db,a,randomUUID(),'chef','b',2))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await snapshot(a)).reserved,2);
});
test('duplicate Apple transaction credits once, refund once; old JWS cannot restore credits',async()=>{
 const a=await account(0),t={transactionId:randomUUID(),productId:'credits',credits:100,revoked:false,signedDate:100};
 await tx(db=>applyPurchase(db,a,t));await tx(db=>applyPurchase(db,a,t));assert.equal((await snapshot(a)).balance,100);
 await tx(db=>applyPurchase(db,a,{...t,revoked:true,signedDate:200}));await tx(db=>applyPurchase(db,a,{...t,revoked:true,signedDate:200}));
 await tx(db=>applyPurchase(db,a,t));assert.equal((await snapshot(a)).balance,0);
});
test('refund received before client purchase does not grant credits',async()=>{
 const a=await account(0),t={transactionId:randomUUID(),productId:'credits',credits:100,revoked:true,signedDate:200};
 await tx(db=>applyPurchase(db,a,t));await tx(db=>applyPurchase(db,a,{...t,revoked:false,signedDate:100}));assert.equal((await snapshot(a)).balance,0);
});
test('purchase cannot be claimed by a different customer',async()=>{
 const a=await account(0),b=await account(0),t={transactionId:randomUUID(),productId:'credits',credits:100,revoked:false,signedDate:100};
 await tx(db=>applyPurchase(db,a,t));await assert.rejects(tx(db=>applyPurchase(db,b,t)));
 assert.equal((await snapshot(b)).balance,0);
});
test('Sandbox balance never funds Production; all verified Sandbox testers can top up',async()=>{
 const a=await account(100),p={...a,environment:'Production' as const};assert.equal((await snapshot(p)).balance,0);
 process.env.MIN_MAT_TEST_TOPUP_ENABLED='true';
 assert.equal(canTopUp(a),true);
 assert.equal(canTopUp({...a,sub:'another_testflight_tester'}),true);
 assert.equal(canTopUp(p),false);
 assert.equal(canTopUp({...p,sub:'another_testflight_tester'}),false);
 process.env.MIN_MAT_TEST_TOPUP_ENABLED='false';
 assert.equal(canTopUp(a),false);
 process.env.MIN_MAT_TEST_TOPUP_ENABLED='true';
});
test('different sessions/devices resolve the same personal balance',async()=>{
 const a=await account(100);const otherDevice={...a};assert.equal((await snapshot(otherDevice)).balance,100);
});
test('zero balance blocks work before provider; no phantom reservation',async()=>{
 const a=await account(0);await assert.rejects(tx(db=>reserve(db,a,randomUUID(),'chef','h',2)));assert.equal((await snapshot(a)).reserved,0);
});
test('invalid JSON shape, empty recipes, truncated steps and invalid images are unusable',()=>{
 assert.equal(usable('chef',{}),false);assert.equal(usable('chef',{suggestions:[]}),false);
 assert.equal(usable('chef',{suggestions:[{title:'a',steps:[],ingredients:[]}]}),false);
 assert.equal(usable('recipe-method',{steps:['']}),false);assert.equal(usable('recipe-image',{imageBase64:'junk'}),false);
 assert.equal(usable('inventory-photo',{items:[]}),false);
 assert.equal(usable('chef',{suggestions:[{title:'Soup',steps:['Boil'],ingredients:[]}]}),true);
});
test('refund after spending creates debt rather than minting replacement credits',async()=>{
 const a=await account(0),t={transactionId:randomUUID(),productId:'credits',credits:10,revoked:false,signedDate:100};
 await tx(db=>applyPurchase(db,a,t));const id=randomUUID();await tx(db=>reserve(db,a,id,'chef','h',2));await ready(a,id);await tx(db=>settle(db,a,id,true));
 await tx(db=>applyPurchase(db,a,{...t,revoked:true}));assert.equal((await snapshot(a)).balance,-2);
 await assert.rejects(tx(db=>reserve(db,a,randomUUID(),'chef','h2',2)));
});


test('one-time Pro starter bonus does not repeat on restore, reinstall or refund',async()=>{
 const {purchaseLedgerId}=await import('../lib/billing/pricing');
 const a=await account(0);
 const t={productId:'com.pettersapps.MinMat.pro',originalTransactionId:'original-pro-123',transactionId:'fresh-pro-1'};
 const apply=async(txId:string,revoked=false)=>tx(db=>applyPurchase(db,a,{
  transactionId:purchaseLedgerId({...t,transactionId:txId}),productId:t.productId,credits:100,revoked,signedDate:100
 }));
 await apply(t.transactionId);await apply('restored-pro-2');await apply('restored-pro-3');
 assert.equal((await snapshot(a)).balance,100);
 await apply('restored-pro-4',true);await apply('restored-pro-5');
 assert.equal((await snapshot(a)).balance,0);
});

test('valid AI answer commits before HTTP response; client rejection cannot get free AI',async()=>{
 const a=await account(10),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','prompt-hash',3));
 const result={suggestions:[{title:'Soup',ingredients:[],steps:['Boil vegetables']}]};
 assert.equal(usable('chef',result),true);
 assert.equal(await tx(db=>commitUsableResult(db,a,id,result)),'committed');
 // Malicious, offline or outdated clients can no longer turn a successful
 // provider result into a free AI generation by sending accept:false.
 assert.equal(await tx(db=>settle(db,a,id,false)),'committed');
 assert.equal(await tx(db=>settle(db,a,id,true)),'committed');
 const w=await snapshot(a);
 assert.equal(w.balance,7);assert.equal(w.reserved,0);
 const prior=await tx(db=>reserve(db,a,id,'chef','prompt-hash',3));
 assert.equal(prior.fresh,false);
 assert.equal(prior.state,'committed');
 assert.deepEqual(prior.result,result);
 assert.equal((await snapshot(a)).balance,7);
 const {rows}=await pg.query("SELECT kind,delta FROM billing.ledger WHERE customer_id=$1 AND event_key=$2",[a.id,'spend:'+id]);
 assert.equal(rows.length,1);assert.equal(rows[0].delta,-3);
});
test('invalid supplier result or upstream exception releases all reserved credits',async()=>{
 const a=await account(10);
 for(const invalid of [{suggestions:[]},null]){
  const id=randomUUID();
  await tx(db=>reserve(db,a,id,'chef','input-'+id,3));
  try{
   if(invalid===null)throw Error('upstream_timeout');
   assert.equal(usable('chef',invalid),false);
   throw Error('invalid_provider_response');
  }catch{
   assert.equal(await tx(db=>settle(db,a,id,false)),'released');
  }
  assert.equal((await snapshot(a)).balance,10);
  assert.equal((await snapshot(a)).reserved,0);
  assert.equal(await tx(db=>settle(db,a,id,true)),'released');
 }
 const {rows}=await pg.query("SELECT COUNT(*)::int as debits FROM billing.ledger WHERE customer_id=$1 AND delta<0",[a.id]);
 assert.equal(rows[0].debits,0);
});
test('rollback or provider timeout during commit never partially charges',async()=>{
 const a=await account(10),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','prompt',3));
 await pg.query("UPDATE billing.requests SET expires_at=now()-interval '1 second' WHERE request_id=$1",[id]);
 await assert.rejects(tx(db=>commitUsableResult(db,a,id,{suggestions:[{title:'Meal',ingredients:[],steps:['Cook']}]})));
 const w=await snapshot(a);
 assert.equal(w.balance,10);assert.equal(w.reserved,0);
});
