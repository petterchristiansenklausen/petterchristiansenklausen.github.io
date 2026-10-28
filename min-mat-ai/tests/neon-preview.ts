// Optional live integration test. Run ONLY against an isolated billing preview database.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {database,transaction} from '../lib/billing/db';
import {wallet,event,reserve,settle,type Account} from '../lib/billing/ledger';
async function main(){
 if(!process.env.MIN_MAT_BILLING_DATABASE_URL?.includes('min_mat_billing_preview'))throw Error('preview database required');
 const a:Account={id:randomUUID(),sub:'integration-test:'+randomUUID(),environment:'Sandbox'};
 const role=await database().query('SELECT current_user,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user');
 assert.equal(role.rows[0].current_user,'min_mat_billing_app');
 assert.equal(role.rows[0].rolcreatedb,false);assert.equal(role.rows[0].rolcreaterole,false);assert.equal(role.rows[0].rolbypassrls,false);
 await database().query('INSERT INTO billing.customers(id,apple_sub) VALUES($1,$2)',[a.id,a.sub]);
 await transaction(async db=>{await wallet(db,a);await event(db,a,'integration-seed',3,'test_grant');});
 const ids=[randomUUID(),randomUUID()];
 const result=await Promise.allSettled(ids.map(id=>transaction(db=>reserve(db,a,id,'chef',id,2))));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 const w=await transaction(db=>wallet(db,a));assert.equal(w.reserved,2);assert.equal(w.balance,3);
 const winner=ids[result.findIndex(r=>r.status==='fulfilled')];
 await transaction(db=>settle(db,a,winner,false));assert.equal((await transaction(db=>wallet(db,a))).reserved,0);
 await assert.rejects(database().query("UPDATE billing.config SET value=value WHERE key='tariff'"));
 await assert.rejects(database().query("UPDATE billing.ledger SET delta=100 WHERE customer_id=$1",[a.id]));
 console.log('PASS: Neon concurrent reservations, rollback, runtime privileges, immutable ledger, separate database.');
}
main().catch((e)=>{console.error('Live preview test failed', {code:e.code,name:e.name});process.exitCode=1;}).finally(()=>database().end());
