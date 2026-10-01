import {test,expect} from '@playwright/test';
import {planPurchase,supplyConfig} from '../../supplies/policy';
const c=supplyConfig({MAX_FUEL_PRICE:'550',MAX_CO2_PRICE:'120'});
const s={pricePer1000:500,holding:1000,remainingCapacity:100000,balance:100000};
test('fills available fuel capacity below the cap',()=>expect(planPurchase(s,'fuel',c)).toMatchObject({quantity:100000,estimatedCost:50000}));
for(const price of [550,551,1249])test(`never uses an emergency exception at fuel price ${price}`,()=>expect(planPurchase({...s,holding:0,pricePer1000:price},'fuel',c).quantity).toBe(0));
test('CO2 also observes the strict cap and budget',()=>{
 expect(planPurchase({...s,pricePer1000:119},'co2',c).quantity).toBe(100000);
 expect(planPurchase({...s,pricePer1000:120},'co2',c).quantity).toBe(0);
 expect(planPurchase({...s,pricePer1000:100,balance:100},'co2',c)).toMatchObject({quantity:500,estimatedCost:50});
});
test('volume limit, reserve and full storage are respected',()=>{
 const cfg=supplyConfig({MAX_FUEL_PURCHASE_PER_RUN:'2000',MIN_CASH_RESERVE:'1000'});
 expect(planPurchase({...s,balance:2000},'fuel',cfg)).toMatchObject({quantity:2000,estimatedCost:1000});
 expect(planPurchase({...s,balance:1000},'fuel',cfg).quantity).toBe(0);
 expect(planPurchase({...s,remainingCapacity:0},'fuel',cfg).reason).toBe('STORAGE_FULL');
});
for(const value of [NaN,-1,Infinity,0.5])test(`inconsistent supply values rejected: ${value}`,()=>expect(planPurchase({...s,balance:value},'fuel',c).reason).toBe('INVALID_DATA'));
test('unaffordable tank uses half budget and rounds quantity down',()=>expect(planPurchase({...s,balance:1001},'fuel',c)).toMatchObject({quantity:1000,estimatedCost:500,budget:500}));
test('zero price rejected; disabled flow holds',()=>{
 expect(planPurchase({...s,pricePer1000:0},'fuel',c).reason).toBe('INVALID_DATA');
 expect(planPurchase(s,'fuel',supplyConfig({ENABLE_FUEL:'false'})).reason).toBe('DISABLED');
});
for(const env of [{MAX_FUEL_PRICE:'550oops'},{MAX_CO2_PRICE:'0'},{MAX_FUEL_PURCHASE_PER_RUN:'-1'},{MIN_CASH_RESERVE:'NaN'},{ENABLE_FUEL:'maybe'}])test(`bad config ${JSON.stringify(env)}`,()=>expect(()=>supplyConfig(env)).toThrow());
