import { test, expect } from '@playwright/test';
import { occupancyAudit } from '../../demand/occupancy-audit';
import { parseOnboard } from '../../demand/parsing';
import { CollectionResult } from '../../demand/types';
const now=new Date('2026-09-30T23:00:00Z');
const config={minPercentage:80,maxAgeSeconds:300};
function sample():CollectionResult {return {complete:true,expectedRoutes:1,warnings:[],aircraft:[{aircraftId:'1',registration:'SYNTHETIC',routeId:'2',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'inflight',capacity:{Y:100,J:10,F:0},onboard:{Y:80,J:8,F:0},remaining:{Y:0,J:0,F:0},dailyTotal:{Y:1000,J:100,F:0},observedAt:now.toISOString()}]};}
test('observed occupancy does not use remaining demand',()=>{
 const r=occupancyAudit(sample(),config,now);expect(r.aircraft[0]).toMatchObject({status:'sufficient',occupancyPercentage:80,mutationAuthorized:false});
});
for(const n of [0,1,79]) test(`empty and low flights ${n}`,()=>{
 const c=sample();c.aircraft[0].onboard={Y:n,J:0,F:0};const r=occupancyAudit(c,config,now);
 expect(r.aircraft[0].status).toBe(n===0?'empty':'low');
});
for(const condition of ['missing','over-capacity','negative','duplicate','incomplete','stale','issue','zero-capacity'] as const) test(`invalid observation ${condition} cannot become zero occupancy`,()=>{
 const c=sample(),a=c.aircraft[0];
 if(condition==='missing')a.onboard=null;
 if(condition==='over-capacity')a.onboard!.J=11;
 if(condition==='negative')a.onboard!.Y=-1;
 if(condition==='duplicate')c.aircraft.push({...a});
 if(condition==='incomplete')c.complete=false;
 if(condition==='stale')a.observedAt='2026-09-29T23:00:00Z';
 if(condition==='issue')a.issue='details failed';
 if(condition==='zero-capacity')a.capacity={Y:0,J:0,F:0};
 expect(occupancyAudit(c,config,now).aircraft.every(a=>a.status==='unavailable'&&a.occupancyPercentage===null)).toBe(true);
});
test('landed aircraft not audited as inflight',()=>{const c=sample();c.aircraft[0].state='ready';expect(occupancyAudit(c,config,now).summary.evaluated).toBe(0);});
test('onboard parser accepts exact label and rejects missing values',()=>{
 expect(parseOnboard('Onboard: 0 / 0 / 0')).toEqual({Y:0,J:0,F:0});
 expect(parseOnboard('Onboard: 1,234 / 10 / 1')).toEqual({Y:1234,J:10,F:1});
 for(const s of ['Demand: 10 / 0 / 0','Onboard: -1 / 0 / 0','Onboard: ? / 0 / 0','Onboard: 1,2 / 0 / 0','Onboard: 1 / 0 / 0 extra']) expect(parseOnboard(s)).toBeNull();
});
