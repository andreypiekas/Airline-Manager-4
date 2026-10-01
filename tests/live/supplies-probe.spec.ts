import { test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { loginForReadOnlyCollection } from '../../utils/read-only-login';
import { closeReadOnlyPopup } from '../../optimization/cost-reference-reader';
test('inspect supply controls without purchases',async({page})=>{
 await loginForReadOnlyCollection(page,process.env,90000);
 const out:any[]=[];
 const save=async()=>{await mkdir('test-results/supplies',{recursive:true});await writeFile('test-results/supplies/controls.json',JSON.stringify(out,null,2));};
 const menu=page.locator('#smallMainMenu').getByText('Fuel',{exact:true}).locator('../..');
 if((await menu.getAttribute('onclick')||'').replace(/\s/g,'')!=="hideAllWhenClick();popup('fuel.php','Fuel',false,false,true);")throw Error('MENU_UNVERIFIED');
 await menu.click();
 for(const kind of ['fuel','co2']){
  const panel=page.locator('#fuelMain');await panel.getByText(kind==='fuel'?'Current price':'Quota cost',{exact:true}).waitFor();
  out.push({kind,text:await panel.innerText(),controls:await panel.locator('input:not([type=hidden]),button,[onclick]').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,type:e.getAttribute('type'),placeholder:e.getAttribute('placeholder'),label:e.tagName==='INPUT'?null:e.textContent?.trim(),
   callback:(e.getAttribute('onclick')||'').replace(/(['"])[A-Za-z0-9_-]{24,}\1/g,"'<redacted>'")})))});await save();
  if(kind==='fuel'){
   const tab=page.locator('#popBtn2');if((await tab.getAttribute('onclick')||'').replace(/\s/g,'')!=="$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('co2.php','fuelMain',this,false,false);")throw Error('TAB_UNVERIFIED');
   await tab.click();
  }
 }
 await closeReadOnlyPopup(page,10000);
});

// Exercise the exact production reader and quote path, with purchases structurally disabled.
import {runSupplies} from '../../supplies/run';
test('validate supply plans on the live UI without buying',async({page})=>{
 await loginForReadOnlyCollection(page,process.env,90000);
 await runSupplies(page,true,{...process.env,ENABLE_FUEL:'true',MAX_FUEL_PRICE:'550',MAX_CO2_PRICE:'120'},'test-results/supplies/configured');
 // Artificial thresholds are only for this dry-run quote test, never production settings.
 await runSupplies(page,true,{...process.env,ENABLE_FUEL:'true',MAX_FUEL_PRICE:'10000',MAX_CO2_PRICE:'10000',MAX_FUEL_PURCHASE_PER_RUN:'1000',MAX_CO2_PURCHASE_PER_RUN:'1000'},'test-results/supplies/quote-validation');
});
