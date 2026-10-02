import { Page } from '@playwright/test';

export interface RouteQuoteFieldDiagnostic {
  tag:string;
  id:string|null;
  label:string|null;
  title:string|null;
  classShape:string|null;
}

/**
 * Passive inventory of visible route-quote fields that may carry operational
 * evidence (runway, airport, fees, fuel, time, demand). It never clicks, fills,
 * evaluates handlers or persists arbitrary hidden values.
 */
export async function readRouteQuoteFieldDiagnostics(page:Page):Promise<RouteQuoteFieldDiagnostic[]>{
  try{
    const panel=page.locator('#newRouteInfo');
    if(await panel.count()!==1||!await panel.isVisible())return [];
    return await panel.locator('div,span,b,td,th,label,input,button').evaluateAll(elements=>{
      const normalize=(s:string|null|undefined)=>String(s||'').replace(/\s+/g,' ').trim();
      const relevant=/(runway|rwy|feet|\bft\b|airport|route|fee|fuel|co2|distance|time|duration|cost|index|seat|demand|pax|passenger|km\b|lbs?\b)/i;
      const rows:any[]=[];
      for(const e of elements){
        if(!e.getClientRects().length)continue;
        const text=normalize((e as HTMLElement).innerText||e.textContent);
        const value=e instanceof HTMLInputElement?normalize(e.value):'';
        const title=normalize(e.getAttribute('title')||e.getAttribute('aria-label'));
        const id=normalize(e.getAttribute('id'));
        const hay=[text,value,title,id].filter(Boolean).join(' ');
        if(!relevant.test(hay))continue;
        rows.push({
          tag:e.tagName.toLowerCase(),
          id:id.slice(0,100)||null,
          label:(text||value).slice(0,180)||null,
          title:title.slice(0,120)||null,
          classShape:normalize(e.getAttribute('class')).slice(0,160)||null
        });
        if(rows.length>=80)break;
      }
      return rows;
    });
  }catch{return [];}
}
