import { cleanRecipeScan } from '../providers/recipe-scan/validation';
// `input` is the already authenticated and tariff-checked request body.
// Never charge for a text-only response to an ordinary recipe-generation action.
export function usable(feature:string,value:any,input?:{action?:unknown;responseMode?:unknown}):boolean {
 const text=(v:any)=>typeof v==='string'&&v.trim().length>0;
 if(feature==='chef') {
  if (!Array.isArray(value?.suggestions)) return false;
  const recipeValid = value.suggestions.length > 0 && value.suggestions.every((s:any) =>
   text(s.title) && Array.isArray(s.steps) && s.steps.length > 0 && s.steps.every(text) && Array.isArray(s.ingredients));
  if (recipeValid) return true;
  return input?.action==='freeform' && input?.responseMode==='conversation' &&
   value.suggestions.length===0 && Array.isArray(value?.mealPlan) && value.mealPlan.length===0 &&
   text(value?.answer) && value.answer.trim().length<=1200;
 }
 if(feature==='recipe-method')return Array.isArray(value?.steps)&&value.steps.length>0&&value.steps.every(text);
 if(feature==='inventory-photo')return Array.isArray(value?.items)&&value.items.length>0&&value.items.every((i:any)=>text(i.name));
 if(feature==='recipe-scan')return cleanRecipeScan(value)!==null;
 if(feature==='recipe-image') {
  if(!text(value?.imageBase64)||value.imageBase64.length>4000000)return false;
  const b=Buffer.from(value.imageBase64,'base64');
  return b.length>32&&((b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)||b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'));
 }
 return false;
}
