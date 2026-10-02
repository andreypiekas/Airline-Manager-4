import {expect, Page} from '@playwright/test';
import {closeReadOnlyPopup} from '../optimization/cost-reference-reader';
import {Commodity, SupplySnapshot} from './policy';
const normalize=(s:string)=>s.replace(/\s/g,'');
export const purchaseCallback=(kind:Commodity)=>`Ajax('${kind}.php?mode=do&amount='+$('#amountInput').val(),'runme',this); playSound('currency_spend')`;
export function parseAmount(text:string):number {
 const s=text.trim().replace(/^\$\s*/,'');
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw Error('SUPPLY_NUMBER_INVALID');
 const n=Number(s.replace(/,/g,''));if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER)throw Error('SUPPLY_NUMBER_INVALID');return n;
}
export function parseSupplyText(text:string,kind:Commodity,balance:number):SupplySnapshot {
 const price=text.match(kind==='fuel'?/CURRENT PRICE\s+\$\s*([\d,]+)\s+PRICE CHANGE/i:/QUOTA COST\s+\$\s*([\d,]+)\s+PRICE CHANGE/i);
 const capacity=text.match(/CAPACITY\s+([\d,]+)\s*\/\s*([\d,]+)\s+(Lbs|Quotas)/i);
 const holding=text.match(/HOLDING\s+([\d,]+)\s+(Lbs|Quotas)/i);
 const unit=kind==='fuel'?'lbs':'quotas';
 if(!price||!capacity||!holding||capacity[3].toLowerCase()!==unit||holding[2].toLowerCase()!==unit)throw Error('SUPPLY_DATA_UNVERIFIED');
 const remainingCapacity=parseAmount(capacity[1]),total=parseAmount(capacity[2]),stock=parseAmount(holding[1]);
 if(total!==remainingCapacity+stock)throw Error('SUPPLY_CAPACITY_INCONSISTENT');
 return {pricePer1000:parseAmount(price[1]),holding:stock,remainingCapacity,balance};
}
export class SupplyPort {
 constructor(private page:Page,private timeout=10000){}
 async open(kind:Commodity){
  await closeReadOnlyPopup(this.page,this.timeout);
  const menu=this.page.locator('#smallMainMenu').getByText('Fuel',{exact:true}).locator('../..');
  if(await menu.count()!==1||!await menu.isVisible()||normalize(await menu.getAttribute('onclick')||'')!=="hideAllWhenClick();popup('fuel.php','Fuel',false,false,true);")throw Error('SUPPLY_MENU_UNVERIFIED');
  await menu.click({timeout:this.timeout});
  await this.page.locator('#fuelMain').getByText('Current price',{exact:true}).waitFor({timeout:this.timeout});
  if(kind==='co2'){
   const tab=this.page.locator('#popBtn2');
   const expected="$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('co2.php','fuelMain',this,false,false);";
   await expect.poll(async()=>{
    if(await tab.count()!==1||!await tab.isVisible())return false;
    return normalize(await tab.getAttribute('onclick')||'')===normalize(expected);
   },{timeout:this.timeout}).toBe(true);
   await tab.click({timeout:this.timeout});
   await this.page.locator('#fuelMain').getByText('Quota cost',{exact:true}).waitFor({timeout:this.timeout});
  }
 }
 async snapshot(kind:Commodity):Promise<SupplySnapshot>{
  const panel=this.page.locator('#fuelMain'),account=this.page.locator('#headerAccount');
  if(await panel.count()!==1||!await panel.isVisible()||await account.count()!==1||!await account.isVisible())throw Error('SUPPLY_PANEL_UNVERIFIED');
  const label=kind==='fuel'?'Fuel price per 1,000 Lbs':'Co2 quota cost per 1,000';
  if(await panel.getByText(label,{exact:true}).count()!==1)throw Error('SUPPLY_UNIT_UNVERIFIED');
  return parseSupplyText(await panel.innerText(),kind,parseAmount(await account.innerText()));
 }
 async verifyControl(kind:Commodity){
  const panel=this.page.locator('#fuelMain');
  const button=panel.getByRole('button',{name:/^(?:\S\s*)?Purchase$/i});
  const input=panel.getByPlaceholder('Amount to purchase',{exact:true});
  if(await button.count()!==1||!await button.isVisible()||!await button.isEnabled()||
   normalize(await button.getAttribute('onclick')||'')!==normalize(purchaseCallback(kind))||
   await input.count()!==1||await input.getAttribute('id')!=='amountInput'||await input.getAttribute('type')!=='tel')throw Error('SUPPLY_PURCHASE_CONTROL_UNVERIFIED');
  return {button,input};
 }
 async quote(kind:Commodity,quantity:number){
  const {input}=await this.verifyControl(kind);
  await input.fill(String(quantity),{timeout:this.timeout});await input.press('ArrowRight',{timeout:this.timeout});
  const expected=(await this.snapshot(kind)).pricePer1000*quantity/1000;
  const read=async()=>{
   const text=await this.page.locator('#fuelMain').innerText();const match=text.match(/TOTAL PRICE\s+\$\s*([\d,.]+)\s+AMOUNT TO PURCHASE/i);
   if(!match)throw Error('SUPPLY_QUOTE_MISSING');return parseAmount(match[1]);
  };
  await expect.poll(async()=>Math.abs(await read()-expected)<1,{timeout:this.timeout}).toBe(true);
  return read();
 }
 async purchase(kind:Commodity,quantity:number,before:SupplySnapshot,quote:number){
  const {button,input}=await this.verifyControl(kind);
  if(await input.inputValue()!==String(quantity))throw Error('SUPPLY_AMOUNT_CHANGED');
  const fresh=await this.snapshot(kind);
  if(JSON.stringify(fresh)!==JSON.stringify(before))throw Error('SUPPLY_SNAPSHOT_CHANGED');
  // Avoid a market rollover while the native request is being dispatched.
  const clock=(await this.page.locator('#fuelMain').innerText()).match(/PRICE CHANGE\s+(\d{2}):(\d{2}):(\d{2})/i);
  if(!clock||Number(clock[1])*3600+Number(clock[2])*60+Number(clock[3])<10)throw Error('SUPPLY_PRICE_ROLLOVER');
  const response=this.page.waitForResponse(r=>{
   const u=new URL(r.url());return u.origin==='https://www.airlinemanager.com'&&u.pathname===`/${kind}.php`&&u.searchParams.get('mode')==='do'&&u.searchParams.get('amount')===String(quantity);
  },{timeout:this.timeout}).catch(()=>null);
  // No retries from this point. The caller has already persisted its intent.
  await button.click({timeout:this.timeout});
  const received=await response;if(!received||!received.ok())throw Error('SUPPLY_OUTCOME_UNKNOWN');
  if(await received.finished())throw Error('SUPPLY_OUTCOME_UNKNOWN');
  await this.open(kind);
  const after=await this.snapshot(kind);
  if(after.holding!==before.holding+quantity||after.remainingCapacity!==before.remainingCapacity-quantity||
    Math.abs((before.balance-after.balance)-quote)>1)throw Error('SUPPLY_OUTCOME_UNKNOWN');
  return after;
 }
 async close(){await closeReadOnlyPopup(this.page,this.timeout);}
}
