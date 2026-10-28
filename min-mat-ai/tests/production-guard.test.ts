import {test} from 'node:test';import assert from 'node:assert/strict';
import {isOpenProductionGuard} from '../lib/billing/production-guard';
const base={database_name:'min_mat_billing_production',deployment_guard:{environment:'Production',database:'min_mat_billing_production',schema:10,allowProduction:true}};
test('production database guard rejects every incomplete case',()=>{
 assert.equal(isOpenProductionGuard(base),true);
 for(const bad of [null,{}, {...base,database_name:'preview'},
  {...base,deployment_guard:{...base.deployment_guard,allowProduction:false}},
  {...base,deployment_guard:{...base.deployment_guard,environment:'Sandbox'}},
  {...base,deployment_guard:{...base.deployment_guard,schema:9}}])
  assert.equal(isOpenProductionGuard(bad),false,JSON.stringify(bad));
});
