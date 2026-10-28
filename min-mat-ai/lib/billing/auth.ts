import { randomUUID,randomBytes,createHash,createPublicKey,verify,timingSafeEqual } from 'node:crypto';
import { database,transaction,BillingError,requireBillingEnvironment } from './db';
import { appEnvironment,bundleID } from './apple';
import type { Account } from './ledger';
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
/**
 * Preview-only passwordless billing session. The AppTransaction JWS is verified
 * by Apple's certificate chain and additionally checked for StoreKit's
 * per-device SHA-384 proof. A P-256 key signs a one-use challenge.
 *
 * ATTENTION: This is not App Attest; Production payment rollout remains blocked
 * until App Attest / device revocation / reconciliation are implemented.
 */
export function verifyDeviceProof(apple:{deviceVerification:string,deviceVerificationNonce:string},body:any,nonce:string):void{
 const deviceID=body.deviceVerificationID;
 if(typeof deviceID!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(deviceID))throw new BillingError(401,'invalid_device');
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(apple.deviceVerificationNonce))throw new BillingError(401,'invalid_device');
 const actual=Buffer.from(apple.deviceVerification,'base64');
 const expected=createHash('sha384').update(apple.deviceVerificationNonce.toLowerCase()+deviceID).digest();
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new BillingError(401,'device_mismatch');
 if(typeof body.devicePublicKey!=='string'||typeof body.deviceSignature!=='string'||body.devicePublicKey.length>200||body.deviceSignature.length>200)
  throw new BillingError(401,'invalid_device_signature');
 const raw=Buffer.from(body.devicePublicKey,'base64');
 if(raw.length!==65||raw[0]!==4)throw new BillingError(401,'invalid_device_public_key');
 const publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});
 const signature=Buffer.from(body.deviceSignature,'base64');
 if(signature.length<68||signature.length>80||!verify('sha256',Buffer.from(body.challengeID+':'+nonce),publicKey,signature))
  throw new BillingError(401,'invalid_device_signature');
}
export async function deviceLogin(body:any){
 if(typeof body.appTransaction!=='string'||body.appTransaction.length>40000||typeof body.challengeID!=='string')throw new BillingError(400,'invalid_app_transaction');
 const apple=await appEnvironment(body.appTransaction);
 requireBillingEnvironment(apple.environment);
 return transaction(async db=>{
  const {rows}=await db.query('DELETE FROM billing.challenges WHERE id=$1 AND expires_at>now() RETURNING nonce',[body.challengeID]);
  if(!rows.length)throw new BillingError(401,'nonce_invalid');
  verifyDeviceProof(apple,body,rows[0].nonce);
  const c=await db.query(`
   INSERT INTO billing.customers(id,apple_sub,app_environment,app_transaction_id)
   VALUES($1,NULL,$2,$3)
   ON CONFLICT(app_environment,app_transaction_id) WHERE app_transaction_id IS NOT NULL
   DO UPDATE SET app_transaction_id=EXCLUDED.app_transaction_id RETURNING id
  `,[randomUUID(),apple.environment,apple.appTransactionId]);
  const token=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO billing.sessions VALUES($1,$2,$3,$4,now()+interval '12 hours')",[digest(token),c.rows[0].id,apple.environment,apple.appTransactionId]);
  return {token,accountToken:c.rows[0].id,environment:apple.environment};
 });
}
export async function authenticate(req:Request):Promise<Account>{
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||token.length>200)throw new BillingError(401,'sign_in_required');
 const r=await database().query('SELECT c.id,c.apple_sub,s.environment,s.app_transaction_id FROM billing.sessions s JOIN billing.customers c ON c.id=s.customer_id WHERE s.token_hash=$1 AND s.expires_at>now()',[digest(token)]);
 if(!r.rows.length)throw new BillingError(401,'sign_in_required');
 requireBillingEnvironment(r.rows[0].environment);
 return {id:r.rows[0].id,sub:r.rows[0].apple_sub||r.rows[0].app_transaction_id,environment:r.rows[0].environment,appTransactionId:r.rows[0].app_transaction_id};
}
// All verified Sandbox/TestFlight identities can grant limited TEST credits.
// Apple ID and AppTransaction environment are checked by the login handler.
// App Store Production sessions can never request test grants.
export function canTopUp(a:Account){
 return a.environment==='Sandbox' && process.env.MIN_MAT_TEST_TOPUP_ENABLED==='true';
}
