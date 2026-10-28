import { Environment, SignedDataVerifier, AppStoreServerAPIClient } from '@apple/app-store-server-library';
import { BillingError } from './db';
export const bundleID='com.pettersapps.MinMat';
export const proID=bundleID+'.pro';
export function verifier(env:'Sandbox'|'Production') {
 const roots=JSON.parse(process.env.MIN_MAT_APPLE_ROOTS_BASE64||'[]');
 const appId=Number(process.env.MIN_MAT_APPLE_APP_ID);
 if(!Array.isArray(roots)||!roots.length||!Number.isSafeInteger(appId)||appId<=0)throw new BillingError(503,'apple_verification_unconfigured');
 return new SignedDataVerifier(roots.map((x:string)=>Buffer.from(x,'base64')),true,env==='Sandbox'?Environment.SANDBOX:Environment.PRODUCTION,bundleID,appId);
}
export async function appEnvironment(jws:string):Promise<{environment:'Sandbox'|'Production',appTransactionId:string,deviceVerification:string,deviceVerificationNonce:string}> {
 // Never trust an unverified environment header or receipt filename.
 for(const env of ['Production','Sandbox'] as const){
  try {const t=await verifier(env).verifyAndDecodeAppTransaction(jws); if(t.receiptType===env && t.appTransactionId && t.deviceVerification && t.deviceVerificationNonce) return {environment:env,appTransactionId:t.appTransactionId,deviceVerification:t.deviceVerification,deviceVerificationNonce:t.deviceVerificationNonce};} catch{}
 }
 throw new BillingError(401,'invalid_app_transaction');
}
export async function currentPurchase(jws:string,env:'Sandbox'|'Production') {
 const v=verifier(env), supplied=await v.verifyAndDecodeTransaction(jws);
 if(!supplied.transactionId)throw new BillingError(400,'missing_transaction');
 const key=process.env.MIN_MAT_APPLE_IAP_KEY, keyId=process.env.MIN_MAT_APPLE_IAP_KEY_ID, issuer=process.env.MIN_MAT_APPLE_ISSUER_ID;
 if(!key||!keyId||!issuer)throw new BillingError(503,'apple_api_unconfigured');
 const api=new AppStoreServerAPIClient(key,keyId,issuer,bundleID,env==='Sandbox'?Environment.SANDBOX:Environment.PRODUCTION);
 const fresh=await api.getTransactionInfo(supplied.transactionId);
 if(!fresh.signedTransactionInfo)throw new BillingError(502,'apple_transaction_unavailable');
 return v.verifyAndDecodeTransaction(fresh.signedTransactionInfo);
}
