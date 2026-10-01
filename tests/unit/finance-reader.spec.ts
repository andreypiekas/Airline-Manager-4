import { test,expect,Page } from '@playwright/test';
import { parseFinanceTransactions,readFinanceHistoryReference,visiblePurchaseReferences } from '../../optimization/finance-reader';
const rows=['2 mins ago\tLounge maintenance\t-100',
 '3 mins ago\t2 routes departed\t1,200','4 hours ago\tMarketing\t-500',
 '5 hours ago\tBulk A-Check\t-2,000','6 hours ago\tStaff salary 1 days\t-300',
 '7 hours ago\t2,000 co2 quotas\t-400','8 hours ago\t1,000 Lbs purchased\t-360',
 '9 hours ago\tNew route fee\t-50','10 hours ago\tA/C Purchased\t-30,000','11 hours ago\tDaily Gift\t25'].join('\n');
test('classifies inspected ledger expenses, receipts and income without pretending to be per-leg evidence',()=>{
 const entries=parseFinanceTransactions(rows);
 expect(entries.map(r=>r.category)).toEqual(['loungeMaintenance','flightRevenue','marketing','aCheckBulk','staff',
  'co2Purchase','fuelPurchase','routeSetup','aircraftPurchase','gift']);
 expect(entries[1]).toMatchObject({quantity:2,unit:'departures',amount:1200});
 const references=visiblePurchaseReferences(entries);
 expect(references.fuel).toMatchObject({quantity:1000,chargedAmount:360,pricePer1000:360,inventoryCostBasisComplete:false});
 expect(references.co2).toMatchObject({quantity:2000,unit:'quotas',pricePer1000:200});
});
test('unknown transaction labels are not retained or assigned to missing cost categories',()=>{
 for(const label of ['SYNTHETIC UNCLASSIFIED LABEL','constructor','__proto__','toString']){
  const entries=parseFinanceTransactions(`2 hours ago\t${label}\t-10`);
  expect(entries).toEqual([{relativeTime:'2 hours ago',category:'unclassified',amount:-10,quantity:null,unit:null}]);
  expect(JSON.stringify(entries)).not.toContain(label);expect(visiblePurchaseReferences(entries)).toEqual({fuel:null,co2:null});
 }
});
test('an explicit zero purchase is recorded as a receipt and cannot establish full inventory basis',()=>{
 expect(visiblePurchaseReferences(parseFinanceTransactions('1 hours ago\t500 Lbs purchased\t0')).fuel)
  .toMatchObject({chargedAmount:0,pricePer1000:0,inventoryCostBasisComplete:false});
});
for(const [label,row] of Object.entries({
 malformed:'2 hours ago Marketing -10',time:'tomorrow\tMarketing\t-10',fraction:'2 hours ago\tMarketing\t-1.5',
 grouping:'2 hours ago\tMarketing\t-12,34',positiveExpense:'2 hours ago\tMarketing\t10',
 negativeIncome:'2 hours ago\t1 routes departed\t-10',zeroQuantity:'2 hours ago\t0 Lbs purchased\t-10',
 unsafe:'2 hours ago\tMarketing\t-9007199254740992',empty:'',
}))test(`invalid ledger cannot provide purchase or cost evidence: ${label}`,()=>expect(()=>parseFinanceTransactions(row)).toThrow());

async function fixture(page:Page,variant=''){
 await page.route('**/*',r=>r.abort());
 await page.setContent(`<div><h5 id="popTitle">Routes</h5><button id="close" onclick="closePop();document.getElementById('rewardPopup').style.display='none';">Close</button></div>
 <div id="rewardPopup"></div>
 <div id="mapMaint" data-original-title="Maintenance" onclick="window.mutations++">Maintenance</div>
 <div id="mapMaint" data-original-title="Finance, Marketing & Stock" onclick="hideAllWhenClick();popup('finances.php','Finances');">Finance</div>
 <div id="financeAction" style="display:none"><div id="transactionContainer" style="white-space:pre"></div>
 <button id="t-expense" onclick="window.mutations++">Expenses</button><button onclick="window.mutations++">Marketing</button>
 <input value="SYNTHETIC PRIVATE FIELD"><button onclick="window.mutations++">Purchase MCDU</button></div>
 <script>window.mutations=0;window.queries=0;
 function hideAllWhenClick(){}function closePop(){document.querySelector('#popTitle').style.display='none';document.querySelector('#financeAction').style.display='none'}
 function popup(){window.queries++;document.querySelector('#popTitle').style.display='block';document.querySelector('#popTitle').textContent=${JSON.stringify(variant==='title'?'Unknown':'FINANCES')};
 document.querySelector('#financeAction').style.display='block';document.querySelector('#transactionContainer').textContent='';
 setTimeout(()=>document.querySelector('#transactionContainer').textContent=${JSON.stringify(variant==='rows'?'2 hours ago\tMarketing\t10':rows)},10)}
 </script>`);
 if(variant==='callback')await page.locator('[data-original-title="Finance, Marketing & Stock"]').evaluate(e=>e.setAttribute('onclick',"hideAllWhenClick();popup('finances.php','Finances');window.mutations++;"));
 if(variant==='close')await page.locator('#close').evaluate(e=>e.setAttribute('onclick','window.mutations++'));
 if(variant==='duplicate')await page.locator('[data-original-title="Finance, Marketing & Stock"]').evaluate(e=>e.after(e.cloneNode(true)));
}
test('reads native Finance history with duplicated menu IDs, restores popup and touches no paid or operational controls',async({page})=>{
 await fixture(page);const report=await readFinanceHistoryReference(page,500);
 expect(report).toMatchObject({status:'observed',transactions:parseFinanceTransactions(rows),uiClosed:true,
  historyComplete:false,perLegCostsComplete:false,exactTransactionTimesAvailable:false,comparisonReady:false,mutationAuthorized:false});
 expect(await page.evaluate(()=>(window as any).queries)).toBe(1);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
 expect(JSON.stringify(report)).not.toContain('PRIVATE FIELD');expect(await page.locator('input').inputValue()).toBe('SYNTHETIC PRIVATE FIELD');
});
for(const variant of ['callback','close','duplicate','title','rows'])test(`unverified Finance source never authorizes an operation: ${variant}`,async({page})=>{
 await fixture(page,variant);const report=await readFinanceHistoryReference(page,100);
 expect(report).toMatchObject({status:'unavailable',transactions:[],latestVisiblePurchases:{fuel:null,co2:null},comparisonReady:false,mutationAuthorized:false});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
