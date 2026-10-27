import type { DB } from './db';
import { BillingError } from './db';
export type Account={id:string,environment:'Sandbox'|'Production',sub:string,appTransactionId?:string};
export async function wallet(db:DB,a:Account) {
 await db.query('INSERT INTO billing.wallets(customer_id,environment) VALUES($1,$2) ON CONFLICT DO NOTHING',[a.id,a.environment]);
 const {rows}=await db.query('SELECT * FROM billing.wallets WHERE customer_id=$1 AND environment=$2 FOR UPDATE',[a.id,a.environment]);
 // A crash, timeout, or lost acknowledgement can never keep a reservation indefinitely.
 const expired=await db.query("UPDATE billing.requests SET state='released',result=NULL WHERE customer_id=$1 AND environment=$2 AND state IN ('reserved','ready') AND expires_at<=now() RETURNING request_id,cost",[a.id,a.environment]);
 let released=0;
 for(const r of expired.rows){released+=r.cost; await event(db,a,'expire:'+r.request_id,0,'release');}
 if(released)await db.query('UPDATE billing.wallets SET reserved=reserved-$3 WHERE customer_id=$1 AND environment=$2',[a.id,a.environment,released]);
 await db.query("UPDATE billing.requests SET result=NULL WHERE customer_id=$1 AND environment=$2 AND expires_at<=now() AND result IS NOT NULL",[a.id,a.environment]);
 return {...rows[0],reserved:rows[0].reserved-released};
}
export async function event(db:DB,a:Account,key:string,delta:number,kind:string){
 const r=await db.query('INSERT INTO billing.ledger(customer_id,environment,event_key,delta,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[a.id,a.environment,key,delta,kind]);
 if(r.rows.length && delta)await db.query('UPDATE billing.wallets SET balance=balance+$3 WHERE customer_id=$1 AND environment=$2',[a.id,a.environment,delta]);
 return r.rows.length>0;
}
export async function reserve(db:DB,a:Account,id:string,feature:string,hash:string,cost:number){
 const w=await wallet(db,a);
 const old=await db.query('SELECT * FROM billing.requests WHERE customer_id=$1 AND environment=$2 AND request_id=$3',[a.id,a.environment,id]);
 if(old.rows[0]) {
  if(old.rows[0].input_hash!==hash || old.rows[0].feature!==feature)throw new BillingError(409,'request_id_reused');
  return {fresh:false,...old.rows[0]};
 }
 if(w.balance-w.reserved<cost)throw new BillingError(402,'insufficient_credits');
 // Durable limits include failed/refunded attempts, and a global supplier-spend ceiling.
 for(const [scope,limit] of [['customer:'+a.id,30],['global',Number(process.env.MIN_MAT_AI_DAILY_LIMIT||200)]] as const){
  const r=await db.query('INSERT INTO billing.daily_limits(scope,attempts) VALUES($1,1) ON CONFLICT(scope,day) DO UPDATE SET attempts=billing.daily_limits.attempts+1 RETURNING attempts',[scope]);
  if(r.rows[0].attempts>limit)throw new BillingError(429,'daily_limit');
 }
 await db.query('UPDATE billing.wallets SET reserved=reserved+$3 WHERE customer_id=$1 AND environment=$2',[a.id,a.environment,cost]);
 await db.query("INSERT INTO billing.requests(customer_id,environment,request_id,feature,input_hash,cost,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,'reserved',now()+interval '5 minutes')",[a.id,a.environment,id,feature,hash,cost]);
 await event(db,a,'reserve:'+id,0,'reserve');
 return {fresh:true,state:'reserved',result:null};
}
export async function settle(db:DB,a:Account,id:string,accept:boolean){
 await wallet(db,a);
 const {rows}=await db.query('SELECT * FROM billing.requests WHERE customer_id=$1 AND environment=$2 AND request_id=$3',[a.id,a.environment,id]);
 const r=rows[0]; if(!r)throw new BillingError(404,'request_missing');
 if(r.state==='released'||r.state==='committed')return r.state;
 // A verified usable result cannot be refunded by a client-controlled "accept:false".
 // Only a genuinely failed provider call in 'reserved' state may release credits.
 if(!accept&&r.state==='ready')throw new BillingError(409,'result_already_available');
 if(accept&&r.state!=='ready')throw new BillingError(409,'result_not_ready');
 const state=accept?'committed':'released';
 await event(db,a,(accept?'spend:':'release:')+id,accept?-r.cost:0,state);
 await db.query('UPDATE billing.wallets SET reserved=reserved-$3 WHERE customer_id=$1 AND environment=$2',[a.id,a.environment,r.cost]);
 await db.query('UPDATE billing.requests SET state=$4,result=CASE WHEN $5 THEN result ELSE NULL END WHERE customer_id=$1 AND environment=$2 AND request_id=$3',[a.id,a.environment,id,state,accept]);
 return state;
}
export async function applyPurchase(db:DB,a:Account,t:{transactionId:string,productId:string,credits:number,revoked:boolean,signedDate:number}){
 await wallet(db,a);
 const prior=await db.query('SELECT * FROM billing.purchases WHERE environment=$1 AND transaction_id=$2 FOR UPDATE',[a.environment,t.transactionId]);
 const p=prior.rows[0];
 if(p&&p.customer_id!==a.id)throw new BillingError(409,'purchase_owner_mismatch');
 if(p) {
  // Refunds are terminal here. A stale, valid JWS cannot re-grant refunded credits.
  if(t.revoked&&!p.revoked){
   await db.query('UPDATE billing.purchases SET revoked=true,signed_at=GREATEST(signed_at,$3) WHERE environment=$1 AND transaction_id=$2',[a.environment,t.transactionId,t.signedDate]);
   await event(db,a,'refund:'+t.transactionId,-p.credits,'apple_refund');
  }
  return;
 }
 await db.query('INSERT INTO billing.purchases(environment,transaction_id,customer_id,product_id,credits,revoked,signed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[a.environment,t.transactionId,a.id,t.productId,t.credits,t.revoked,t.signedDate]);
 if(!t.revoked)await event(db,a,'purchase:'+t.transactionId,t.credits,'apple_purchase');
}

/**
 * The server, not the iPhone, is authoritative for a successful AI charge.
 * Store the validated result and book the debit in ONE database transaction.
 * This closes the "receive valid response then settle(false)" free-AI exploit.
 * The response remains retrievable by the same requestID for 24 hours, in
 * case the HTTP response is lost. Failure before committing rolls back.
 */
export async function commitUsableResult(db:DB,a:Account,id:string,result:unknown){
 await wallet(db,a); // Wallet row lock serializes commits/refunds for this user.
 const updated=await db.query(
  "UPDATE billing.requests SET state='ready', result=$4::jsonb, expires_at=now()+interval '24 hours' WHERE customer_id=$1 AND environment=$2 AND request_id=$3 AND state='reserved' AND expires_at>now() RETURNING request_id",
  [a.id,a.environment,id,JSON.stringify(result)]
 );
 if(updated.rows.length!==1)throw new BillingError(409,'request_expired');
 const state=await settle(db,a,id,true);
 if(state!=='committed')throw new BillingError(500,'settlement_failed');
 return state;
}
