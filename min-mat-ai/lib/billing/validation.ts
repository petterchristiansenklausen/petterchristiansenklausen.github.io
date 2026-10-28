export function usable(feature:string,value:any):boolean {
 const text=(v:any)=>typeof v==='string'&&v.trim().length>0;
 if(feature==='chef')return Array.isArray(value?.suggestions)&&value.suggestions.length>0&&value.suggestions.every((s:any)=>text(s.title)&&Array.isArray(s.steps)&&s.steps.length>0&&s.steps.every(text)&&Array.isArray(s.ingredients));
 if(feature==='recipe-method')return Array.isArray(value?.steps)&&value.steps.length>0&&value.steps.every(text);
 if(feature==='inventory-photo')return Array.isArray(value?.items)&&value.items.length>0&&value.items.every((i:any)=>text(i.name));
 if(feature==='recipe-image') {
  if(!text(value?.imageBase64)||value.imageBase64.length>7000000)return false;
  const b=Buffer.from(value.imageBase64,'base64');
  return b.length>32&&((b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)||b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'));
 }
 return false;
}
