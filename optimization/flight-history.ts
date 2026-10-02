import type { Locator } from '@playwright/test';
import type { Cabins } from '../demand/types';
import { integerText } from '../demand/parsing';

export interface FlightHistoryEntry {
  relativeTime:string;
  from:string;
  to:string;
  registrationLabel:string;
  co2Quotas:number;
  onboard:Cabins;
  fuelLbs:number;
  revenue:number;
}
export interface FlightHistoryEvidence {
  status:'observed'|'unavailable';
  observedAt:string;
  source:'inspected-aircraft-flight-history';
  complete:false;
  entries:FlightHistoryEntry[];
  comparisonReady:false;
  mutationAuthorized:false;
}

export function parseFlightHistoryRow(text:string):FlightHistoryEntry|null{
  const normalized=text.replace(/\s+/g,' ').trim();
  const m=normalized.match(/^(.{1,40}? ago) ([A-Z0-9]{3})-([A-Z0-9]{3}) (.{1,80}?) ([\d,]+) Quotas Y(\d+) J(\d+) F(\d+) ([\d,]+) Lbs \$([\d,]+)$/);
  if(!m||m[2]===m[3])return null;
  try{
    const values=[m[5],m[6],m[7],m[8],m[9],m[10]].map(integerText);
    if(values.some(v=>!Number.isSafeInteger(v)||v<0))return null;
    return {
      relativeTime:m[1],from:m[2],to:m[3],registrationLabel:m[4].trim(),
      co2Quotas:values[0],onboard:{Y:values[1],J:values[2],F:values[3]},
      fuelLbs:values[4],revenue:values[5]
    };
  }catch{return null;}
}

/**
 * Reads the visible per-aircraft flight history only. It never clicks history
 * controls and does not claim the visible window is a complete accounting log.
 */
export async function readFlightHistoryEvidence(details:Locator):Promise<FlightHistoryEvidence>{
  const base:FlightHistoryEvidence={
    status:'unavailable',observedAt:new Date().toISOString(),source:'inspected-aircraft-flight-history',
    complete:false,entries:[],comparisonReady:false,mutationAuthorized:false
  };
  try{
    const history=details.locator('#flight-history');
    if(await history.count()!==1||!await history.isVisible())return base;
    const rows=history.locator('.row.bg-light.m-text.p-1.border');
    const count=await rows.count();
    if(count<1||count>100)return base;
    const texts=(await rows.allInnerTexts()).map(s=>s.replace(/\s+/g,' ').trim());
    const entries=texts.map(parseFlightHistoryRow);
    if(entries.some(e=>!e))return base;
    return {...base,status:'observed',observedAt:new Date().toISOString(),entries:entries as FlightHistoryEntry[]};
  }catch{return base;}
}
