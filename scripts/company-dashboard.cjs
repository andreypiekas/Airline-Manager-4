const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const read=(dir,name)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{return null;}};
const readPath=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const safe=s=>String(s??'').replace(/[|\r\n<>]/g,' ');

function build(dir='test-results/demand',logPath='test-results/bot.log',journalPath='.am4-state/github/return-journal.json'){
  const demand=read(dir,'demand-report.json'),fleet=read(dir,'fleet-observations.json'),execution=read(dir,'execution-report.json'),
    routeExecution=read(dir,'route-execution.json'),candidateData=read(dir,'candidate-data.json'),supplies=read(dir,'supply-report.json'),pricing=read(dir,'pricing-execution.json'),modules=read(dir,'operational-modules.json');
  const log=(()=>{try{return fs.readFileSync(logPath,'utf8')}catch{return ''}})();
  const journal=readPath(journalPath),events=Array.isArray(journal?.events)?journal.events:[];
  const uncertainDepartureKeys=new Set(events.filter(x=>x?.type==='departure-uncertain').map(x=>x.aircraftId+':'+x.routeId));
  const uncertainRouteAircraftIds=new Set(events.filter(x=>x?.type==='route-uncertain').map(x=>x.aircraftId));
  const uncertainPricingRouteIds=new Set(events.filter(x=>x?.type==='pricing-uncertain').map(x=>x.routeId));
  const uncertainSupplyKinds=new Set(events.filter(x=>x?.type==='supply-uncertain').map(x=>x.kind));
  const aircraft=Array.isArray(fleet?.aircraft)?fleet.aircraft:[];
  const execBy=new Map((execution?.entries||[]).map(x=>[x.aircraftId,x]));
  const routeBy=new Map((routeExecution?.entries||[]).map(x=>[x.aircraftId,x]));
  const routeDecisionBy=new Map((candidateData?.routeDecisions||[]).map(x=>[x.aircraftId,x]));
  const states=aircraft.map(a=>{
    const e=execBy.get(a.aircraftId),r=routeBy.get(a.aircraftId),rd=routeDecisionBy.get(a.aircraftId);
    let state='NORMAL',reason=a.state==='inflight'?'INFLIGHT_OBSERVED':'OBSERVED_WITHOUT_ACTION';
    if(a.issue&&/maintenance|repair|a-check|check/i.test(String(a.issue))){state='MANUTENCAO';reason='MAINTENANCE_ISSUE_OBSERVED';}
    else if(uncertainRouteAircraftIds.has(a.aircraftId)){state='PRECISA_REVISAR_ROTA';reason='PERSISTED_UNCERTAIN_ROUTE_BLOCK';}
    else if(uncertainDepartureKeys.has(a.aircraftId+':'+a.routeId)){state='PRECISA_REVISAR_ROTA';reason='PERSISTED_UNCERTAIN_DEPARTURE_BLOCK';}
    else if(r?.status==='held'){state='PRECISA_REVISAR_ROTA';reason='REROUTE_HELD:'+r.reason;}
    else if(r?.status==='outcome_unknown'){state='PRECISA_REVISAR_ROTA';reason='REROUTE_OUTCOME_UNKNOWN_NO_RETRY';}
    else if(e?.status==='outcome_unknown'){state='PRECISA_REVISAR_ROTA';reason='DEPARTURE_OUTCOME_UNKNOWN_NO_RETRY';}
    else if(e?.status==='held'&&e.reason==='PERSISTED_UNCERTAIN_DEPARTURE_BLOCK'){state='PRECISA_REVISAR_ROTA';reason='PERSISTED_UNCERTAIN_DEPARTURE_BLOCK';}
    else if(e?.status==='held'&&e.reason==='FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY'){state='AGUARDANDO_RECURSO';reason='FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY';}
    else if(uncertainPricingRouteIds.has(a.routeId)){state='PRECISA_REVISAR_PRECO';reason='PERSISTED_UNCERTAIN_PRICING_BLOCK';}
    else if(!a.operationalOrigin&&a.originResolution?.source==='unavailable'){state='PRECISA_REVISAR_ROTA';reason='ORIGIN_NOT_REGISTERED';}
    else if(e?.status==='held'&&e.demand?.decision==='hold_insufficient'){state='AGUARDANDO_DEMANDA';reason='DEMAND_INSUFFICIENT_VERIFIED';}
    else if(e?.status==='departed'){state='NORMAL';reason='DEPARTED_THIS_RUN';}
    else if(rd?.decision==='hold'){state='PRECISA_REVISAR_ROTA';reason='ROUTE_REVIEW_HOLD:'+rd.reason;}
    else if(a.state==='ready'&&e?.status==='held'){state='PRONTA_PARA_DECOLAR';reason='DEPARTURE_HELD:'+e.reason;}
    else if(a.state==='ready'){state='PRONTA_PARA_DECOLAR';reason='READY_OBSERVED_NO_DEPARTURE_RESULT';}
    return {aircraftId:a.aircraftId,registration:a.registration||'unknown',state,reason,observedFleetState:a.state||'unknown'};
  });
  const count=s=>states.filter(x=>x.state===s).length;
  const supply={};
  for(const x of supplies?.entries||[])supply[x.kind]={status:x.status,reason:x.reason,pricePer1000:x.before?.pricePer1000??null,quantity:x.plan?.quantity??null};
  const dashboard={
    schemaVersion:1,generatedAt:new Date().toISOString(),source:'observed-run-artifacts-only',
    fleet:{seen:demand?.summary?.fleetSeen??aircraft.length,ready:aircraft.filter(a=>a.state==='ready').length,
      inflight:aircraft.filter(a=>a.state==='inflight').length,unavailable:aircraft.filter(a=>a.state==='unavailable').length},
    departures:{departed:execution?.summary?.departed??null,held:execution?.summary?.held??null,unknown:execution?.summary?.unknown??null,
      fuelHeld:(execution?.entries||[]).filter(x=>x?.status==='held'&&x?.reason==='FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY').length},
    routes:{evaluated:routeExecution?.summary?.evaluated??null,rerouted:routeExecution?.summary?.rerouted??null,
      held:routeExecution?.summary?.held??null,unknown:routeExecution?.summary?.unknown??null,
      reviewDecisions:{
        keep:(candidateData?.routeDecisions||[]).filter(x=>x?.decision==='keep_route').length,
        hold:(candidateData?.routeDecisions||[]).filter(x=>x?.decision==='hold').length,
        wouldReroute:(candidateData?.routeDecisions||[]).filter(x=>x?.decision==='would_reroute').length,
        unavailable:(candidateData?.routeDecisions||[]).filter(x=>x?.decision==='unavailable').length
      },
      originUnavailable:aircraft.filter(a=>!a.operationalOrigin&&a.originResolution?.source==='unavailable').length},
    pricing:{evaluated:pricing?.summary?.evaluated??null,adjusted:pricing?.summary?.adjusted??null,
      unchanged:pricing?.summary?.unchanged??null,unknown:pricing?.summary?.unknown??null,
      phaseHoldReason:pricing?.phaseHoldReason??null},
    operationalStates:{NORMAL:count('NORMAL'),AGUARDANDO_DEMANDA:count('AGUARDANDO_DEMANDA'),AGUARDANDO_RECURSO:count('AGUARDANDO_RECURSO'),
      PRECISA_REVISAR_ROTA:count('PRECISA_REVISAR_ROTA'),PRECISA_REVISAR_PRECO:count('PRECISA_REVISAR_PRECO'),MANUTENCAO:count('MANUTENCAO'),PRONTA_PARA_DECOLAR:count('PRONTA_PARA_DECOLAR')},
    quarantines:{departure:uncertainDepartureKeys.size,route:uncertainRouteAircraftIds.size,pricingRoute:uncertainPricingRouteIds.size,supplyKinds:uncertainSupplyKinds.size},
    maintenance:{preventiveACheckRepairs:modules?.maintenance?.status??(log.includes('[Operacao] Manutencao automatica finalizada.')?'completed_observed':
      log.includes('[Operacao] Iniciando manutencao preventiva, A-checks e reparos...')?'started_observed':'not_observed'),
      evidence:modules?.maintenance?.evidence??null},
    campaign:{status:modules?.campaign?.status??(log.includes('[Operacao] Campanhas automaticas finalizadas.')?'completed_observed':
      log.includes('[Operacao] Verificando e contratando campanhas...')?'started_observed':'not_observed')},
    supplies:supply
  };
  return {dashboard,states};
}
function markdown(d,states){
 const s=d.operationalStates;
 return ['# Dashboard consolidado da companhia','',
  '| Indicador | Observado |','| --- | ---: |',
  `| Frota vista | ${d.fleet.seen} |`,`| Em voo | ${d.fleet.inflight} |`,`| Prontas | ${d.fleet.ready} |`,
  `| Decoladas neste run | ${d.departures.departed??'n/d'} |`,`| Retidas | ${d.departures.held??'n/d'} |`,
  `| Retidas por combustivel insuficiente verificado | ${d.departures.fuelHeld??0} |`,
  `| Reroutes confirmados | ${d.routes.rerouted??'n/d'} |`,`| Rotas sem base operacional verificada | ${d.routes.originUnavailable??0} |`,
  `| Pricing ajustado | ${d.pricing.adjusted??'n/d'} |`,`| Pricing retido por fase | ${d.pricing.phaseHoldReason??'nenhum'} |`,'',
  `Manutencao preventiva/A-check/reparos: **${d.maintenance.preventiveACheckRepairs}**${d.maintenance.evidence ? ` — avaliadas ${d.maintenance.evidence.evaluated??'n/d'}, A-check selecionadas ${d.maintenance.evidence.selected??'n/d'}, bulk check ${d.maintenance.evidence.bulkCheckExecuted===true?'executado':d.maintenance.evidence.bulkCheckExecuted===false?'nao necessario':'n/d'}, reparo elegivel ${d.maintenance.evidence.repairEligible===true?'sim':d.maintenance.evidence.repairEligible===false?'nao':'n/d'}` : ''}. Campanhas: **${d.campaign.status}**.`,'',
  `Combustivel: **${d.supplies.fuel?.status??'n/d'}** (${d.supplies.fuel?.reason??'sem evidencia'}). CO2: **${d.supplies.co2?.status??'n/d'}** (${d.supplies.co2?.reason??'sem evidencia'}).`,'',
  '## Estados operacionais','',
  `NORMAL ${s.NORMAL}; AGUARDANDO_DEMANDA ${s.AGUARDANDO_DEMANDA}; AGUARDANDO_RECURSO ${s.AGUARDANDO_RECURSO}; PRECISA_REVISAR_ROTA ${s.PRECISA_REVISAR_ROTA}; PRECISA_REVISAR_PRECO ${s.PRECISA_REVISAR_PRECO}; MANUTENCAO ${s.MANUTENCAO}; PRONTA_PARA_DECOLAR ${s.PRONTA_PARA_DECOLAR}.`,'',
  `Quarentenas persistentes: decolagem ${d.quarantines.departure}; reroute ${d.quarantines.route}; pricing ${d.quarantines.pricingRoute}; suprimentos ${d.quarantines.supplyKinds}.`,'',
  '| Aeronave | Estado | Motivo |','| --- | --- | --- |',
  ...states.map(x=>`| ${safe(x.registration)} | ${x.state} | ${safe(x.reason)} |`),'',
  '_Somente dados observados nos artifacts deste run; campos ausentes permanecem n/d._',''].join('\n');
}
function selfTest(){
 const dir=fs.mkdtempSync('/tmp/am4-dashboard-');
 fs.writeFileSync(path.join(dir,'fleet-observations.json'),JSON.stringify({aircraft:[
  {aircraftId:'1',registration:'A',routeId:'1',state:'ready'},{aircraftId:'2',registration:'B',routeId:'2',state:'inflight'},
  {aircraftId:'3',registration:'C',routeId:'3',state:'ready'},{aircraftId:'4',registration:'D',routeId:'4',state:'ready'},
  {aircraftId:'5',registration:'E',routeId:'5',state:'ready'},{aircraftId:'6',registration:'F',routeId:'6',state:'ready'},
  {aircraftId:'7',registration:'G',routeId:'7',state:'ready'},{aircraftId:'8',registration:'H',routeId:'8',state:'ready'},
  {aircraftId:'9',registration:'I',routeId:'9',state:'inflight',operationalOrigin:null,originResolution:{source:'unavailable',reason:'Nenhum aeroporto da rota pertence as bases configuradas.'}}]}));
 fs.writeFileSync(path.join(dir,'demand-report.json'),JSON.stringify({summary:{fleetSeen:9}}));
 fs.writeFileSync(path.join(dir,'execution-report.json'),JSON.stringify({summary:{departed:0,held:3,unknown:1},entries:[
  {aircraftId:'1',status:'held',reason:'DEMAND_BELOW_THRESHOLD',demand:{decision:'hold_insufficient'}},
  {aircraftId:'3',status:'outcome_unknown',reason:'NO_RETRY_AFTER_CLICK_ATTEMPT:CONFIRM_STATE_NOT_INFLIGHT'},
  {aircraftId:'4',status:'held',reason:'PERSISTED_UNCERTAIN_DEPARTURE_BLOCK'},
  {aircraftId:'5',status:'held',reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_MUTATION'},
  {aircraftId:'6',status:'held',reason:'FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY'}]}));
 fs.writeFileSync(path.join(dir,'route-execution.json'),JSON.stringify({summary:{evaluated:0,rerouted:0,held:0,unknown:0},entries:[]}));
 fs.writeFileSync(path.join(dir,'pricing-execution.json'),JSON.stringify({summary:{evaluated:0,adjusted:0,unchanged:0,held:0,unknown:0},phaseHoldReason:'PRICING_INITIAL_COLLECTION_INCOMPLETE'}));
 fs.writeFileSync(path.join(dir,'candidate-data.json'),JSON.stringify({routeDecisions:[
  {aircraftId:'7',decision:'hold',reason:'NO_VERIFIED_VARIABLE_CYCLE_COMPARISON'},
  {aircraftId:'8',decision:'keep_route',reason:'NO_INSPECTED_CANDIDATE_PROVES_CONSERVATIVE_DOMINANCE'}
 ]}));
 fs.writeFileSync(path.join(dir,'operational-modules.json'),JSON.stringify({schemaVersion:1,maintenance:{status:'completed_observed',observedAt:'2026-01-01T00:00:00.000Z',evidence:{evaluated:22,selected:1,bulkCheckExecuted:true,repairEligible:false}},campaign:{status:'completed_observed',observedAt:'2026-01-01T00:00:00.000Z'}}));
 fs.writeFileSync(path.join(dir,'journal.json'),JSON.stringify({schemaVersion:1,scope:'x',entries:[],events:[
  {type:'departure-uncertain',aircraftId:'2',routeId:'2'},
  {type:'route-uncertain',aircraftId:'3'},
  {type:'pricing-uncertain',routeId:'5'},
  {type:'supply-uncertain',kind:'co2'}
 ]}));
 const {dashboard,states}=build(dir,path.join(dir,'missing.log'),path.join(dir,'journal.json'));
 assert.equal(dashboard.fleet.seen,9);assert.equal(dashboard.operationalStates.AGUARDANDO_DEMANDA,1);assert.equal(dashboard.departures.fuelHeld,1);
 assert.equal(dashboard.operationalStates.PRECISA_REVISAR_ROTA,5);assert.equal(dashboard.operationalStates.PRECISA_REVISAR_PRECO,1);assert.equal(dashboard.operationalStates.PRONTA_PARA_DECOLAR,1);assert.equal(dashboard.operationalStates.AGUARDANDO_RECURSO,1);
 assert.deepEqual(dashboard.routes.reviewDecisions,{keep:1,hold:1,wouldReroute:0,unavailable:0});
 assert.equal(dashboard.routes.originUnavailable,1);assert.equal(dashboard.pricing.phaseHoldReason,'PRICING_INITIAL_COLLECTION_INCOMPLETE');
 assert.deepEqual(dashboard.quarantines,{departure:1,route:1,pricingRoute:1,supplyKinds:1});
 assert.equal(dashboard.maintenance.preventiveACheckRepairs,'completed_observed');assert.deepEqual(dashboard.maintenance.evidence,{evaluated:22,selected:1,bulkCheckExecuted:true,repairEligible:false});assert.equal(dashboard.campaign.status,'completed_observed');
 assert.deepEqual(states.find(x=>x.aircraftId==='2'),{aircraftId:'2',registration:'B',state:'PRECISA_REVISAR_ROTA',reason:'PERSISTED_UNCERTAIN_DEPARTURE_BLOCK',observedFleetState:'inflight'});
 assert.deepEqual(states.find(x=>x.aircraftId==='3'),{aircraftId:'3',registration:'C',state:'PRECISA_REVISAR_ROTA',reason:'PERSISTED_UNCERTAIN_ROUTE_BLOCK',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='4'),{aircraftId:'4',registration:'D',state:'PRECISA_REVISAR_ROTA',reason:'PERSISTED_UNCERTAIN_DEPARTURE_BLOCK',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='5'),{aircraftId:'5',registration:'E',state:'PRECISA_REVISAR_PRECO',reason:'PERSISTED_UNCERTAIN_PRICING_BLOCK',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='6'),{aircraftId:'6',registration:'F',state:'AGUARDANDO_RECURSO',reason:'FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='7'),{aircraftId:'7',registration:'G',state:'PRECISA_REVISAR_ROTA',reason:'ROUTE_REVIEW_HOLD:NO_VERIFIED_VARIABLE_CYCLE_COMPARISON',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='8'),{aircraftId:'8',registration:'H',state:'PRONTA_PARA_DECOLAR',reason:'READY_OBSERVED_NO_DEPARTURE_RESULT',observedFleetState:'ready'});
 assert.deepEqual(states.find(x=>x.aircraftId==='9'),{aircraftId:'9',registration:'I',state:'PRECISA_REVISAR_ROTA',reason:'ORIGIN_NOT_REGISTERED',observedFleetState:'inflight'});
 fs.rmSync(dir,{recursive:true,force:true});console.log('company-dashboard self-test ok');
}
if(require.main===module){
 if(process.argv.includes('--self-test'))selfTest();
 else{
  const dir=process.argv[2]||'test-results/demand',out=build(dir);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'company-dashboard.json'),JSON.stringify(out.dashboard,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'operational-states.json'),JSON.stringify({schemaVersion:1,generatedAt:out.dashboard.generatedAt,states:out.states},null,2)+'\n');
  fs.writeFileSync(path.join(dir,'company-dashboard.md'),markdown(out.dashboard,out.states));
 }
}
module.exports={build,markdown};
