/** Transparent planning estimate, NEVER an actual invoice or observed provider cost.
 * GPT Image 2 low 1024²: about $0.006 for generated image output.
 * Additional input text: $2.50/million tokens, estimated at four chars/token.
 * Adjust if model/quality/size/pricing changes; do not silently use this for other models.
 */
export function estimateRecipeImageUSD(model:string, quality:string, size:string, prompt:string):number | null {
 if (model !== 'openai/gpt-image-2' || quality !== 'low' || size !== '1024x1024' || !prompt) return null;
 return Math.round((0.006 + Math.ceil(prompt.length/4)*2.5/1_000_000)*1e9)/1e9;
}
