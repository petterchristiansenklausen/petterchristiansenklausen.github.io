import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { createImageHandler, POST as image, imageQuotaDigest } from '../lib/providers/recipe-image/route';
import { POST as chef } from '../lib/providers/chef/route';
import { prepareImageResult, maximumImageBase64 } from '../lib/ai-image-result';
import { requestID, safeCategory } from '../lib/ai-diagnostics';
import { usable } from '../lib/billing/validation';
const fetchOriginal=globalThis.fetch;
const keys=['MIN_MAT_CLIENT_TOKEN','AI_GATEWAY_API_KEY','MIN_MAT_IMAGE_LIMITS_DATABASE_URL','MIN_MAT_IMAGE_LIMIT_SALT','MIN_MAT_TELEMETRY_DATABASE_URL'];
const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
before(()=>{process.env.MIN_MAT_CLIENT_TOKEN='test-client';process.env.AI_GATEWAY_API_KEY='fake-never-sent';delete process.env.MIN_MAT_IMAGE_LIMITS_DATABASE_URL;delete process.env.MIN_MAT_IMAGE_LIMIT_SALT;delete process.env.MIN_MAT_TELEMETRY_DATABASE_URL;});
after(()=>{globalThis.fetch=fetchOriginal;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
const req=(feature:string,body:any,id=randomUUID())=>new NextRequest('https://local.test/api/'+feature,{method:'POST',headers:{'content-type':'application/json','x-minmat-client':'test-client','x-minmat-request-id':id},body:JSON.stringify(body)});
const imageInput={title:'Testrett',ingredients:['Testvare']};
const chefInput={action:'ideas',message:'Test',allowMissing:true,inventory:[]};
const suggestion={title:'Test',steps:['Teststeg'],ingredients:[{name:'Testvare',amount:1,unit:'stk',fromInventory:false}],servings:2,minutes:20};
const successChef=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'Test',suggestions:[suggestion],mealPlan:[]})}}]}));
const fixture=async()=> (await sharp({create:{width:32,height:32,channels:3,background:'#aabbcc'}}).png().toBuffer()).toString('base64');
test('missing Preview image quota configuration fails before Gateway; distinct category and UUID',async()=>{
 globalThis.fetch=async()=>{assert.fail('No provider call allowed');};const id=randomUUID();
 const response=await image(req('recipe-image',imageInput,id));const b=await response.json();
 assert.equal(response.status,503);assert.equal(b.category,'image_budget_config');assert.equal(b.requestID,id);
});
test('authenticated account is passed to quota separately from untrusted headers',async()=>{
 const account={id:randomUUID(),environment:'Sandbox' as const};let seen:unknown;
 const handler=createImageHandler(async(_request,value)=>{seen=value;return false;});
 const response=await handler(req('recipe-image',imageInput),account);
 assert.deepEqual(seen,account);assert.equal((await response.json()).category,'image_budget_limit');
});
test('legacy HTTP caller cannot manufacture trusted account quota context',async()=>{
 let seen:unknown='unset';const handler=createImageHandler(async(_request,value)=>{seen=value;return false;});
 const request=req('recipe-image',imageInput);request.headers.set('x-minmat-installation',randomUUID());
 await handler(request);assert.equal(seen,undefined);
});
test('image Gateway request preserves model/API format and returns a fully decoded bounded JPEG',async()=>{
 const b64=await fixture();let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://ai-gateway.vercel.sh/v1/images/generations');const b=JSON.parse(options!.body as string);assert.equal(b.model,'openai/gpt-image-2');assert.equal(b.output_format,'jpeg');return new Response(JSON.stringify({data:[{b64_json:b64}]}));};
 const response=await createImageHandler(async()=>true)(req('recipe-image',imageInput));const result=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.ok(result.imageBase64.length<=maximumImageBase64);
 assert.equal((await sharp(Buffer.from(result.imageBase64,'base64')).metadata()).format,'jpeg');assert.ok(usable('recipe-image',result));
 assert.ok(Buffer.byteLength(JSON.stringify({requestID:randomUUID(),result}))<4_500_000);
});
test('corrupt bytes with a valid JPEG prefix are rejected before billing',async()=>{
 const b64=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(200)]).toString('base64');
 await assert.rejects(prepareImageResult(b64));
 globalThis.fetch=async()=>new Response(JSON.stringify({data:[{b64_json:b64}]}));
 const response=await createImageHandler(async()=>true)(req('recipe-image',imageInput));assert.equal((await response.json()).category,'invalid_image');
});
test('oversized image envelope cannot be billable',()=>{assert.equal(usable('recipe-image',{imageBase64:'/9j/'+ 'A'.repeat(4_000_000)}),false);});
test('base64 validation rejects noncanonical input and URL instead of downloading it',async()=>{
 for(const value of ['https://private.invalid/image','data:image/png;base64,abcd','abcd!!!',null])await assert.rejects(prepareImageResult(value));
});
test('image upstream 401/402/429/500 retain meaningful safe categories',async()=>{
 for(const [status,category] of [[401,'gateway_auth'],[402,'gateway_budget'],[429,'gateway_rate_limit'],[500,'gateway_unavailable']] as const){
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'PRIVATE provider text'}}),{status});
 const response=await createImageHandler(async()=>true)(req('recipe-image',imageInput));const body=await response.json();assert.equal(body.category,category);assert.ok(!JSON.stringify(body).includes('PRIVATE'));
 }
});
test('image transport timeout classified distinctly',async()=>{
 globalThis.fetch=async()=>{throw new DOMException('PRIVATE','TimeoutError');};
 const response=await createImageHandler(async()=>true)(req('recipe-image',imageInput));assert.equal((await response.json()).category,'timeout');
});
test('chef valid output retains app required fields and unchanged model',async()=>{
 globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options!.body as string).model,'openai/gpt-5.6-luna');return successChef();};
 const response=await chef(req('chef',chefInput));const b=await response.json();assert.equal(response.status,200);assert.ok(usable('chef',b));assert.equal(typeof b.suggestions[0].summary,'string');assert.ok(Array.isArray(b.suggestions[0].tags));
});
test('chef distinguishes output truncation, invalid JSON and no matching suggestions',async()=>{
 const cases=[['length','{}','incomplete_output'],['stop','not json','invalid_json'],['stop',JSON.stringify({suggestions:[]}), 'no_suggestions']];
 for(const [reason,content,category] of cases){globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content}}]}));const response=await chef(req('chef',chefInput));assert.equal((await response.json()).category,category);}
});
test('chef timeout and gateway authentication failures remain distinguishable',async()=>{
 globalThis.fetch=async()=>{throw new DOMException('private','TimeoutError');};assert.equal((await (await chef(req('chef',chefInput))).json()).category,'timeout');
 globalThis.fetch=async()=>new Response('{}',{status:403});assert.equal((await (await chef(req('chef',chefInput))).json()).category,'gateway_auth');
});
test('request IDs cannot inject logs and unknown categories cannot expose data',()=>{
 const request=req('chef',chefInput);request.headers.set('x-minmat-request-id','private recipe text');assert.match(requestID(request),/^[a-f0-9-]{36}$/);assert.equal(safeCategory('private recipe text'),'billing_failure');
});
test('concurrent errors retain independent correlation IDs',async()=>{
 globalThis.fetch=async()=>new Response('{}',{status:429});const ids=[randomUUID(),randomUUID()];
 const results=await Promise.all(ids.map(async id=>(await (await chef(req('chef',chefInput,id))).json()).requestID));assert.deepEqual(results,ids);
});

