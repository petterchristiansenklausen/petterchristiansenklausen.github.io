import {test} from 'node:test';import assert from 'node:assert/strict';
import {billingMode,billingEnabled,requireBillingEnvironment} from '../lib/billing/db';
test('billing environment rejects Sandbox in Production and closes when disabled',()=>{
 const keys=['VERCEL_ENV','MIN_MAT_BILLING_ENVIRONMENT','MIN_MAT_BILLING_ENABLED','MIN_MAT_BILLING_PRODUCTION_APPROVED','MIN_MAT_BILLING_ISOLATED_DB_ACK','MIN_MAT_BILLING_DATABASE_URL'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.VERCEL_ENV='production';process.env.MIN_MAT_BILLING_ENABLED='true';
  delete process.env.MIN_MAT_BILLING_ENVIRONMENT;
  assert.equal(billingMode(),null);assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_ENVIRONMENT='Production';assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_PRODUCTION_APPROVED='true';
  process.env.MIN_MAT_BILLING_ISOLATED_DB_ACK='true';
  process.env.MIN_MAT_BILLING_DATABASE_URL='postgresql://example';
  assert.equal(billingEnabled(),true);assert.throws(()=>requireBillingEnvironment('Sandbox'));
  process.env.VERCEL_ENV='preview';assert.equal(billingMode(),null);assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_ENVIRONMENT='Sandbox';assert.equal(billingMode(),'Sandbox');assert.equal(billingEnabled(),true);
  assert.throws(()=>requireBillingEnvironment('Production'));
 }finally {for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
