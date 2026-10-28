export function isOpenProductionGuard(row:unknown):boolean{
 if(!row||typeof row!=='object')return false;
 const r=row as {database_name?:unknown,deployment_guard?:unknown};
 if(!r.deployment_guard||typeof r.deployment_guard!=='object')return false;
 const g=r.deployment_guard as {environment?:unknown,database?:unknown,schema?:unknown,allowProduction?:unknown};
 return r.database_name==='min_mat_billing_production'&&g.database===r.database_name&&
  g.environment==='Production'&&g.schema===10&&g.allowProduction===true;
}