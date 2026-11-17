/** Only validated, readable structured scans can result in a credit charge. */
export type RecipeScan = {
 title: string; ingredients: string[]; steps: string[];
 rawText: string; uncertainties: string[];
};
const clean=(v:unknown,max:number):string=>typeof v==='string'?v.trim().slice(0,max):'';
export function cleanRecipeScan(raw:unknown):RecipeScan|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const v=raw as Record<string,unknown>;
 const title=clean(v.title,180);
 const ingredients=Array.isArray(v.ingredients)?v.ingredients.map(x=>clean(x,260)).filter(Boolean).slice(0,70):[];
 const steps=Array.isArray(v.steps)?v.steps.map(x=>clean(x,1000)).filter(Boolean).slice(0,60):[];
 const rawText=clean(v.rawText,18000);
 const uncertainties=Array.isArray(v.uncertainties)?v.uncertainties.map(x=>clean(x,260)).filter(Boolean).slice(0,40):[];
 // Empty, partial, malformed, or unstructured results are not billable.
 if(!title||ingredients.length===0||steps.length===0||!rawText)return null;
 // Require at least minimal coverage; a lone hallucinated title/step is not a usable recipe.
 if(rawText.length<25)return null;
 return {title,ingredients,steps,rawText,uncertainties};
}
