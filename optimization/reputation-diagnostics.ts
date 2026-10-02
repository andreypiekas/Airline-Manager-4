import { Page } from '@playwright/test';

export interface ReputationDiagnostic {
  observedAt:string;
  status:'observed'|'unavailable';
  entries:Array<{text:string;tag:string;id:string|null;title:string|null;ariaLabel:string|null}>;
  parsedPercentages:number[];
  comparisonReady:false;
  mutationAuthorized:false;
}

/**
 * Passive inventory of visible reputation labels. It intentionally does not
 * infer which percentage is the passenger reputation until the live UI shape
 * is observed and covered by a strict parser.
 */
export async function readReputationDiagnostics(page:Page):Promise<ReputationDiagnostic>{
  const base:ReputationDiagnostic={
    observedAt:new Date().toISOString(),status:'unavailable',entries:[],parsedPercentages:[],
    comparisonReady:false,mutationAuthorized:false
  };
  try{
    const entries=await page.locator('body *').evaluateAll(elements=>elements.flatMap(e=>{
      if(!e.getClientRects().length)return [];
      const text=((e as HTMLElement).innerText||'').replace(/\s+/g,' ').trim();
      const title=(e.getAttribute('title')||'').replace(/\s+/g,' ').trim();
      const aria=(e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
      const hay=[text,title,aria].join(' ');
      if(!/reputation/i.test(hay))return [];
      if(text.length>180||title.length>120||aria.length>120)return [];
      return [{text:text.slice(0,180),tag:e.tagName.toLowerCase(),id:e.id?.slice(0,100)||null,
        title:title.slice(0,120)||null,ariaLabel:aria.slice(0,120)||null}];
    }));
    const unique=[] as ReputationDiagnostic['entries'];const seen=new Set<string>();
    for(const e of entries){
      const key=JSON.stringify(e);if(seen.has(key))continue;seen.add(key);unique.push(e);
      if(unique.length>=20)break;
    }
    const percentages=[...new Set(unique.flatMap(e=>Array.from(
      [e.text,e.title||'',e.ariaLabel||''].join(' ').matchAll(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/g),
      m=>Number(m[1])
    )).filter(n=>Number.isFinite(n)&&n>=0&&n<=100))];
    return {...base,status:unique.length?'observed':'unavailable',entries:unique,parsedPercentages:percentages};
  }catch{return base;}
}
