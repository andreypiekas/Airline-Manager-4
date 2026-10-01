import { expect, Page } from '@playwright/test';
import { closeReadOnlyPopup } from './cost-reference-reader';

export type FinanceCategory = 'fuelPurchase'|'co2Purchase'|'aCheckBulk'|'staff'|'marketing'|
  'loungeMaintenance'|'routeSetup'|'aircraftPurchase'|'flightRevenue'|'gift'|'unclassified';
export interface FinanceTransactionReference {
  relativeTime: string; category: FinanceCategory; amount: number;
  quantity: number|null; unit: 'lbs'|'quotas'|'days'|'departures'|null;
}
export interface PurchaseTransactionReference {
  quantity: number; unit:'lbs'|'quotas'; chargedAmount:number; pricePer1000:number;
  relativeTime:string; source:'inspected-visible-transaction'; inventoryCostBasisComplete:false;
}
export interface FinanceHistoryReference {
  status:'not_requested'|'observed'|'unavailable'; stage:string; observedAt:string;
  source:'inspected-finance-history'; scope:'company-visible-history'; currency:'game-dollar';
  historyComplete:false; exactTransactionTimesAvailable:false; perLegCostsComplete:false;
  comparisonReady:false; mutationAuthorized:false; uiClosed:boolean; warnings:string[];
  transactions:FinanceTransactionReference[];
  latestVisiblePurchases:{fuel:PurchaseTransactionReference|null;co2:PurchaseTransactionReference|null};
}
export function emptyFinanceHistory(status:FinanceHistoryReference['status']='not_requested'):FinanceHistoryReference {
  return {status,stage:status,observedAt:new Date().toISOString(),source:'inspected-finance-history',
    scope:'company-visible-history',currency:'game-dollar',historyComplete:false,exactTransactionTimesAvailable:false,
    perLegCostsComplete:false,comparisonReady:false,mutationAuthorized:false,uiClosed:true,warnings:[],
    transactions:[],latestVisiblePurchases:{fuel:null,co2:null}};
}
const integer=(text:string)=>{
  if(!/^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text))throw new Error('FINANCE_NUMBER_INVALID');
  const n=Number(text.replace(/,/g,''));if(!Number.isSafeInteger(n))throw new Error('FINANCE_NUMBER_INVALID');return n;
};

/** The inspected history has three rendered columns. It is a limited company ledger,
 * not a complete inventory history or a per-aircraft operating quote. Unknown labels
 * are not retained, and rounded relative times are never promoted to exact timestamps.
 */
