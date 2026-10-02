import type { ModelCostReference } from './cost-reference-reader';
import type { AircraftReferenceVariant } from './reference-data';

export interface ModelCommunityCrossCheck {
  modelId:number;
  source:'community-aircraft-reference';
  verified:boolean;
  fieldsMatched:string[];
  fieldsConflicted:string[];
  acquisitionCost:number|null;
  reason:string;
  mutationAuthorized:false;
}

const number=(s:string|undefined,pattern:RegExp)=>{
  const m=(s||'').match(pattern);if(!m)return null;
  const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null;
};
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'');

export function crossCheckCommunityAircraftReference(
  live:ModelCostReference,
  ref:AircraftReferenceVariant|null
):ModelCommunityCrossCheck {
  const base:ModelCommunityCrossCheck={
    modelId:live.modelId,source:'community-aircraft-reference',verified:false,
    fieldsMatched:[],fieldsConflicted:[],acquisitionCost:null,reason:'REFERENCE_UNAVAILABLE',mutationAuthorized:false
  };
  if(!ref||ref.modelId!==live.modelId||live.source!=='inspected-catalog'||!Array.isArray(live.catalogFields))
    return base;
  const fields=new Map(live.catalogFields.map(x=>[x.label.trim().toLowerCase(),x.value.trim()]));
  const checks:Array<[string,number|null,number]>=[
    ['a-check',number(fields.get('a-check'),/^\$\s*([\d,]+)$/),ref.aCheckPrice],
    ['maint check',number(fields.get('maint check'),/^([\d,]+)\s+Hours$/i),ref.checkIntervalHours],
    ['runway required',number(fields.get('runway required'),/^([\d,]+)\s+ft$/i),ref.minRunwayFt],
    ['range',number(fields.get('range'),/^([\d,]+)\s+km$/i),ref.rangeKm],
    ['capacity',number(fields.get('capacity'),/^([\d,]+)\s+pax$/i),ref.capacityUnits],
    ['co2 emission',number(fields.get('co2 emission'),/^([\d.]+)\s+kg\/pax\/km$/i),ref.co2KgPerPaxKm]
  ];
  const matched:string[]=[];
  const conflicted:string[]=[];
  if(normalize(live.modelName)===normalize(ref.modelName))matched.push('model-name');else conflicted.push('model-name');
  for(const [name,observed,expected] of checks){
    if(observed===null)continue;
    const tolerance=name==='co2 emission'?1e-9:0;
    if(Math.abs(observed-expected)<=tolerance)matched.push(name);else conflicted.push(name);
  }
  const mandatory=['model-name','a-check','maint check','runway required','range','capacity','co2 emission'];
  const verified=conflicted.length===0&&mandatory.every(x=>matched.includes(x))&&
    Number.isFinite(ref.acquisitionCost)&&ref.acquisitionCost>0;
  return {
    ...base,verified,fieldsMatched:matched,fieldsConflicted:conflicted,
    acquisitionCost:verified?ref.acquisitionCost:null,
    reason:verified?'LIVE_CATALOG_MATCHES_COMMUNITY_REFERENCE_ON_SEVEN_FIELDS':
      conflicted.length?'REFERENCE_FIELD_CONFLICT':'REFERENCE_FIELDS_INCOMPLETE'
  };
}
