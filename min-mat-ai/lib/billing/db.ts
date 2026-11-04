import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
export type DB = Pick<PoolClient, 'query'>;
let pool: Pool | undefined;
export type BillingEnvironment = 'Sandbox' | 'Production';
/** An explicit mode is mandatory for Production; never infer it from a client. */
export function billingMode(): BillingEnvironment | null {
 const mode = process.env.MIN_MAT_BILLING_ENVIRONMENT;
 if (process.env.VERCEL_ENV === 'production') {
  return mode === 'Production' ? 'Production' : null;
 }
 if (process.env.VERCEL_ENV === 'preview') {
  // An accidental Production secret/config must never switch a Preview to live billing.
  return mode === 'Production' ? null : 'Sandbox';
 }
 return mode === 'Production' || mode === 'Sandbox' ? mode : 'Sandbox';
}
export function billingEnabled() {
 if (process.env.MIN_MAT_BILLING_ENABLED !== 'true' || !billingMode()) return false;
 if (process.env.VERCEL_ENV === 'production') {
  // No implicit activation: production database, Apple keys, notification setup,
  // device-integrity review and a documented release decision are prerequisites.
  return process.env.MIN_MAT_BILLING_PRODUCTION_APPROVED === 'true' &&
   process.env.MIN_MAT_BILLING_ISOLATED_DB_ACK === 'true' &&
   !!process.env.MIN_MAT_BILLING_DATABASE_URL;
 }
 return true;
}
export function requireBillingEnvironment(environment: BillingEnvironment) {
 if (billingMode() !== environment) throw new BillingError(403, 'billing_environment_mismatch');
}
export function database() {
 if (!billingEnabled() || !process.env.MIN_MAT_BILLING_DATABASE_URL) throw new Error('billing_unavailable');
 if(!pool){ pool=new Pool({ connectionString: process.env.MIN_MAT_BILLING_DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 }); attachDatabasePool(pool); }
 return pool;
}
export async function transaction<T>(work:(db:DB)=>Promise<T>):Promise<T> {
 const db=await database().connect();
 try { await db.query('BEGIN'); const value=await work(db); await db.query('COMMIT'); return value; }
 catch(e){ await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
export class BillingError extends Error { constructor(public status:number, public code:string, public category?:string){super(code);} }
