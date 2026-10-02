import { Page } from '@playwright/test';

export interface AutopriceFunctionEvidence {
  observed:boolean;
  functionName:'autoPrice'|'unavailable';
  sourceLength:number;
  networkMutationObserved:boolean;
  formTargets:{economy:boolean;business:boolean;first:boolean};
  jqueryValueWrites:boolean;
  numericConstants:number[];
  modelIds:number[];
  shape:string|null;
  comparisonReady:false;
  mutationAuthorized:false;
}

const unavailable=():AutopriceFunctionEvidence=>({
  observed:false,functionName:'unavailable',sourceLength:0,networkMutationObserved:false,
  formTargets:{economy:false,business:false,first:false},jqueryValueWrites:false,
  numericConstants:[],modelIds:[],shape:null,comparisonReady:false,mutationAuthorized:false
});

const sanitize=(source:string)=>{
  return source
    .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\s)]+)/g,'$1=<value>')
    .replace(/[A-Fa-f0-9]{24,}/g,'<token>')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,5000);
};

export function inspectAutopriceFunctionSource(source:string|null):AutopriceFunctionEvidence{
  if(!source||!/^function\s+autoPrice\s*\(/.test(source.trim()))return unavailable();

  const networkMutationObserved=
    /\bAjax\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\$\s*\.\s*ajax\s*\(|\baxios\b/i.test(source);
  const economy=/#eSeat\b|['"]eSeat['"]/.test(source);
  const business=/#bSeat\b|['"]bSeat['"]/.test(source);
  const first=/#fSeat\b|['"]fSeat['"]/.test(source);
  const jqueryValueWrites=/\.val\s*\(/.test(source);
  const numericConstants=[...new Set(Array.from(source.matchAll(/(?:^|[^A-Za-z0-9_.])(\d+(?:\.\d+)?)(?![A-Za-z0-9_.])/g),m=>Number(m[1]))
    .filter(n=>Number.isFinite(n)&&n>=0&&n<=1_000_000))].slice(0,80);
  const modelIds=[...new Set(Array.from(source.matchAll(/(?:model|modelId|type|acType)\s*(?:==|===|!=|!==)\s*(\d+)/gi),m=>Number(m[1]))
    .filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,40);

  return {
    observed:true,functionName:'autoPrice',sourceLength:source.length,networkMutationObserved,
    formTargets:{economy,business,first},jqueryValueWrites,numericConstants,modelIds,
    shape:sanitize(source),comparisonReady:false,mutationAuthorized:false
  };
}

/** Passive only: stringify the already-loaded client function; never invoke it. */
export async function readAutopriceFunctionEvidence(page:Page):Promise<AutopriceFunctionEvidence>{
  try{
    const source=await page.evaluate(()=>{
      const fn=(window as any).autoPrice;
      if(typeof fn!=='function')return null;
      return Function.prototype.toString.call(fn);
    });
    return inspectAutopriceFunctionSource(source);
  }catch{
    return unavailable();
  }
}