test('quota hashes separate authenticated accounts and environments, stable over devices',()=>{
 const a={id:randomUUID(),environment:'Sandbox' as const}, b={id:randomUUID(),environment:'Sandbox' as const};
 assert.notEqual(imageQuotaDigest('salt','unknown',a),imageQuotaDigest('salt','unknown',b));
 assert.equal(imageQuotaDigest('salt','ip1',a),imageQuotaDigest('salt','ip2',a));
 assert.notEqual(imageQuotaDigest('salt','unknown',a),imageQuotaDigest('salt','unknown',{...a,environment:'Production'}));
});

// Freeform question contract: ask the cook without forcing any recipe.
const answerOnlyChef = (answer:string) => new Response(JSON.stringify({
 choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer,suggestions:[],mealPlan:[]})}}]
}));
test('freeform food questions produce a usable answer without a recipe',async()=>{
 for(const question of ['Er klementiner sunt?', 'Er det sukker i kakao?', 'Hvor mye fett er det i TINE Smøremykt per 100 g?']){
  globalThis.fetch=async(_url,options)=>{
   const payload=JSON.parse(options!.body as string);
   assert.equal(payload.model,'openai/gpt-5.6-luna');
   assert.match(JSON.stringify(payload.messages), /suggestions: \[\]/);
   return answerOnlyChef('Et kort matfaglig svar. Sjekk varedeklarasjonen for nøyaktige produktverdier.');
  };
  const input={action:'freeform',responseMode:'conversation',message:question,inventory:[],allowMissing:true};
  const response=await chef(req('chef',input));
  const result=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(result.suggestions,[]);
  assert.deepEqual(result.mealPlan,[]);
  assert.ok(usable('chef',result,input));
 }
});
test('answer-only is rejected for meals or forced recipe editing',async()=>{
 const textOnly={answer:'Svaret er matfaglig.', suggestions:[],mealPlan:[]};
 assert.equal(usable('chef',textOnly,{action:'freeform',responseMode:'conversation'}),true);
 assert.equal(usable('chef',textOnly,{action:'freeform',responseMode:'recipe'}),false);
 assert.equal(usable('chef',textOnly,{action:'freeform'}),false); // legacy app expects recipes
 for(const action of ['ideas','single_meal','daily_plan','weekly_plan']){
  assert.equal(usable('chef',textOnly,{action}),false);
 }
 globalThis.fetch=async()=>answerOnlyChef('Svar uten oppskrift');
 const recipeReq=req('chef',{action:'freeform',responseMode:'recipe',message:'Lag en fullstendig oppskrift'});
 const response=await chef(recipeReq);
 assert.equal(response.status,502);
 assert.equal((await response.json()).category,'no_suggestions');
});
test('empty answer, missing suggestions array and malformed freeform output are not usable',async()=>{
 const input={action:'freeform',responseMode:'conversation',message:'Et spørsmål'};
 for(const value of [{answer:'',suggestions:[],mealPlan:[]},{answer:'  ',suggestions:[],mealPlan:[]},{answer:'Svar',mealPlan:[]},{answer:'Svar',suggestions:[],mealPlan:[{dayOffset:0}]}]){
  assert.equal(usable('chef',value,input),false);
 }
 globalThis.fetch=async()=>answerOnlyChef('  ');
 const response=await chef(req('chef',input));
 assert.equal(response.status,502);
});
test('freeform recipe requests still return normal usable suggestions',async()=>{
 globalThis.fetch=async()=>successChef();
 const input={action:'freeform',responseMode:'recipe',message:'Lag en oppskrift på omelett'};
 const response=await chef(req('chef',input));
 const b=await response.json();
 assert.equal(response.status,200);
 assert.ok(usable('chef',b,input));
 assert.equal(b.suggestions.length,1);
});

test('malformed or filtered recipes cannot silently become charged conversation answers',async()=>{
 for(const value of [
  {answer:'Svar',mealPlan:[]},
  {answer:'Svar',suggestions:[{title:'Broken'}],mealPlan:[]},
  {answer:'Svar',suggestions:[],mealPlan:[{dayOffset:0}]}
 ]){
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
  const r=await chef(req('chef',{action:'freeform',responseMode:'conversation',message:'Er klementiner sunt?'}));
  assert.equal(r.status,502);
 }
});
test('legacy freeform and every meal action reject text-only provider output',async()=>{
 globalThis.fetch=async()=>answerOnlyChef('Matfaglig svar');
 for(const action of ['freeform','ideas','single_meal','daily_plan','weekly_plan']) {
  const r=await chef(req('chef',{action,message:'Test'}));assert.equal(r.status,502);
 }
});
