import { test,expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runDemandSimulation } from '../../demand/run';
import { readDemandConfig } from '../../demand/config';
import { loginForReadOnlyCollection } from '../../utils/read-only-login';
import { withRunLock } from '../../utils/run-lock';
import { closeReadOnlyPopup } from '../../optimization/cost-reference-reader';

// This entry point imports no legacy operations and cannot select the operational path.
test('coleta integral das rotas — somente leitura',async({page})=>{
  await withRunLock(async()=>{
    Object.assign(process.env,{
      ENABLE_DEMAND_MANAGER:'true',DEMAND_DRY_RUN:'true',DEMAND_FAIL_SAFE:'true',
      ENABLE_RETURN_JOURNAL:'false',ENABLE_ROUTE_OPTIMIZER:'true',ENABLE_TICKET_PRICING:'true',
      ENABLE_ROUTE_RESEARCH:'true',ROUTE_RESEARCH_MAX_AIRCRAFT:'3',ROUTE_RESEARCH_MAX_SUGGESTIONS:'1',
    });
    const navigationViews:unknown[]=[];
    const writeSourceNavigation=async(view:string)=>{
      // Only rendered navigation labels; never forms, page scripts, storage, profile or session data.
      const navigation=await page.locator('[onclick]').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length)
        .flatMap(e=>{
          const callback=(e.getAttribute('onclick')||'').trim();
          const queryPaths=Array.from(callback.matchAll(/'([a-z_0-9]+\.php)(?:\?[^']*)?'/gi),m=>m[1]);
          const labels=[(e as HTMLElement).innerText,e.getAttribute('title')||'',e.getAttribute('aria-label')||'',e.getAttribute('data-original-title')||'',...Array.from(e.querySelectorAll('span')).filter(n=>n.getClientRects().length).map(n=>n.textContent||'')]
            .map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>/^(?:Fleet|Routes|Finance|Finances|Banking|Staff|MCDU|Search|Research|Maintenance|Statistics|Transactions)$/i.test(s));
          if(!labels.length&&queryPaths.some(p=>/^(?:transactions?|history)\.php$/.test(p)))labels.push('Financial history');
          if(!labels.length)return [];
          const safe=/^(?:hideAllWhenClick\(\);)?popup\('[a-z_0-9]+\.php','[A-Za-z ,/&-]+'(?:,(?:false|true|\d+)){0,8}\);$/.test(callback)||
            /^(?:[A-Za-z][A-Za-z0-9_]*\(\);)+$/.test(callback);
          return [{id:/^[A-Za-z][A-Za-z0-9_-]*$/.test(e.id)?e.id:null,tag:e.tagName,label:labels[0],
            title:e.getAttribute('title'),ariaLabel:e.getAttribute('aria-label'),tooltip:e.getAttribute('data-original-title'),callback:safe?callback:null,queryPaths,
            functionCalls:Array.from(callback.matchAll(/\b([A-Za-z_]\w*)\(/g),m=>m[1])}];
        }));
      navigationViews.push({view,navigation});
      await mkdir('test-results/demand',{recursive:true});
      await writeFile('test-results/demand/source-navigation.json',JSON.stringify({schemaVersion:1,
        observedAt:new Date().toISOString(),dryRun:true,mutationAuthorized:false,views:navigationViews},null,2)+'\n');
    };
    let phase='login';
    const evidence:{schemaVersion:number;dryRun:true;mutationAuthorized:false;status:string;phase:string;summary:unknown;fleetDetails:unknown;research:unknown}={
      schemaVersion:1,dryRun:true,mutationAuthorized:false,status:'blocked',phase,summary:null,fleetDetails:null,research:null,
    };
    try {
      const config=readDemandConfig();
      await loginForReadOnlyCollection(page,process.env,90000,stage=>{phase=`login_${stage}`;});
      await writeSourceNavigation('after_login');
      // MCDU is an optional paid feature. Presence of its menu does not prove ownership.
      // Do not open a purchase flow or make it a requirement for the normal collection.
      await writeFile('test-results/demand/mcdu-source-discovery.json',JSON.stringify({schemaVersion:1,
        observedAt:new Date().toISOString(),dryRun:true,mutationAuthorized:false,required:false,
        status:'optional_not_inspected',ownershipConfirmed:false,
        reason:'MCDU_OPTIONAL_AVAILABILITY_NOT_CONFIRMED'},null,2)+'\n');
      phase='fleet_open';
      const menu=page.locator('#mapRoutes');
      if ((await menu.getAttribute('onclick')||'').replace(/\s/g,'')!=="hideAllWhenClick();menuFleet('Routes');") throw new Error();
      await menu.click();
      phase='collection';
      const report=await runDemandSimulation(page,config);
      evidence.summary=report.summary;
      const fleet=JSON.parse(await readFile('test-results/demand/fleet-observations.json','utf8'));
      const research=JSON.parse(await readFile('test-results/demand/route-research.json','utf8'));
      const candidates=JSON.parse(await readFile('test-results/demand/candidate-data.json','utf8'));
      const verified=fleet.aircraft.filter((a:{detailsVerified:boolean})=>a.detailsVerified).length;
      const observed=research.aircraft.filter((a:{status:string})=>a.status==='observed').length;
      const failed=research.aircraft.filter((a:{status:string})=>['unavailable','partial'].includes(a.status)).length;
      evidence.fleetDetails={seen:fleet.aircraft.length,verified,unverified:fleet.aircraft.length-verified,
        inflight:fleet.aircraft.filter((a:any)=>a.state==='inflight').length,
        countdownsObserved:fleet.aircraft.filter((a:any)=>!!a.timing).length};
      const expectedModels=new Set(research.aircraft.flatMap((a:any)=>(a.result?.quotes||[]).flatMap((q:any)=>q.autopriceReference?[q.autopriceReference.modelId]:[])));
      evidence.research={observed,failed,uiRestored:research.uiRestored,comparisonReady:false,
        candidateSources:{uiRestored:candidates.uiRestored,modelsObserved:candidates.models.length,modelsExpected:expectedModels.size,
          fuelPriceObserved:!!candidates.market.fuel,co2PriceObserved:!!candidates.market.co2,candidates:candidates.candidates.length}};
      Object.assign((evidence.research as any).candidateSources,{
        maintenanceComplete:candidates.maintenance.complete,maintenanceAircraft:candidates.maintenance.aircraft.length,
        financeHistoryObserved:candidates.financeHistory.status==='observed',
        financeVisibleTransactions:candidates.financeHistory.transactions.length,
        reservationScenarios:candidates.candidates.filter((c:any)=>c.reservations.status!=='unavailable').length,
        effectiveCostsComplete:candidates.candidates.filter((c:any)=>c.effectiveCosts.complete).length,
        modelsNotInInspectedCatalog:candidates.modelReads.filter((m:any)=>m.status==='not_in_inspected_catalog').length,
        modelSourcesComplete:candidates.models.length===expectedModels.size,
      });
      phase='source_navigation';
      await closeReadOnlyPopup(page,10000);
      await writeSourceNavigation('after_collection');
      if ((await menu.getAttribute('onclick')||'').replace(/\s/g,'')!=="hideAllWhenClick();menuFleet('Routes');") throw new Error();
      await menu.click();
      await page.locator('#routesContainer').waitFor({state:'visible',timeout:10000});
      phase='data_validation';
      if(fleet.aircraft.some((a:any)=>a.timing&&(a.timing.aircraftId!==a.aircraftId||a.timing.routeId!==a.routeId||
        a.timing.futureDepartureAt!==null||a.timing.returnConfirmed||a.timing.mutationAuthorized)))throw new Error();
      if(!report.collectionComplete||verified!==fleet.aircraft.length||!research.uiRestored||failed>0)throw new Error();
      const accountedModels=candidates.modelReads.filter((m:any)=>['observed','not_in_inspected_catalog'].includes(m.status));
      if(observed>0&&(!candidates.uiRestored||accountedModels.length!==expectedModels.size||
        new Set(accountedModels.map((m:any)=>m.modelId)).size!==expectedModels.size||
        accountedModels.some((m:any)=>!expectedModels.has(m.modelId))||!candidates.market.fuel||!candidates.market.co2))throw new Error();
      if(!candidates.maintenance.complete||candidates.maintenance.aircraft.length!==fleet.aircraft.length||
        !candidates.market.fuel||!candidates.market.co2)throw new Error();
      if(candidates.financeHistory.status!=='observed'||!candidates.financeHistory.uiClosed||
        candidates.financeHistory.historyComplete||candidates.financeHistory.perLegCostsComplete||
        candidates.financeHistory.comparisonReady||candidates.financeHistory.mutationAuthorized)throw new Error();
      if(candidates.candidates.some((c:any)=>c.comparisonReady||c.mutationAuthorized||c.reservations.futureScheduleComplete||
        c.effectiveCosts.complete||c.costScenarios.totalOperatingCost!==null))throw new Error();
      evidence.status='passed';
    } catch {
      throw new Error(`[ReadOnly] Validacao bloqueada na fase ${phase}; consulte os relatorios estruturados.`);
    } finally {
      evidence.phase=phase;
      await mkdir('test-results/demand',{recursive:true});
      await writeFile('test-results/demand/collection-validation.json',JSON.stringify(evidence,null,2)+'\n');
    }
  });
});
