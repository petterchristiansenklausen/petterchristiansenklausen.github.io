import { NextRequest,NextResponse } from 'next/server';
import { billingEnabled,database,transaction,BillingError } from '../../../../lib/billing/db';
import { authenticate,challenge,deviceLogin,canTopUp,digest } from '../../../../lib/billing/auth';
import { verifier,currentPurchase,proID } from '../../../../lib/billing/apple';
import { wallet,event,reserve,settle,applyPurchase,type Account } from '../../../../lib/billing/ledger';
import { usable } from '../../../../lib/billing/validation';
import { purchaseCredits, purchaseLedgerId } from '../../../../lib/billing/pricing';
import { POST as chef } from '../../../../lib/providers/chef/route';
import { POST as method } from '../../../../lib/providers/recipe-method/route';
import { POST as inventory } from '../../../../lib/providers/inventory-photo/route';
import { POST as image } from '../../../../lib/providers/recipe-image/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const uuid=(s:any)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
async function tariff(){return (await database().query("SELECT value FROM billing.config WHERE key='tariff'")).rows[0].value;}
async function status(a:Account){return transaction(async db=>{const w=await wallet(db,a);return {balance:w.balance,reserved:w.reserved,available:w.balance-w.reserved,environment:a.environment,accountToken:a.id,canTopUp:canTopUp(a)};});}
async function recordPurchase(a:Account,t:any){
 // Older Pro purchases may lack an appAccountToken; credit purchases never do.
 const owned = t.appAccountToken?.toLowerCase() === a.id.toLowerCase();
 const legacyPro = t.productId === proID && !t.appAccountToken &&
   !!a.appTransactionId && t.appTransactionId === a.appTransactionId;
 if(t.bundleId!=='com.pettersapps.MinMat'||t.environment!==a.environment||!a.appTransactionId||t.appTransactionId!==a.appTransactionId||(!owned&&!legacyPro))
   throw new BillingError(403,'purchase_owner_mismatch');
 const config=await tariff();
 let credits:number;
 try { credits=purchaseCredits(config,t.productId); }
 catch { throw new BillingError(400,'invalid_product'); }
 const ledgerId=purchaseLedgerId(t);
 if(!ledgerId||t.quantity!==1||
   (t.productId===proID?t.type!=='Non-Consumable':t.type!=='Consumable'))
   throw new BillingError(400,'invalid_product');
 await transaction(db=>applyPurchase(db,a,{transactionId:ledgerId,productId:t.productId,credits,revoked:!!t.revocationDate,signedDate:t.signedDate||0}));
}
async function notifications(body:any){
 let n:any,environment:'Sandbox'|'Production'='Production';
 for(const env of ['Production','Sandbox'] as const){try {n=await verifier(env).verifyAndDecodeNotification(body.signedPayload);environment=env;break;}catch{}}
 if(!n)throw new BillingError(401,'invalid_notification');
 if(n.notificationType==='TEST')return reply({ok:true});
 if(!n.data?.signedTransactionInfo)return reply({ok:true});
 const t=await verifier(environment).verifyAndDecodeTransaction(n.data.signedTransactionInfo);
 if(!t.appAccountToken)return reply({ok:true}); // Existing Pro purchases are restored through StoreKit.
 const r=await database().query('SELECT id,apple_sub,app_transaction_id FROM billing.customers WHERE id=$1',[t.appAccountToken]);
 if(!r.rows.length)throw new BillingError(503,'account_not_ready');
 // Verify latest Apple state, so notification order cannot undo a refund.
 const fresh=await currentPurchase(n.data.signedTransactionInfo,environment);
 await recordPurchase({id:r.rows[0].id,sub:r.rows[0].apple_sub||r.rows[0].app_transaction_id,environment,appTransactionId:r.rows[0].app_transaction_id},fresh);
 return reply({ok:true});
}
async function handle(req:NextRequest){
 const path=req.nextUrl.pathname.replace('/api/billing/','');
 if(path==='config'&&req.method==='GET')return reply(billingEnabled()?{enabled:true,...await tariff()}:{enabled:false});
 if(!billingEnabled())throw new BillingError(503,'billing_unavailable');
 if(req.method==='GET'){
  if(path!=='status')throw new BillingError(404,'not_found');
  return reply(await status(await authenticate(req)));
 }
 if(req.method!=='POST')throw new BillingError(405,'method_not_allowed');
 // Read once with a streaming size limit; content-length alone is untrusted.
 const reader=req.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 if(reader)while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>1500000){await reader.cancel();throw new BillingError(413,'request_too_large');}chunks.push(r.value);}
 const raw=Buffer.concat(chunks).toString('utf8');
 let b:any;try{b=JSON.parse(raw||'{}');}catch{throw new BillingError(400,'invalid_json');}
 if(path==='challenge')return reply(await challenge());
 if(path==='device-login')return reply(await deviceLogin(b));
 if(path==='notifications')return notifications(b);
 const a=await authenticate(req);
 if(path==='logout') {await database().query('DELETE FROM billing.sessions WHERE token_hash=$1',[digest(req.headers.get('authorization')!.slice(7))]);return reply({ok:true});}
 if(path==='purchase'){await recordPurchase(a,await currentPurchase(b.signedTransaction,a.environment));return reply(await status(a));}
 if(path==='claim-pro'){
  if(typeof b.signedTransaction!=='string'||b.signedTransaction.length>40000)throw new BillingError(400,'invalid_pro_proof');
  const pro=await currentPurchase(b.signedTransaction,a.environment);
  if(pro.productId!==proID||pro.revocationDate)throw new BillingError(403,'pro_required');
  await recordPurchase(a,pro);
  return reply(await status(a));
 }
 if(path==='test-topup'){
  if(!canTopUp(a))throw new BillingError(403,'test_access_denied');
  if(![10,50,100].includes(b.amount)||!uuid(b.requestID))throw new BillingError(400,'invalid_topup');
  await transaction(async db=>{
   const w=await wallet(db,a);
   const key='test:'+b.requestID;
   const old=await db.query('SELECT delta FROM billing.ledger WHERE customer_id=$1 AND environment=$2 AND event_key=$3',[a.id,a.environment,key]);
   if(old.rows.length){if(old.rows[0].delta!==b.amount)throw new BillingError(409,'request_id_reused');return;}
   const r=await db.query("SELECT COALESCE(SUM(delta),0) total FROM billing.ledger WHERE customer_id=$1 AND environment='Sandbox' AND kind='test_grant' AND created_at>=CURRENT_DATE",[a.id]);
   if(Number(r.rows[0].total)+b.amount>300||w.balance+b.amount>1000)throw new BillingError(429,'test_limit');
   await event(db,a,key,b.amount,'test_grant');
  }); return reply(await status(a));
 }
 if(path==='settle'){
  if(!uuid(b.requestID)||typeof b.accept!=='boolean')throw new BillingError(400,'invalid_settlement');
  const state=await transaction(db=>settle(db,a,b.requestID,b.accept));return reply({state,...await status(a)});
 }
 if(path.startsWith('ai/')){
  const feature=path.slice(3);const providers:Record<string,(request:NextRequest)=>Promise<Response>>={chef,'recipe-method':method,'inventory-photo':inventory,'recipe-image':image};
  if(!providers[feature])throw new BillingError(404,'unknown_feature');
  if(!uuid(b.requestID)||!b.input||typeof b.input!=='object')throw new BillingError(400,'invalid_request');
  // Sandbox has the documented beta Pro allowance. Production requires a live Apple entitlement.
  if(a.environment==='Production' || (typeof b.proTransaction==='string' && b.proTransaction.length>0)) {
   if(typeof b.proTransaction!=='string')throw new BillingError(403,'pro_required');
   const pro=await currentPurchase(b.proTransaction,a.environment);
   if(pro.productId!==proID||pro.type!=='Non-Consumable'||pro.revocationDate||!a.appTransactionId||pro.appTransactionId!==a.appTransactionId||
      !(pro.appAccountToken?.toLowerCase()===a.id.toLowerCase() ||
        (!pro.appAccountToken && pro.appTransactionId===a.appTransactionId)))
      throw new BillingError(403,'pro_required');
   // Stable originalTransactionId makes the Pro starter grant idempotent on restore.
   await recordPurchase(a,pro);
  }
  const config=await tariff(),cost=config.costs[feature];
  if(b.tariffVersion!==config.version)throw new BillingError(409,'tariff_changed');
  if(!Number.isSafeInteger(cost)||cost<=0)throw new BillingError(503,'tariff_invalid');
  const r=await transaction(db=>reserve(db,a,b.requestID,feature,digest(JSON.stringify(b.input)),cost));
  if(!r.fresh){
   if((r.state==='ready'||r.state==='committed')&&r.result)return reply({requestID:b.requestID,result:r.result});
   throw new BillingError(409,r.state==='reserved'?'request_pending':'request_expired');
  }
  try{
   const internal=new NextRequest(new URL('/api/'+feature,req.url),{method:'POST',headers:{'Content-Type':'application/json','x-minmat-client':process.env.MIN_MAT_CLIENT_TOKEN||'','x-minmat-installation':a.id},body:JSON.stringify(b.input)});
   const response=await providers[feature](internal);
   const result=await response.json();
   if(!response.ok||!usable(feature,result))throw new BillingError(502,'ai_failed_no_charge');
   const ready=await database().query("UPDATE billing.requests SET state='ready',result=$4 WHERE customer_id=$1 AND environment=$2 AND request_id=$3 AND state='reserved' AND expires_at>now() RETURNING request_id",[a.id,a.environment,b.requestID,JSON.stringify(result)]);
   if(!ready.rows.length)throw new BillingError(409,'request_expired');
   return reply({requestID:b.requestID,result});
  }catch(e){await transaction(db=>settle(db,a,b.requestID,false));throw e;}
 }
 throw new BillingError(404,'not_found');
}
async function safe(req:NextRequest){try{return await handle(req);}catch(e){if(e instanceof BillingError)return reply({error:e.code},e.status);console.warn('min_mat_billing_failed');return reply({error:'billing_unavailable'},503);}}
export const GET=safe;
export const POST=safe;
