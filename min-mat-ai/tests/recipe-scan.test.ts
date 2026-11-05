import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecipeScan } from '../lib/providers/recipe-scan/validation';
import { usable } from '../lib/billing/validation';

test('valid Norwegian handwritten recipe is billable and preserves original dialect',()=>{
 const v={title:'Sjokoladeboller',ingredients:['1 pk delfiafett (250 g)','2 egg','3 ss sterk kaffe'],steps:['Smelt delfiafett og sjokolade','Avkjøl og rør inn kaffien'],rawText:'Sjokoladeboller\n1 pk delfiafett (250 g)\n2 egg\n3 ss sterk kaffe\nSmelt delfiafett og sjokolade\nAvkjøl og rør inn kaffien',uncertainties:['Side 1: er dette delfiafett?']};
 assert.deepEqual(cleanRecipeScan(v),v);assert.equal(usable('recipe-scan',v),true);
});
test('empty or missing ingredients/steps and nonsense cannot incur credit charge',()=>{
 for(const v of [{}, {title:'Kake',ingredients:[],steps:['Visp'],rawText:'abcdefghijklmnopqrstuvwxyz'}, {title:'Kake',ingredients:['2 egg'],steps:[],rawText:'abcdefghijklmnopqrstuvwxyz'}, {title:'Kake',ingredients:['2 egg'],steps:['Rør'],rawText:'kort'}, {title:'Kake',ingredients:[2],steps:[3],rawText:'abcdefghijklmnopqrstuvwxyz'}]) {
  assert.equal(usable('recipe-scan',v),false);
 }
});
test('bounds and sanitizes generated text; no arbitrary objects forwarded',()=>{
 const v=cleanRecipeScan({title:'  Kake  ',ingredients:[' 3 kopper sukker '],steps:[' Bland varsamt '],rawText:'Kake med gamle norske måleeiningar 3 kopper sukker, bland varsamt',uncertainties:['Uvisst mål'],surprise:{unsafe:true}});
 assert.deepEqual(v,{title:'Kake',ingredients:['3 kopper sukker'],steps:['Bland varsamt'],rawText:'Kake med gamle norske måleeiningar 3 kopper sukker, bland varsamt',uncertainties:['Uvisst mål']});
});
