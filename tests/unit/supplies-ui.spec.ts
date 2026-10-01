import {test,expect,Page} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SupplyPort,parseSupplyText,purchaseCallback} from '../../supplies/port';
import {runSupplies} from '../../supplies/run';
const env={ENABLE_DEMAND_MANAGER:'true',DEMAND_FAIL_SAFE:'true',DEMAND_POOL_SCOPE:'airport-pair',DEMAND_EXECUTION_ACK:'individual-return-legs-v1',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'andreypiekas/Airline-Manager-4',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',MAX_FUEL_PRICE:'550',MAX_CO2_PRICE:'120'};
async function fixture(page:Page,variant=''){
 await page.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.searchParams.get('mode')==='do'){await r.fulfill({status:variant==='httpfail'?500:200,body:'ok'});return;}
  await r.fulfill({body:'<html></html>',contentType:'text/html'});
 });
 await page.goto('https://www.airlinemanager.com/synthetic');
 await page.setContent(`<span id="headerAccount">100000</span><div id="smallMainMenu"><div onclick="hideAllWhenClick();popup('fuel.php','Fuel',false,false,true);"><div><span>Fuel</span></div></div></div><div><span id="popTitle" style="display:none">Fuel</span><button onclick="closePop();document.getElementById('rewardPopup').style.display='none';">Close</button></div><div id="rewardPopup"></div><button id="popBtn2"></button><div id="fuelMain" style="display:none"></div><script>
 const variant=${JSON.stringify(variant)};let kind='fuel';window.purchases=0;let amount=1000;let stock={fuel:1000,co2:1000};let cash=100000;
 function price(){return variant==='expensive'?2000:kind==='fuel'?500:100}
 function $(s){return {val(){return document.querySelector(s).value},removeClass(){return this},addClass(){return this},hide(){return this}}}
 function playSound(){}function hideAllWhenClick(){}function closePop(){document.querySelector('#popTitle').style.display='none';document.querySelector('#fuelMain').style.display='none'}
 function render(){const unit=kind==='fuel'?'Lbs':'Quotas';const p=document.querySelector('#fuelMain');p.style.display='block';document.querySelector('#popTitle').style.display='block';document.querySelector('#headerAccount').textContent=String(cash);
 p.innerHTML='<div>'+(kind==='fuel'?'Current price':'Quota cost')+'</div><b>$ '+price()+'</b><div>PRICE CHANGE</div><span>00:15:00</span><div>CAPACITY</div><span>'+(10000-stock[kind])+' / 10000 '+unit+'</span><div>HOLDING</div><span>'+stock[kind]+' '+unit+'</span><div>TOTAL PRICE</div><span id="total">$'+price()+'</span><div>AMOUNT TO PURCHASE</div><input type="tel" id="amountInput" placeholder="Amount to purchase" value="1000"><button id="purchase">Purchase</button><div>'+(kind==='fuel'?'Fuel price per 1,000 Lbs':'Co2 quota cost per 1,000')+'</div>';
 document.querySelector('#purchase').setAttribute('onclick',variant==='callback'?'window.purchases++':kind==='fuel'?${JSON.stringify(purchaseCallback('fuel'))}:${JSON.stringify(purchaseCallback('co2'))});
 document.querySelector('#amountInput').onkeyup=()=>{document.querySelector('#total').textContent='$'+(Number(document.querySelector('#amountInput').value)*price()/1000)};
 document.querySelector('#popBtn2').setAttribute('onclick',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('co2.php','fuelMain',this,false,false);");}
 function popup(){kind='fuel';render()}
 async function Ajax(url){if(url==='co2.php'){kind='co2';render();return}window.purchases++;const qty=Number(new URL(url,location.href).searchParams.get('amount'));if(variant!=='unknown'&&variant!=='httpfail'){stock[kind]+=qty;cash-=qty*price()/1000;render()}await fetch('/'+url)}
 </script>`);
}
async function execute(page:Page,dryRun:boolean){const dir=await mkdtemp(join(tmpdir(),'am4-supply-'));return {dir,run:()=>runSupplies(page,dryRun,env,dir,new SupplyPort(page,800))};}
test('dry run quotes both supplies without a purchase',async({page})=>{await fixture(page);const {dir,run}=await execute(page,true);try{const r=await run();expect(r.entries.map(e=>e.status)).toEqual(['would_buy','would_buy']);expect(await page.evaluate(()=>(window as any).purchases)).toBe(0);}finally{await rm(dir,{recursive:true,force:true})}});
test('production confirms both stocks and payments, rejects duplicate execution',async({page})=>{await fixture(page);const {dir,run}=await execute(page,false);try{const r=await run();expect(r.entries.map(e=>e.status)).toEqual(['purchased','purchased']);expect(r.entries[1].before.balance).toBe(95500);await expect(run()).rejects.toThrow();expect(await page.evaluate(()=>(window as any).purchases)).toBe(2);}finally{await rm(dir,{recursive:true,force:true})}});
test('above-cap prices never touch purchase controls',async({page})=>{await fixture(page,'expensive');const {dir,run}=await execute(page,false);try{const r=await run();expect(r.entries.map(e=>e.reason)).toEqual(['PRICE_NOT_BELOW_LIMIT','PRICE_NOT_BELOW_LIMIT']);expect(await page.evaluate(()=>(window as any).purchases)).toBe(0);}finally{await rm(dir,{recursive:true,force:true})}});
for(const variant of ['callback','unknown','httpfail'])test(`blocks unverified or uncertain purchase: ${variant}`,async({page})=>{await fixture(page,variant);const {dir,run}=await execute(page,false);try{await expect(run()).rejects.toThrow('SUPPLY_HALTED');const r=JSON.parse(await readFile(join(dir,'supply-report.json'),'utf8'));expect(r.halted).toBe(true);expect(r.entries).toHaveLength(1);expect(await page.evaluate(()=>(window as any).purchases)).toBe(variant==='callback'?0:1);}finally{await rm(dir,{recursive:true,force:true})}});
test('missing panel and inconsistent storage are rejected',async({page})=>{await fixture(page);await expect(new SupplyPort(page,100).snapshot('fuel')).rejects.toThrow();expect(()=>parseSupplyText('CURRENT PRICE\n$ 500\nPRICE CHANGE\nCAPACITY\n900 / 1000 Lbs\nHOLDING\n200 Lbs','fuel',1000)).toThrow();});
test('real Actions reruns rejected before opening the supply menu',async({page})=>{await fixture(page);const dir=await mkdtemp(join(tmpdir(),'am4-supply-'));try{await expect(runSupplies(page,false,{...env,GITHUB_RUN_ATTEMPT:'2'},dir)).rejects.toThrow('RERUN');expect(await page.locator('#fuelMain').isVisible()).toBe(false);}finally{await rm(dir,{recursive:true,force:true})}});
