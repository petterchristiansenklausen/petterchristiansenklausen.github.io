import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { isOpenProductionGuard } from './production-guard';
export type DB=Pick<PoolClient,'query'>;
export type BillingEnvironment='Sandbox'|'Production';
let pool:Pool|undefined;
export function billingMode():BillingEnvironment|null {
 const mode=process.env.MIN_MAT_BILLING_ENVIRONMENT;
 if(process.env.VERCEL_ENV==='production') return mode==='Production'?'Production':null;
 if(process.env.VERCEL_ENV==='preview') return mode==='Production'?null:'Sandbox';
 return mode==='Production'||mode==='Sandbox'?mode:'Sandbox';
}
export function billingEnabled(){
 if(process.env.MIN_MAT_BILLING_ENABLED!=='true'||!billingMode())return false;
 if(process.env.VERCEL_ENV==='production')return process.env.MIN_MAT_BILLING_PRODUCTION_APPROVED==='true' &&
   process.env.MIN_MAT_BILLING_ISOLATED_DB_ACK==='true' && !!process.env.MIN_MAT_BILLING_DATABASE_URL;
 return true;
}
export function requireBillingEnvironment(environment:BillingEnvironment){
 if(billingMode()!==environment)throw new BillingError(403,'billing_environment_mismatch');
}
export function database(){
 if(!billingEnabled()||!process.env.MIN_MAT_BILLING_DATABASE_URL)throw new BillingError(503,'billing_unavailable');
 if(!pool){pool=new Pool({connectionString:process.env.MIN_MAT_BILLING_DATABASE_URL,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:5000});attachDatabasePool(pool);}
 return pool;
}
export async function requireProductionIsolation():Promise<void>{
 if(process.env.VERCEL_ENV!=='production')return;
 if(!billingEnabled())throw new BillingError(503,'billing_unavailable');
 const {rows}=await database().query("SELECT current_database() AS database_name, value AS deployment_guard FROM billing.config WHERE key='deployment_guard'");
 if(rows.length!==1||!isOpenProductionGuard(rows[0]))throw new BillingError(503,'billing_unavailable');
}
export async function transaction<T>(work:(db:DB)=>Promise<T>):Promise<T>{
 const db=await database().connect();
 try{await db.query('BEGIN');const value=await work(db);await db.query('COMMIT');return value;}
 catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export class BillingError extends Error{constructor(public status:number,public code:string){super(code);}}
