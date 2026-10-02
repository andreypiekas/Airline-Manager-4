import { Page } from '@playwright/test';
import type { QuoteIdentity } from './quote-reader';

export interface RouteMutationControlEvidence {
  observed:boolean;
  source:'jquery-direct-click'|'unavailable';
  endpointVerified:boolean;
  targetVerified:boolean;
  aircraftIdMatchesContext:boolean;
  airportIdMatchesContext:boolean;
  registrationInputVerified:boolean;
  seatInputsVerified:boolean;
  endCostIndexVerified:boolean;
  nonCharterBranchVerified:boolean;
  charterBranchObserved:boolean;
  stopoverIds:number[];
  ferryModes:number[];
  directRouteVerified:boolean;
  nativeClickReady:boolean;
  shape:string|null;
  mutationAuthorized:false;
}

const empty=():RouteMutationControlEvidence=>({
  observed:false,source:'unavailable',endpointVerified:false,targetVerified:false,
  aircraftIdMatchesContext:false,airportIdMatchesContext:false,
  registrationInputVerified:false,seatInputsVerified:false,endCostIndexVerified:false,
  nonCharterBranchVerified:false,charterBranchObserved:false,stopoverIds:[],ferryModes:[],directRouteVerified:false,nativeClickReady:false,
  shape:null,mutationAuthorized:false
});

const safeShape=(source:string)=>{
  const cleaned=source.replace(/\/\*[\s\S]*?\*\//g,'');
  return cleaned
    .replace(/([?&](?:mode|id|airportId|stopoverId|ferry|charter))=\d+/g,'$1=#')
    .replace(/\d+/g,'#')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,1200);
};

export function inspectRouteMutationHandlerSource(
  source:string|null,
  expected:{aircraftId:string;airportId:string}
):RouteMutationControlEvidence{
  const result=empty();
  if(!source||!/^[1-9]\d*$/.test(expected.aircraftId)||!/^[1-9]\d*$/.test(expected.airportId))return result;

  const active=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
  const calls=[...active.matchAll(
    /Ajax\('new_route_info\.php\?mode=(do)&id=(\d+)&airportId=(\d+)&reg='\+reg\+'&e='\+eSeat\+'&b='\+bSeat\+'&f='\+fSeat\+'&endCostIndex='\+endCostIndex\+'&stopoverId=(\d+)&ferry=(\d+)(?:&charter=(\d+)&cycles='\+cCycles\+')?&intro='\+intro,'routeNewAction',this,false,true\);/g
  )];

  const endpointVerified=calls.length>=1;
  const targetVerified=calls.length>=1;
  const aircraftIdMatchesContext=calls.length>=1&&calls.every(m=>m[2]===expected.aircraftId);
  const airportIdMatchesContext=calls.length>=1&&calls.every(m=>m[3]===expected.airportId);
  const registrationInputVerified=active.includes("varreg=$('#routeReg').val();")&&active.includes('if(reg.length>0)');
  const seatInputsVerified=
    active.includes("vareSeat=$('#eSeat').val();")&&
    active.includes("varbSeat=$('#bSeat').val();")&&
    active.includes("varfSeat=$('#fSeat').val();")&&
    active.includes('if(eSeat>0&&bSeat>0&&fSeat>0)');
  const endCostIndexVerified=active.includes("+'&endCostIndex='+endCostIndex");
  const nonCharterBranchVerified=calls.some(m=>m[6]===undefined);
  const charterBranchObserved=calls.some(m=>m[6]!==undefined);
  const stopoverIds=[...new Set(calls.map(m=>Number(m[4])).filter(Number.isSafeInteger))];
  const ferryModes=[...new Set(calls.map(m=>Number(m[5])).filter(Number.isSafeInteger))];
  const directRouteVerified=stopoverIds.length===1&&stopoverIds[0]===0&&ferryModes.length===1&&ferryModes[0]===0;
  const contextGuards=active.includes('isItrouteClick=false;')&&active.includes('addAirpAndHubs();')&&active.includes('$(this).remove();');

  const nativeClickReady=[
    endpointVerified,targetVerified,aircraftIdMatchesContext,airportIdMatchesContext,
    registrationInputVerified,seatInputsVerified,endCostIndexVerified,
    nonCharterBranchVerified,contextGuards
  ].every(Boolean);

  return {
    observed:true,source:'jquery-direct-click',endpointVerified,targetVerified,
    aircraftIdMatchesContext,airportIdMatchesContext,registrationInputVerified,
    seatInputsVerified,endCostIndexVerified,nonCharterBranchVerified,charterBranchObserved,
    stopoverIds,ferryModes,directRouteVerified,nativeClickReady,shape:safeShape(source),mutationAuthorized:false
  };
}

export async function readRouteMutationControl(page:Page,identity:QuoteIdentity):Promise<RouteMutationControlEvidence>{
  try{
    const button=page.locator('#newRouteInfo #btnCreateNewRoute');
    if(await button.count()!==1||!await button.isVisible()||!await button.isEnabled())return empty();
    const sources=await button.evaluate((el)=>{
      const jq=(window as any).jQuery||(window as any).$;
      if(!jq||typeof jq._data!=='function')return [] as string[];
      const events=jq._data(el,'events');
      const clicks=Array.isArray(events?.click)?events.click:[];
      return clicks.flatMap((item:any)=>{
        if(item?.selector)return [];
        try{
          const source=Function.prototype.toString.call(item.handler);
          return source.includes('new_route_info.php')?[source]:[];
        }catch{return [];}
      });
    });
    if(sources.length!==1)return empty();
    return inspectRouteMutationHandlerSource(sources[0],identity);
  }catch{
    return empty();
  }
}
