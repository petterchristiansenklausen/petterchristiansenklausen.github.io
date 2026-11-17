import { test } from 'node:test';
import assert from 'node:assert/strict';
import {billingMode,billingEnabled,requireBillingEnvironment} from '../lib/billing/db';

// All variables are restored so other suites do not inherit a Production mode.
test('billing mode fails closed for live deployments and preserves isolated Preview',()=>{
 const keys=['VERCEL_ENV','MIN_MAT_BILLING_ENVIRONMENT','MIN_MAT_BILLING_ENABLED','MIN_MAT_BILLING_PRODUCTION_APPROVED','MIN_MAT_BILLING_ISOLATED_DB_ACK','MIN_MAT_BILLING_DATABASE_URL'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.VERCEL_ENV='production';process.env.MIN_MAT_BILLING_ENABLED='true';
  delete process.env.MIN_MAT_BILLING_ENVIRONMENT;
  assert.equal(billingMode(),null);assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_ENVIRONMENT='Production';
  assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_PRODUCTION_APPROVED='true';
  process.env.MIN_MAT_BILLING_ISOLATED_DB_ACK='true';
  process.env.MIN_MAT_BILLING_DATABASE_URL='postgresql://example';
  assert.equal(billingEnabled(),true);
  assert.throws(()=>requireBillingEnvironment('Sandbox'));
  assert.doesNotThrow(()=>requireBillingEnvironment('Production'));
  process.env.VERCEL_ENV='preview';
  assert.equal(billingMode(),null);assert.equal(billingEnabled(),false);
  process.env.MIN_MAT_BILLING_ENVIRONMENT='Sandbox';
  assert.equal(billingMode(),'Sandbox');assert.equal(billingEnabled(),true);
  assert.throws(()=>requireBillingEnvironment('Production'));
 } finally { for(const k of keys) {const v=saved[k];if(v===undefined)delete process.env[k];else process.env[k]=v;} }
});
