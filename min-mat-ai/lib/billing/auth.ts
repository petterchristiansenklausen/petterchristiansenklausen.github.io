import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { createRemoteJWKSet,jwtVerify } from 'jose';
import { database,transaction,BillingError } from './db';
import { appEnvironment,bundleID } from './apple';
import type { Account } from './ledger';
const keys=createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function challenge(){
 const id=randomUUID(),nonce=randomBytes(32).toString('hex');
 await transaction(async db=>{
  await db.query('DELETE FROM billing.challenges WHERE expires_at<=now()');
  const r=await db.query("INSERT INTO billing.daily_limits(scope,attempts) VALUES('login_challenge',1) ON CONFLICT(scope,day) DO UPDATE SET attempts=billing.daily_limits.attempts+1 RETURNING attempts");
  if(r.rows[0].attempts>1000)throw new BillingError(429,'daily_limit');
  await db.query("INSERT INTO billing.challenges VALUES($1,$2,now()+interval '5 minutes')",[id,nonce]);
 });
 return {id,nonce};
}
export async function login(body:any){
 const {payload}=await jwtVerify(body.identityToken,keys,{issuer:'https://appleid.apple.com',audience:bundleID,algorithms:['RS256'],maxTokenAge:'5m'});
 if(!payload.sub||typeof payload.nonce!=='string')throw new BillingError(401,'invalid_identity');
 const {environment,appTransactionId}=await appEnvironment(body.appTransaction);
 return transaction(async db=>{
  const r=await db.query('DELETE FROM billing.challenges WHERE id=$1 AND nonce=$2 AND expires_at>now() RETURNING id',[body.challengeID,payload.nonce]);
  if(!r.rows.length)throw new BillingError(401,'nonce_invalid');
  const c=await db.query('INSERT INTO billing.customers(id,apple_sub) VALUES($1,$2) ON CONFLICT(apple_sub) DO UPDATE SET apple_sub=EXCLUDED.apple_sub RETURNING id',[randomUUID(),payload.sub]);
  const token=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO billing.sessions VALUES($1,$2,$3,$4,now()+interval '12 hours')",[digest(token),c.rows[0].id,environment,appTransactionId]);
  return {token,accountToken:c.rows[0].id,environment};
 });
}
export async function authenticate(req:Request):Promise<Account>{
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||token.length>200)throw new BillingError(401,'sign_in_required');
 const r=await database().query('SELECT c.id,c.apple_sub,s.environment,s.app_transaction_id FROM billing.sessions s JOIN billing.customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>now()',[digest(token)]);
 if(!r.rows.length)throw new BillingError(401,'sign_in_required');
 return {id:r.rows[0].id,sub:r.rows[0].apple_sub,environment:r.rows[0].environment,appTransactionId:r.rows[0].app_transaction_id};
}
export function canTopUp(a:Account){
 return a.environment==='Sandbox'&&process.env.MIN_MAT_TEST_TOPUP_ENABLED==='true'&&
 (process.env.MIN_MAT_TESTER_SUBJECTS||'').split(',').map(x=>x.trim()).includes(a.sub);
}
