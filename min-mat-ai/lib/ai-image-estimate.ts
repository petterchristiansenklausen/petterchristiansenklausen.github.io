/** Planning estimate, NEVER an invoice or measured provider cost.
 * GPT Image 2 low 1024² costs about $0.006 per image output.
 * Text input $2.50 per million tokens, approximating four chars/token.
 * Restrict this estimate to the exact currently used image settings.
 */
export function estimateRecipeImageUSD(model:string,quality:string,size:string,prompt:string):number|null{
 if(model!=='openai/gpt-image-2'||quality!=='low'||size!=='1024x1024'||!prompt)return null;
 return Math.round((0.006 + Math.ceil(prompt.length/4)*2.5/1_000_000)*1e9)/1e9;
}
