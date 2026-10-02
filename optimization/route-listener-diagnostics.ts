import { Page } from '@playwright/test';

export interface RouteListenerDiagnostic {
  scope:'panel'|'document'|'element';
  event:string;
  elementTag:string|null;
  elementId:string|null;
  elementLabel:string|null;
  handlerShape:string|null;
  phpEndpoints:string[];
}

const sanitize=(value:string|null)=>{
  if(!value)return null;
  return value
    .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\\s)]+)/g,'$1=<value>')
    .replace(/[A-Fa-f0-9]{24,}/g,'<token>')
    .replace(/\\d+/g,'#')
    .replace(/\\s+/g,' ')
    .trim()
    .slice(0,500);
};
const endpoints=(value:string|null)=>value
  ? [...new Set(Array.from(value.matchAll(/([A-Za-z0-9_-]+\\.php)(?:\\?|['"\\s]|$)/g),m=>m[1]))].slice(0,10)
  : [];

/**
 * Chromium-only passive listener inspection. It uses the DevTools command-line
 * API to read registered click listeners without invoking them. Only redacted
 * handler shapes and endpoint names are returned.
 */
export async function readRouteListenerDiagnostics(page:Page):Promise<RouteListenerDiagnostic[]>{
  let session:any=null;
  try{
    session=await page.context().newCDPSession(page);
    const expression=[
      '(()=>{',
      "const safeLabel=e=>(((e&&e.innerText)||(e&&e.value)||(e&&e.getAttribute&&e.getAttribute('aria-label'))||(e&&e.getAttribute&&e.getAttribute('title'))||'')+'').replace(/\\\\s+/g,' ').trim().slice(0,120);",
      'const rows=[];',
      "const push=(scope,e)=>{if(!e||!e.getClientRects||!e.getClientRects().length)return;let listeners={};try{listeners=getEventListeners(e)||{};}catch{return;}for(const event of ['click','submit']){const list=listeners[event]||[];for(const item of list.slice(0,10)){let source='';try{source=Function.prototype.toString.call(item.listener);}catch{}rows.push({scope,event,elementTag:(e.tagName||'').toLowerCase()||null,elementId:(e.id||'').slice(0,100)||null,elementLabel:safeLabel(e)||null,handlerSource:source.slice(0,2000)});}}};",
      "const panel=document.querySelector('#newRouteInfo');",
      "if(panel){push('panel',panel);const candidates=Array.from(panel.querySelectorAll('button,a,input,[role=\\\"button\\\"],[onclick],form,[data-action],[data-id],[data-route],[data-airport]')).filter(e=>e.getClientRects().length);for(const e of candidates.slice(0,40))push('element',e);}",
      "push('document',document);",
      'return rows.slice(0,60);',
      '})()'
    ].join('');
    const result:any=await session.send('Runtime.evaluate',{
      expression,returnByValue:true,includeCommandLineAPI:true,awaitPromise:false
    });
    const rows=Array.isArray(result?.result?.value)?result.result.value:[];
    return rows.flatMap((row:any)=>{
      const source=typeof row?.handlerSource==='string'?row.handlerSource:null;
      const shape=sanitize(source);
      if(!shape)return [];
      const relevant=/route|create|new|flight|airport|ajax|submit|save|reroute/i.test(shape)||/route|create|new|save/i.test(String(row?.elementLabel||''));
      if(!relevant)return [];
      return [{
        scope:['panel','document','element'].includes(row.scope)?row.scope:'element',
        event:typeof row.event==='string'?row.event.slice(0,30):'unknown',
        elementTag:typeof row.elementTag==='string'?row.elementTag.slice(0,30):null,
        elementId:typeof row.elementId==='string'?row.elementId.slice(0,100):null,
        elementLabel:typeof row.elementLabel==='string'?row.elementLabel.slice(0,120):null,
        handlerShape:shape,
        phpEndpoints:endpoints(source)
      } as RouteListenerDiagnostic];
    }).slice(0,30);
  }catch{return [];}
  finally{try{await session?.detach();}catch{}}
}
