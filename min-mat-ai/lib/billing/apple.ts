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
  try {const t=await verifier(env).verifyAndDecodeAppTransaction(jws); if(t.receiptType===env && t.appTransactionId && t.deviceVerification && t.deviceVerificationNonce)
     return {environment:env,appTransactionId:t.appTransactionId,deviceVerification:t.deviceVerification,deviceVerificationNonce:t.deviceVerificationNonce};} catch{}
 }
 throw new BillingError(401,'invalid_app_transaction');
}
// Preview-only, non-sensitive purchase diagnostics. Never log signed transactions,
// Apple credentials, wallet IDs, error messages, stacks or provider response bodies.
function logPurchaseStage(stage:string,error:unknown,correlationID?:string) {
 if(process.env.VERCEL_ENV!=='preview')return;
 const detail=error!==null&&typeof error==='object'?error as Record<string,unknown>:{};
 const rawStatus=detail.httpStatusCode??detail.statusCode??detail.status;
 const rawAppleCode=detail.apiError??detail.apiErrorCode;
 const providerHttpStatus=typeof rawStatus==='number'&&Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:null;
 const providerErrorCode=typeof rawAppleCode==='number'&&Number.isInteger(rawAppleCode)&&rawAppleCode>=0&&rawAppleCode<=999999999?rawAppleCode:null;
 const errorKind=error instanceof BillingError?'billing_error':
  error instanceof TypeError?'type_error':
  error instanceof SyntaxError?'syntax_error':
  error instanceof Error&&error.name==='APIException'?'apple_api_exception':
  error instanceof Error&&error.name==='VerificationException'?'apple_verification_exception':'other_exception';
 const requestID=correlationID&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationID)?correlationID:null;
 console.warn('min_mat_purchase_diagnostic',{
  requestID,stage,errorKind,providerHttpStatus,providerErrorCode,
  appErrorCode:error instanceof BillingError?error.code:null
 });
}
export async function currentPurchase(jws:string,env:'Sandbox'|'Production',correlationID?:string) {
 let stage='signed_transaction_verification';
 try {
  const v=verifier(env), supplied=await v.verifyAndDecodeTransaction(jws);
  if(!supplied.transactionId)throw new BillingError(400,'missing_transaction');
  stage='apple_api_configuration';
  const key=process.env.MIN_MAT_APPLE_IAP_KEY, keyId=process.env.MIN_MAT_APPLE_IAP_KEY_ID, issuer=process.env.MIN_MAT_APPLE_ISSUER_ID;
  if(!key||!keyId||!issuer)throw new BillingError(503,'apple_api_unconfigured');
  const api=new AppStoreServerAPIClient(key,keyId,issuer,bundleID,env==='Sandbox'?Environment.SANDBOX:Environment.PRODUCTION);
  stage='apple_api_lookup';
  const fresh=await api.getTransactionInfo(supplied.transactionId);
  if(!fresh.signedTransactionInfo)throw new BillingError(502,'apple_transaction_unavailable');
  stage='fresh_transaction_verification';
  return await v.verifyAndDecodeTransaction(fresh.signedTransactionInfo);
 }catch(error){
  logPurchaseStage(stage,error,correlationID);
  throw error;
 }
}
