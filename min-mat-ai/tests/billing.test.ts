import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {wallet,event,reserve,settle,settleClient,commitUsableResult,applyPurchase,sandboxDailyCreditLimit,sandboxDailyCreditUsage,type Account} from '../lib/billing/ledger';
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
test('Apple refund reversal restores the same transaction only after verified notification',async()=>{
 const a=await account(0),t={transactionId:randomUUID(),productId:'com.pettersapps.MinMat.credits.starter',credits:100,revoked:false,signedDate:100};
 await tx(db=>applyPurchase(db,a,t));
 await tx(db=>applyPurchase(db,a,{...t,revoked:true,signedDate:200}));
 assert.equal((await snapshot(a)).balance,0);
 // A replayed purchase receipt without a verified reversal never regrants.
 await tx(db=>applyPurchase(db,a,t));assert.equal((await snapshot(a)).balance,0);
 await tx(db=>applyPurchase(db,a,{...t,refundReversed:true,signedDate:300}));
 await tx(db=>applyPurchase(db,a,{...t,refundReversed:true,signedDate:300}));
 assert.equal((await snapshot(a)).balance,100);
 // A second refund is distinct, so the previous refund event cannot suppress it.
 await tx(db=>applyPurchase(db,a,{...t,revoked:true,signedDate:400}));
 await tx(db=>applyPurchase(db,a,{...t,revoked:true,signedDate:400}));
 assert.equal((await snapshot(a)).balance,0);
});
test('reversal of an unknown transaction cannot mint credits',async()=>{
 const a=await account(0),t={transactionId:randomUUID(),productId:'com.pettersapps.MinMat.credits.large',credits:1000,revoked:false,signedDate:100,refundReversed:true};
 await assert.rejects(tx(db=>applyPurchase(db,a,t)));
 assert.equal((await snapshot(a)).balance,0);
});
test('credit packs grant once per Apple purchase; separately purchased packs can credit again',async()=>{
 const a=await account(0);
 const products=[['starter',100],['standard',300],['large',1000]] as const;
 let sum=0;
 for(const [name,amount] of products){
  const t={transactionId:randomUUID(),productId:'com.pettersapps.MinMat.credits.'+name,credits:amount,revoked:false,signedDate:100};
  await tx(db=>applyPurchase(db,a,t));
  await tx(db=>applyPurchase(db,a,t)); // HTTP retry, no second credit grant.
  sum+=amount;
  assert.equal((await snapshot(a)).balance,sum);
 }
 // Consumables can be bought a second time: the DIFFERENT Apple transaction
 // is legitimate and must not be rejected as a duplicate purchase.
 await tx(db=>applyPurchase(db,a,{transactionId:randomUUID(),productId:'com.pettersapps.MinMat.credits.starter',credits:100,revoked:false,signedDate:100}));
 assert.equal((await snapshot(a)).balance,1500);
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
test('Sandbox balance never funds Production; any verified Sandbox tester can top up',async()=>{
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

// StoreKit may supply a new transaction ID when a non-consumable is restored.
test('one-time Pro starter grant does not repeat on restore or after refund',async()=>{
 const {purchaseLedgerId}=await import('../lib/billing/pricing');
 const a=await account(0);
 const t={productId:'com.pettersapps.MinMat.pro',originalTransactionId:'original-pro-123',transactionId:'fresh-pro-1'};
 const apply=async(txId:string,revoked=false)=>tx(db=>applyPurchase(db,a,{transactionId:purchaseLedgerId({...t,transactionId:txId}),productId:t.productId,credits:100,revoked,signedDate:100}));
 await apply(t.transactionId);await apply('restored-pro-2');await apply('restored-pro-3');
 assert.equal((await snapshot(a)).balance,100);
 await apply('restored-pro-4',true);await apply('restored-pro-5');
 assert.equal((await snapshot(a)).balance,0);
});

test('valid AI result debits server-side before response, no free result via reject ACK',async()=>{
 const a=await account(10),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','prompt-hash',3));
 const result={suggestions:[{title:'Soup',ingredients:[],steps:['Boil vegetables']}]};
 assert.equal(usable('chef',result),true);
 assert.equal(await tx(db=>commitUsableResult(db,a,id,result)),'committed');
 assert.equal(await tx(db=>settle(db,a,id,false)),'committed');
 assert.equal(await tx(db=>settle(db,a,id,true)),'committed');
 const w=await snapshot(a);assert.equal(w.balance,7);assert.equal(w.reserved,0);
 const prior=await tx(db=>reserve(db,a,id,'chef','prompt-hash',3));
 assert.equal(prior.fresh,false);assert.equal(prior.state,'committed');
 assert.deepEqual(prior.result,result);
 assert.equal((await snapshot(a)).balance,7);
 const {rows}=await pg.query("SELECT kind,delta FROM billing.ledger WHERE customer_id=$1 AND event_key=$2",[a.id,'spend:'+id]);
 assert.equal(rows.length,1);assert.equal((rows[0] as {delta:number}).delta,-3);
});
test('invalid supplier output and supplier timeout release credits',async()=>{
 const a=await account(10);
 for(const invalid of [{suggestions:[]},null]){
  const id=randomUUID();await tx(db=>reserve(db,a,id,'chef','input-'+id,3));
  try{
   if(invalid===null)throw Error('upstream_timeout');
   assert.equal(usable('chef',invalid),false);
   throw Error('invalid_provider_response');
  }catch{assert.equal(await tx(db=>settle(db,a,id,false)),'released');}
  assert.equal((await snapshot(a)).balance,10);
  assert.equal((await snapshot(a)).reserved,0);
  assert.equal(await tx(db=>settle(db,a,id,true)),'released');
 }
 const {rows}=await pg.query("SELECT COUNT(*)::int as debits FROM billing.ledger WHERE customer_id=$1 AND delta<0",[a.id]);
 assert.equal((rows[0] as {debits:number}).debits,0);
});
test('expired provider request cannot create a partial credit charge',async()=>{
 const a=await account(10),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','prompt',3));
 await pg.query("UPDATE billing.requests SET expires_at=now()-interval '1 second' WHERE request_id=$1",[id]);
 await assert.rejects(tx(db=>commitUsableResult(db,a,id,{suggestions:[{title:'Meal',ingredients:[],steps:['Cook']}]})));
 const w=await snapshot(a);assert.equal(w.balance,10);assert.equal(w.reserved,0);
});

// Client-created release acknowledgements are never valid during AI work.
test('client negative acknowledgment cannot release an in-flight response',async()=>{
 const a=await account(10),id=randomUUID();
 await tx(db=>reserve(db,a,id,'chef','hash-for-test',3));
 await assert.rejects(tx(db=>settleClient(db,a,id,false)),(e:any)=>e.code==='settlement_server_managed');
 assert.equal((await snapshot(a)).reserved,3);
 await ready(a,id);
 await assert.rejects(tx(db=>settleClient(db,a,id,false)),(e:any)=>e.code==='settlement_server_managed');
 assert.equal(await tx(db=>settleClient(db,a,id,true)),'committed');
 assert.equal(await tx(db=>settleClient(db,a,id,false)),'committed');
 assert.equal((await snapshot(a)).balance,7);
});

test('reinstallation reuses the same Apple application transaction wallet',async()=>{
 const downloadID='storekit-signed-test-app-transaction';
 const upsert=async(environment:'Sandbox'|'Production')=>{
  const r=await pg.query<{id:string}>(`INSERT INTO billing.customers (id,apple_sub,app_environment,app_transaction_id)
   VALUES($1,NULL,$2,$3)
   ON CONFLICT(app_environment,app_transaction_id) WHERE app_transaction_id IS NOT NULL
   DO UPDATE SET app_transaction_id=EXCLUDED.app_transaction_id RETURNING id`,
   [randomUUID(),environment,downloadID]);
  return r.rows[0].id;
 };
 const first=await upsert('Sandbox');
 const a:Account={id:first,sub:downloadID,environment:'Sandbox',appTransactionId:downloadID};
 await tx(async db=>{await wallet(db,a);await event(db,a,'initial-grant',4,'test_grant');});
 assert.equal(await upsert('Sandbox'),first);
 assert.equal((await snapshot(a)).balance,4);
 const other=await upsert('Production');
 assert.notEqual(other,first);
 const production:Account={...a,id:other,environment:'Production'};
 assert.equal((await snapshot(production)).balance,0);
});

test('lost response replays committed result when wallet has no credit left',async()=>{
 const a=await account(2),id=randomUUID(),result={answer:'Test',suggestions:[{title:'Test',ingredients:[],steps:['Cook']}],mealPlan:[]};
 await tx(db=>reserve(db,a,id,'chef','replay-zero',2));
 await tx(db=>commitUsableResult(db,a,id,result));
 assert.equal((await snapshot(a)).balance,0);
 const replay=await tx(db=>reserve(db,a,id,'chef','replay-zero',2));
 assert.equal(replay.fresh,false);assert.equal(replay.state,'committed');assert.deepEqual(replay.result,result);
 await tx(db=>settleClient(db,a,id,true));assert.equal((await snapshot(a)).balance,0);
});
test('failed image attempt releases once and new request can reserve without double debit',async()=>{
 const a=await account(3),first=randomUUID(),second=randomUUID();
 await tx(db=>reserve(db,a,first,'recipe-image','same-image-input',3));
 await tx(db=>settle(db,a,first,false));await tx(db=>settle(db,a,first,false));
 assert.equal((await snapshot(a)).balance,3);
 await tx(db=>reserve(db,a,second,'recipe-image','same-image-input',3));
 assert.equal((await snapshot(a)).reserved,3);await tx(db=>settle(db,a,second,false));
 assert.equal((await snapshot(a)).reserved,0);assert.equal((await snapshot(a)).balance,3);
});

test('conversation answer commits once; invalid and legacy text answers release without debit',async()=>{
 const result={answer:'Sjekk etiketten for produktets næringsinnhold.',suggestions:[],mealPlan:[]};
 for(const input of [{action:'freeform',responseMode:'conversation'},{action:'freeform'},{action:'single_meal'}]){
  const a=await account(),id=randomUUID();await tx(db=>reserve(db,a,id,'chef','h',2));
  if(usable('chef',result,input)){
   await tx(db=>commitUsableResult(db,a,id,result));
   const replay=await tx(db=>reserve(db,a,id,'chef','h',2));assert.equal(replay.fresh,false);assert.equal(replay.state,'committed');
   assert.equal((await snapshot(a)).balance,8);
  }else{
   await tx(db=>settle(db,a,id,false));assert.equal((await snapshot(a)).balance,10);
  }
  assert.equal((await snapshot(a)).reserved,0);
 }
});




test('Sandbox daily cap allows exactly 50 used credits and blocks extra spending',async()=>{
 const a=await account(300);
 assert.equal(sandboxDailyCreditLimit(a),50);
 // Six 8-credit results and a 2-credit result = 50.
 for(let i=0;i<6;i++){
  const id=randomUUID();
  await tx(db=>reserve(db,a,id,'recipe-image','quota-'+i,8));
  await ready(a,id); await tx(db=>settle(db,a,id,true));
 }
 const last=randomUUID();
 await tx(db=>reserve(db,a,last,'inventory-photo','last-two',2));
 await ready(a,last);await tx(db=>settle(db,a,last,true));
 const usage=await tx(db=>sandboxDailyCreditUsage(db,a));
 assert.deepEqual(usage,{spent:50,pending:0,remaining:0});
 await assert.rejects(tx(db=>reserve(db,a,randomUUID(),'recipe-method','over-cap',1)),
  (error:any)=>error.code==='test_daily_credit_limit'&&error.status===429);
 assert.equal((await snapshot(a)).balance,250);
});

test('Sandbox cap counts pending credits, releases failures, and handles mixed prices',async()=>{
 const a=await account(300);
 const ids=Array.from({length:6},()=>randomUUID());
 for(const [i,id] of ids.entries())await tx(db=>reserve(db,a,id,'recipe-image','pending-'+i,8));
 assert.deepEqual(await tx(db=>sandboxDailyCreditUsage(db,a)),{spent:0,pending:48,remaining:2});
 await assert.rejects(tx(db=>reserve(db,a,randomUUID(),'chef','blocked-three',3)),
  (error:any)=>error.code==='test_daily_credit_limit');
 // Supplier failure before output does not spend, and releases the quota.
 await tx(db=>settle(db,a,ids[5],false));
 assert.deepEqual(await tx(db=>sandboxDailyCreditUsage(db,a)),{spent:0,pending:40,remaining:10});
 const three=randomUUID(); await tx(db=>reserve(db,a,three,'chef','allowed-three',3));
 assert.deepEqual(await tx(db=>sandboxDailyCreditUsage(db,a)),{spent:0,pending:43,remaining:7});
});

test('replay of a completed AI request remains idempotent even after the daily cap is full',async()=>{
 const a=await account(100);
 const ids=Array.from({length:5},()=>randomUUID());
 for(const [i,id] of ids.entries()){
  await tx(db=>reserve(db,a,id,'recipe-image','idem-'+i,10));
  await ready(a,id); await tx(db=>settle(db,a,id,true));
 }
 assert.equal((await tx(db=>sandboxDailyCreditUsage(db,a)))?.remaining,0);
 const repeated=await tx(db=>reserve(db,a,ids[0],'recipe-image','idem-0',10));
 assert.equal(repeated.fresh,false);
 assert.equal(repeated.state,'committed');
 await assert.rejects(tx(db=>reserve(db,a,ids[0],'recipe-image','different-input',10)),
  (error:any)=>error.code==='request_id_reused');
});

test('UTC-day quota follows the request day and resets without resetting wallet credits',async()=>{
 const a=await account(200),id=randomUUID();
 await tx(db=>reserve(db,a,id,'recipe-image','yesterday',8));
 await ready(a,id);await tx(db=>settle(db,a,id,true));
 assert.equal((await tx(db=>sandboxDailyCreditUsage(db,a)))?.spent,8);
 // Simulate a completed request from a previous UTC day without changing balances.
 await pg.query("UPDATE billing.requests SET created_at=now()-interval '2 days' WHERE customer_id=$1 AND request_id=$2",[a.id,id]);
 assert.deepEqual(await tx(db=>sandboxDailyCreditUsage(db,a)),{spent:0,pending:0,remaining:50});
 assert.equal((await snapshot(a)).balance,192);
});

test('quota is shared across the same Apple wallet on multiple devices, but not across testers',async()=>{
 const first=await account(100),sameWallet={...first},second=await account(100);
 const id=randomUUID();
 await tx(db=>reserve(db,first,id,'recipe-image','first-device',8));
 assert.equal((await tx(db=>sandboxDailyCreditUsage(db,sameWallet)))?.pending,8);
 assert.equal((await tx(db=>sandboxDailyCreditUsage(db,second)))?.remaining,50);
 await tx(db=>settle(db,sameWallet,id,false));
 assert.equal((await tx(db=>sandboxDailyCreditUsage(db,first)))?.remaining,50);
});

test('Production wallets are never subject to the Sandbox credit cap',async()=>{
 const a=await account(100),p={...a,environment:'Production' as const};
 assert.equal(sandboxDailyCreditLimit(p),null);
 assert.equal(await tx(db=>sandboxDailyCreditUsage(db,p)),null);
 await tx(async db=>{await wallet(db,p);await event(db,p,'prod-seed',100,'apple_purchase');});
 for(let i=0;i<8;i++){
  const id=randomUUID();await tx(db=>reserve(db,p,id,'recipe-image','production-'+i,8));
  await ready(p,id);await tx(db=>settle(db,p,id,true));
 }
 assert.equal((await snapshot(p)).balance,36);
});
