import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
export type DB = Pick<PoolClient, 'query'>;
let pool: Pool | undefined;
export function billingEnabled() { return process.env.MIN_MAT_BILLING_ENABLED === 'true'; }
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
export class BillingError extends Error { constructor(public status:number, public code:string){super(code);} }
