/** A readable structured scan is required before a user can be charged. */
export type RecipeScan = {
  title: string;
  ingredients: string[];
  steps: string[];
  rawText: string;
  uncertainties: string[];
};
const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export function cleanRecipeScan(raw: unknown): RecipeScan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const title = clean(v.title, 180);
  const ingredients = Array.isArray(v.ingredients) ? v.ingredients.map(x => clean(x, 260)).filter(Boolean).slice(0, 70) : [];
  const steps = Array.isArray(v.steps) ? v.steps.map(x => clean(x, 1000)).filter(Boolean).slice(0, 60) : [];
  const rawText = clean(v.rawText, 18000);
  const uncertainties = Array.isArray(v.uncertainties) ? v.uncertainties.map(x => clean(x, 260)).filter(Boolean).slice(0, 40) : [];
  if (!title || !ingredients.length || !steps.length || rawText.length < 25) return null;
  return { title, ingredients, steps, rawText, uncertainties };
}
