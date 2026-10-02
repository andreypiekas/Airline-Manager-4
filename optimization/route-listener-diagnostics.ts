import { Page } from '@playwright/test';

export interface RouteListenerDiagnostic {
  scope:'panel'|'document'|'element';
  source:'dom-listener'|'jquery-event';
  event:string;
  selector:string|null;
  elementTag:string|null;
  elementId:string|null;
  elementLabel:string|null;
  handlerShape:string|null;
  handlerTailShape:string|null;
  sourceLength:number;
  phpEndpoints:string[];
  ajaxTargets:string[];
  functionCalls:string[];
  routeStringShapes:string[];
}

const sanitize=(value:string|null)=>{
  if(!value)return null;
  return value
    .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\\s)]+)/g,'$1=<value>')
    .replace(/[A-Fa-f0-9]{24,}/g,'<token>')
    .replace(/\\d+/g,'#')
    .replace(/\\s+/g,' ')
    .trim()
    .slice(0,1800);
};
const sanitizeTail=(value:string|null)=>{
  if(!value)return null;
  const tail=value.length>1800?value.slice(-1800):value;
  return sanitize(tail);
};
const endpoints=(value:string|null)=>value
  ? [...new Set(Array.from(value.matchAll(/([A-Za-z0-9_-]+\\.php)(?:\\?|['"\\s]|$)/g),m=>m[1]))].slice(0,10)
  : [];

/**
 * Chromium-only passive listener inspection. It reads both DevTools listeners
 * and jQuery's registered event table without invoking any handler. Only
 * redacted handler shapes, selectors and endpoint names are returned.
 */
export async function readRouteListenerDiagnostics(page:Page):Promise<RouteListenerDiagnostic[]>{
  let session:any=null;
  try{
    session=await page.context().newCDPSession(page);
    const expression=[
      '(()=>{',
      "const safeLabel=e=>(((e&&e.innerText)||(e&&e.value)||(e&&e.getAttribute&&e.getAttribute('aria-label'))||(e&&e.getAttribute&&e.getAttribute('title'))||'')+'').replace(/\\\\s+/g,' ').trim().slice(0,120);",
      'const rows=[];',
      "const row=(sourceKind,scope,event,e,handlerSource,selector=null)=>rows.push({sourceKind,scope,event,selector:selector?String(selector).slice(0,200):null,elementTag:(e&&e.tagName||'').toLowerCase()||null,elementId:(e&&e.id||'').slice(0,100)||null,elementLabel:safeLabel(e)||null,handlerSource:(handlerSource||'').slice(0,20000),sourceLength:(handlerSource||'').length});",
      "const pushDom=(scope,e)=>{if(!e||!e.getClientRects||(!e.getClientRects().length&&e!==document))return;let listeners={};try{listeners=getEventListeners(e)||{};}catch{return;}for(const event of ['click','submit'])for(const item of (listeners[event]||[]).slice(0,10)){let source='';try{source=Function.prototype.toString.call(item.listener);}catch{}row('dom-listener',scope,event,e,source,null);}};",
      "const pushJq=(scope,e)=>{if(!e)return;const jq=window.jQuery||window.$;if(!jq||typeof jq._data!=='function')return;let events=null;try{events=jq._data(e,'events');}catch{return;}if(!events)return;for(const event of ['click','submit'])for(const item of (events[event]||[]).slice(0,15)){let source='';try{source=Function.prototype.toString.call(item.handler);}catch{}row('jquery-event',scope,event,e,source,item.selector||null);}};",
      "const push=(scope,e)=>{pushDom(scope,e);pushJq(scope,e);};",
      "const panel=document.querySelector('#newRouteInfo');",
      "if(panel){push('panel',panel);const candidates=Array.from(panel.querySelectorAll('button,a,input,[role=\\\"button\\\"],[onclick],form,[data-action],[data-id],[data-route],[data-airport]')).filter(e=>e.getClientRects().length);for(const e of candidates.slice(0,50))push('element',e);}",
      "push('document',document);",
      'return rows.slice(0,100);',
      '})()'
    ].join('');
    const result:any=await session.send('Runtime.evaluate',{
      expression,returnByValue:true,includeCommandLineAPI:true,awaitPromise:false
    });
    const rows=Array.isArray(result?.result?.value)?result.result.value:[];
    const diagnostics:RouteListenerDiagnostic[]=rows.flatMap((row:any):RouteListenerDiagnostic[]=>{
      const source=typeof row?.handlerSource==='string'?row.handlerSource:null;
      const shape=sanitize(source);
      if(!shape)return [];
      const selector=typeof row?.selector==='string'?sanitize(row.selector):null;
      const relevant=/route|create|new|flight|airport|ajax|submit|save|reroute/i.test(shape)||
        /route|create|new|save/i.test(String(row?.elementLabel||''))||
        /route|create|new|save/i.test(selector||'');
      if(!relevant)return [];
      const ajaxTargets=source
        ? [...new Set(Array.from(source.matchAll(/Ajax\\([^,]+,\\s*['"]([A-Za-z_][A-Za-z0-9_-]{0,80})['"]/g), (m:RegExpMatchArray)=>m[1]))].slice(0,20)
        : [];
      const functionCalls=source
        ? [...new Set(Array.from(source.matchAll(/(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*)\\s*\\(/g), (m:RegExpMatchArray)=>m[1]))]
            .filter(x=>!['if','for','while','switch','function','return'].includes(x))
            .slice(0,40)
        : [];
      const routeStringShapes=source
        ? Array.from(source.matchAll(/(['"])([^'"\\n\\r]{1,300})\\1/g), (m:RegExpMatchArray)=>m[2])
            .filter(x=>/route|create|airport|flight|ajax|php/i.test(x))
            .map(x=>sanitize(x)!)
            .filter(Boolean)
            .slice(0,30)
        : [];
      return [{
        scope:['panel','document','element'].includes(row.scope)?row.scope:'element',
        source:row.sourceKind==='jquery-event'?'jquery-event':'dom-listener',
        event:typeof row.event==='string'?row.event.slice(0,30):'unknown',
        selector,
        elementTag:typeof row.elementTag==='string'?row.elementTag.slice(0,30):null,
        elementId:typeof row.elementId==='string'?row.elementId.slice(0,100):null,
        elementLabel:typeof row.elementLabel==='string'?row.elementLabel.slice(0,120):null,
        handlerShape:shape,
        handlerTailShape:sanitizeTail(source),
        sourceLength:Number.isSafeInteger(row?.sourceLength)&&row.sourceLength>=0?row.sourceLength:(source?.length||0),
        phpEndpoints:endpoints(source),
        ajaxTargets,
        functionCalls,
        routeStringShapes
      } as RouteListenerDiagnostic];
    });
    const seen=new Set<string>();
    return diagnostics.filter(d=>{
      const key=JSON.stringify(d);
      if(seen.has(key))return false;
      seen.add(key);return true;
    }).slice(0,50);
  }catch{return [];}
  finally{try{await session?.detach();}catch{}}
}
