import { proID } from './apple';
// The numbers below are a PREVIEW proposal, not approved App Store prices.
// Prices in NOK are configured in App Store Connect, not in this module.
export const PRO_PREVIEW_BONUS = 100;
export function purchaseCredits(config: any, productId: string): number {
 const credits = productId === proID ? config.proBonusCredits : config.packs?.[productId];
 if (!Number.isSafeInteger(credits) || credits < 0 || credits > 100000) throw new Error('invalid_product');
 return credits;
}
// A restored non-consumable must not grant its starter credits twice.
export function purchaseLedgerId(t: { productId: string, transactionId?: string, originalTransactionId?: string }): string {
 return (t.productId === proID ? t.originalTransactionId || t.transactionId : t.transactionId) || '';
}