export function parseFinanceTransactions(text:string):FinanceTransactionReference[] {
  const lines=text.trim().split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length||lines.length>1000||text.length>100000)throw new Error('FINANCE_ROWS_UNAVAILABLE');
  return lines.map(line=>{
    const cells=line.split('\t').map(s=>s.trim());
    if(cells.length!==3||!/^\d+ (?:secs?|seconds?|mins?|minutes?|hours?|days?) ago$/.test(cells[0]))
      throw new Error('FINANCE_ROW_INVALID');
    integer(cells[0].split(' ')[0]);
    const amount=integer(cells[2]);const label=cells[1];
    let category:FinanceCategory='unclassified',quantity:number|null=null,unit:FinanceTransactionReference['unit']=null;
    const quantified=label.match(/^([\d,]+) (Lbs purchased|co2 quotas|routes departed)$/);
    const salary=label.match(/^Staff salary ([\d,]+) days$/);
    if(quantified){
      quantity=integer(quantified[1]);if(quantity<=0)throw new Error('FINANCE_QUANTITY_INVALID');
      [category,unit]=quantified[2]==='Lbs purchased'?['fuelPurchase','lbs']:
        quantified[2]==='co2 quotas'?['co2Purchase','quotas']:['flightRevenue','departures'];
    }else if(salary){category='staff';quantity=integer(salary[1]);unit='days';if(quantity<=0)throw new Error('FINANCE_QUANTITY_INVALID');}
    else {
      const known:Record<string,FinanceCategory>={'Bulk A-Check':'aCheckBulk','Marketing':'marketing','Lounge maintenance':'loungeMaintenance',
        'New route fee':'routeSetup','A/C Purchased':'aircraftPurchase','Daily Gift':'gift'};
      category=Object.prototype.hasOwnProperty.call(known,label)?known[label]:'unclassified';
    }
    if(['fuelPurchase','co2Purchase','aCheckBulk','staff','marketing','loungeMaintenance','routeSetup','aircraftPurchase'].includes(category)&&amount>0||
      ['flightRevenue','gift'].includes(category)&&amount<0)throw new Error('FINANCE_SIGN_INVALID');
    return {relativeTime:cells[0],category,amount,quantity,unit};
  });
}
export function visiblePurchaseReferences(transactions:FinanceTransactionReference[]):FinanceHistoryReference['latestVisiblePurchases'] {
  const read=(category:'fuelPurchase'|'co2Purchase',unit:'lbs'|'quotas'):PurchaseTransactionReference|null=>{
    const row=transactions.find(r=>r.category===category);
    if(!row||row.unit!==unit||!Number.isSafeInteger(row.quantity)||row.quantity!<=0||
      !Number.isSafeInteger(row.amount)||row.amount>0)return null;
    const chargedAmount=Math.abs(row.amount),pricePer1000=chargedAmount/row.quantity!*1000;
    if(!Number.isFinite(pricePer1000)||pricePer1000<0||pricePer1000>Number.MAX_SAFE_INTEGER)return null;
    return {quantity:row.quantity!,unit,chargedAmount,pricePer1000,relativeTime:row.relativeTime,
      source:'inspected-visible-transaction',inventoryCostBasisComplete:false};
  };
  return {fuel:read('fuelPurchase','lbs'),co2:read('co2Purchase','quotas')};
}

/** Uses only the inspected Finance opener and native close; no expense filters,
 * marketing, stock, input, service, purchase or transaction control is clicked.
 */
export async function readFinanceHistoryReference(page:Page,timeout=10000):Promise<FinanceHistoryReference> {
  const result=emptyFinanceHistory('unavailable');
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new Error('FINANCE_TIMEOUT_INVALID');
  try {
    result.stage='popup_close';await closeReadOnlyPopup(page,timeout);
    result.stage='menu';
    const control=page.locator('[id="mapMaint"][data-original-title="Finance, Marketing & Stock"]');
    if(await control.count()!==1||!await control.isVisible()||
      (await control.getAttribute('onclick')||'').replace(/\s/g,'')!=="hideAllWhenClick();popup('finances.php','Finances');")throw new Error();
    await control.click({timeout});result.stage='history';
    await expect(page.locator('#popTitle')).toHaveText('FINANCES',{ignoreCase:true,timeout});
    const panel=page.locator('#financeAction');const history=panel.locator('#transactionContainer');
    await history.waitFor({state:'visible',timeout});
    if(await panel.count()!==1||await history.count()!==1)throw new Error();
    await expect.poll(()=>history.innerText(),{timeout}).toMatch(/ago\t/);
    result.transactions=parseFinanceTransactions(await history.innerText());
    result.latestVisiblePurchases=visiblePurchaseReferences(result.transactions);
    result.observedAt=new Date().toISOString();result.status='observed';result.stage='observed';
  }catch{result.transactions=[];result.latestVisiblePurchases={fuel:null,co2:null};result.warnings.push('FINANCE_HISTORY_UNAVAILABLE:'+result.stage);}
  finally {
    try{await closeReadOnlyPopup(page,timeout);await expect(page.locator('#financeAction')).not.toBeVisible({timeout});}
    catch{result.uiClosed=false;result.warnings.push('FINANCE_POPUP_CLOSE_FAILED');}
  }
  return result;
}
