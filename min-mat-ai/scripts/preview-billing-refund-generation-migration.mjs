// One-off Sandbox ONLY schema migration: add missing refund_generation column.
// Run in Vercel build on the explicitly scoped feature branch, then remove the hook.
// Never print credentials, customer identifiers, purchase data or SQL error messages.
import { Pool } from 'pg';

const targetBranch='feature/min-mat-recipe-scan-build124';
const isPreview=process.env.VERCEL_ENV==='preview';
const isBranch=process.env.VERCEL_GIT_COMMIT_REF===targetBranch;
const isSandbox=process.env.MIN_MAT_BILLING_ENVIRONMENT!=='Production';
if(!isPreview || !isBranch || !isSandbox){
 console.info('min_mat_schema_migration',{status:'skipped_wrong_environment'});
 process.exit(0);
}
const connectionString=process.env.MIN_MAT_BILLING_DATABASE_URL;
if(!connectionString){
 console.warn('min_mat_schema_migration',{status:'missing_preview_database_configuration'});
 process.exit(1);
}
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
const client=await pool.connect();
try{
 await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(hashtext('min_mat_sandbox_refund_generation_20261117'))");
 const before=await client.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema='billing' AND table_name='purchases'"
 );
 const prior=new Set(before.rows.map(r=>r.column_name));
 const expected=['environment','transaction_id','customer_id','product_id','credits','revoked','signed_at'];
 if(expected.some(c=>!prior.has(c))){
  throw new Error('unsupported_preview_billing_schema');
 }
 if(!prior.has('refund_generation')){
  await client.query('ALTER TABLE billing.purchases ADD COLUMN refund_generation integer NOT NULL DEFAULT 0');
  // Preserve correct refund semantics for purchases already revoked in the older schema.
  await client.query("UPDATE billing.purchases SET refund_generation=1 WHERE revoked=true AND refund_generation=0");
 }
 const constraints=await client.query(
  "SELECT 1 FROM pg_constraint WHERE conrelid='billing.purchases'::regclass AND conname='purchases_refund_generation_check'"
 );
 if(constraints.rowCount===0){
  await client.query('ALTER TABLE billing.purchases ADD CONSTRAINT purchases_refund_generation_check CHECK (refund_generation>=0)');
 }
 await client.query('COMMIT');
 console.info('min_mat_schema_migration',{status:prior.has('refund_generation')?'already_current':'applied',column:'refund_generation',scope:'preview_sandbox_only'});
}catch(error){
 try{await client.query('ROLLBACK');}catch{}
 const sqlState=error&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:null;
 console.error('min_mat_schema_migration',{status:'failed',sqlState});
 process.exitCode=1;
}finally{
 client.release();
 await pool.end();
}
