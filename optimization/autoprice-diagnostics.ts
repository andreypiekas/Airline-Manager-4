import { Page } from '@playwright/test';
import type { Cabins } from '../demand/types';

export interface AutopriceFunctionEvidence {
  observed:boolean;
  functionName:'autoPrice'|'unavailable';
  sourceLength:number;
  networkMutationObserved:boolean;
  networkEndpoints:string[];
  pricingMutationNetworkObserved:boolean;
  formTargets:{economy:boolean;business:boolean;first:boolean};
  jqueryValueWrites:boolean;
  numericConstants:number[];
  modelIds:number[];
  fareTransformVerified:boolean;
  vipModelIds:number[];
  vipMultiplier:number|null;
  shape:string|null;
  comparisonReady:false;
  mutationAuthorized:false;
}

const unavailable=():AutopriceFunctionEvidence=>({
  observed:false,functionName:'unavailable',sourceLength:0,networkMutationObserved:false,
  networkEndpoints:[],pricingMutationNetworkObserved:false,
  formTargets:{economy:false,business:false,first:false},jqueryValueWrites:false,
  numericConstants:[],modelIds:[],fareTransformVerified:false,vipModelIds:[],vipMultiplier:null,
  shape:null,comparisonReady:false,mutationAuthorized:false
});

const sanitize=(source:string)=>{
  return source
    .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\s)]+)/g,'$1=<value>')
    .replace(/[A-Fa-f0-9]{24,}/g,'<token>')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,5000);
};

const unique=(values:string[])=>[...new Set(values)];

export function inspectAutopriceFunctionSource(source:string|null):AutopriceFunctionEvidence{
  if(!source||!/^function\s+autoPrice\s*\(/.test(source.trim()))return unavailable();

  const networkEndpoints=unique(Array.from(source.matchAll(/['"]([A-Za-z0-9_-]+\.php)(?:\?[^'"]*)?['"]/g),m=>m[1])).slice(0,20);
  const networkMutationObserved=
    /\bAjax\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\$\s*\.\s*ajax\s*\(|\baxios\b/i.test(source);
  // The observed AM4 autoPrice may log onboarding progress through ddna_logger.php.
  // That telemetry call does not save route fares; any other network endpoint keeps
  // the pricing-network gate closed.
  const pricingMutationNetworkObserved=networkEndpoints.some(x=>x!=='ddna_logger.php')||
    (networkMutationObserved&&networkEndpoints.length===0);

  const economy=/#eSeat\b|['"]eSeat['"]/.test(source);
  const business=/#bSeat\b|['"]bSeat['"]/.test(source);
  const first=/#fSeat\b|['"]fSeat['"]/.test(source);
  const jqueryValueWrites=/\.val\s*\(/.test(source);
  const numericConstants=[...new Set(Array.from(source.matchAll(/(?:^|[^A-Za-z0-9_.])(\d+(?:\.\d+)?)(?![A-Za-z0-9_.])/g),m=>Number(m[1]))
    .filter(n=>Number.isFinite(n)&&n>=0&&n<=1_000_000))].slice(0,80);

  const compact=source.replace(/\s+/g,'');
  const signature=compact.match(/^functionautoPrice\(([$A-Za-z_][\w$]*),([$\w]+),([$\w]+),([$\w]+)\)\{/);
  const vip=signature?compact.match(
    /^functionautoPrice\([^)]+\)\{\[([0-9]+(?:,[0-9]+)+)\]\.includes\(([$A-Za-z_][\w$]*)\)&&\(([$A-Za-z_][\w$]*)=Math\.ceil\((\d+(?:\.\d+)?)\*([$\w]+)\),([$\w]+)=Math\.ceil\((\d+(?:\.\d+)?)\*([$\w]+)\),([$\w]+)=Math\.ceil\((\d+(?:\.\d+)?)\*([$\w]+)\)\),/
  ):null;

  let fareTransformVerified=false;
  let vipModelIds:number[]=[];
  let vipMultiplier:number|null=null;
  if(signature&&vip){
    const params=signature.slice(1,5);
    const ids=vip[1].split(',').map(Number);
    const multipliers=[Number(vip[4]),Number(vip[7]),Number(vip[10])];
    const assignments=[vip[3],vip[6],vip[9]];
    const operands=[vip[5],vip[8],vip[11]];
    const targetWrites=
      compact.includes('$("#eSeat").val('+params[0]+')')&&
      compact.includes('$("#bSeat").val('+params[1]+')')&&
      compact.includes('$("#fSeat").val('+params[2]+')');
    fareTransformVerified=
      vip[2]===params[3]&&
      assignments.every((v,i)=>v===params[i])&&
      operands.every((v,i)=>v===params[i])&&
      multipliers.every(v=>v===multipliers[0]&&Number.isFinite(v)&&v>0)&&
      ids.every(Number.isSafeInteger)&&ids.every(v=>v>0)&&targetWrites&&
      economy&&business&&first&&jqueryValueWrites&&!pricingMutationNetworkObserved;
    if(fareTransformVerified){
      vipModelIds=ids;
      vipMultiplier=multipliers[0];
    }
  }

  return {
    observed:true,functionName:'autoPrice',sourceLength:source.length,networkMutationObserved,
    networkEndpoints,pricingMutationNetworkObserved,
    formTargets:{economy,business,first},jqueryValueWrites,numericConstants,
    modelIds:[...vipModelIds],fareTransformVerified,vipModelIds,vipMultiplier,
    shape:sanitize(source),comparisonReady:false,mutationAuthorized:false
  };
}

export function effectiveAutopriceBase(
  base:Cabins,
  modelId:number,
  evidence:AutopriceFunctionEvidence|undefined
):Cabins|null{
  if(!evidence?.fareTransformVerified||!Number.isSafeInteger(modelId)||modelId<=0||
    !(['Y','J','F'] as const).every(k=>Number.isSafeInteger(base[k])&&base[k]>=0))return null;
  if(!evidence.vipModelIds.includes(modelId))return {...base};
  if(typeof evidence.vipMultiplier!=='number'||!Number.isFinite(evidence.vipMultiplier)||evidence.vipMultiplier<=0)return null;
  return {
    Y:Math.ceil(base.Y*evidence.vipMultiplier),
    J:Math.ceil(base.J*evidence.vipMultiplier),
    F:Math.ceil(base.F*evidence.vipMultiplier)
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
