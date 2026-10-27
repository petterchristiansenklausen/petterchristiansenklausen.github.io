import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseCredits,purchaseLedgerId } from '../lib/billing/pricing';
import { estimateRecipeImageUSD } from '../lib/ai-image-estimate';

test('Pro preview bonus 100; unknown products cannot mint credits',()=>{
 const config={proBonusCredits:100,packs:{'com.pettersapps.MinMat.credits.starter':100}};
 assert.equal(purchaseCredits(config,'com.pettersapps.MinMat.pro'),100);
 assert.equal(purchaseCredits(config,'com.pettersapps.MinMat.credits.starter'),100);
 assert.throws(()=>purchaseCredits(config,'fake_product'));
 assert.throws(()=>purchaseCredits({...config,proBonusCredits:-1},'com.pettersapps.MinMat.pro'));
});
test('StoreKit Pro restore uses stable ID; consumables remain independent',()=>{
 const pro='com.pettersapps.MinMat.pro';
 assert.equal(purchaseLedgerId({productId:pro,originalTransactionId:'original-42',transactionId:'restore-1'}),
              purchaseLedgerId({productId:pro,originalTransactionId:'original-42',transactionId:'restore-2'}));
 assert.notEqual(purchaseLedgerId({productId:'com.pettersapps.MinMat.credits.starter',originalTransactionId:'same',transactionId:'1'}),
                 purchaseLedgerId({productId:'com.pettersapps.MinMat.credits.starter',originalTransactionId:'same',transactionId:'2'}));
});
test('Image price estimation only supports exact model, quality and size',()=>{
 const price=estimateRecipeImageUSD('openai/gpt-image-2','low','1024x1024','Photorealistic meal');
 assert.ok(price!==null&&price>=0.006&&price<0.007);
 assert.equal(estimateRecipeImageUSD('openai/gpt-image-2','high','1024x1024','meal'),null);
 assert.equal(estimateRecipeImageUSD('other','low','1024x1024','meal'),null);
});
