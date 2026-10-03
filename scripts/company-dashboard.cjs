const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const read=(dir,name)=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{return null;}};
const safe=s=>String(s??'').replace(/[|\r\n<>]/g,' ');

function build(dir='test-results/demand',logPath='test-results/bot.log'){
  const demand=read(dir,'demand-report.json'),fleet=read(dir,'fleet-observations.json'),execution=read(dir,'execution-report.json'),
    routeExecution=read(dir,'route-execution.json'),supplies=read(dir,'supply-report.json'),pricing=read(dir,'pricing-execution.json'),modules=read(dir,'operational-modules.json');
  const log=(()=>{try{return fs.readFileSync(logPath,'utf8')}catch{return ''}})();
  const aircraft=Array.isArray(fleet?.aircraft)?fleet.aircraft:[];
  const execBy=new Map((execution?.entries||[]).map(x=>[x.aircraftId,x]));
  const routeBy=new Map((routeExecution?.entries||[]).map(x=>[x.aircraftId,x]));
  const states=aircraft.map(a=>{
    const e=execBy.get(a.aircraftId),r=routeBy.get(a.aircraftId);
    let state='NORMAL',reason=a.state==='inflight'?'INFLIGHT_OBSERVED':'OBSERVED_WITHOUT_ACTION';
    if(a.issue&&/maintenance|repair|a-check|check/i.test(String(a.issue))){state='MANUTENCAO';reason='MAINTENANCE_ISSUE_OBSERVED';}
    else if(r?.status==='held'){state='PRECISA_REVISAR_ROTA';reason='REROUTE_HELD:'+r.reason;}
    else if(r?.status==='outcome_unknown'){state='PRECISA_REVISAR_ROTA';reason='REROUTE_OUTCOME_UNKNOWN_NO_RETRY';}
    else if(e?.status==='held'){state='AGUARDANDO_DEMANDA';reason='DEPARTURE_HELD:'+e.reason;}
    else if(e?.status==='departed'){state='NORMAL';reason='DEPARTED_THIS_RUN';}
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
    departures:{departed:execution?.summary?.departed??null,held:execution?.summary?.held??null,unknown:execution?.summary?.unknown??null},
    routes:{evaluated:routeExecution?.summary?.evaluated??null,rerouted:routeExecution?.summary?.rerouted??null,
      held:routeExecution?.summary?.held??null,unknown:routeExecution?.summary?.unknown??null},
    pricing:{evaluated:pricing?.summary?.evaluated??null,adjusted:pricing?.summary?.adjusted??null,
      unchanged:pricing?.summary?.unchanged??null,unknown:pricing?.summary?.unknown??null},
    operationalStates:{NORMAL:count('NORMAL'),AGUARDANDO_DEMANDA:count('AGUARDANDO_DEMANDA'),
      PRECISA_REVISAR_ROTA:count('PRECISA_REVISAR_ROTA'),MANUTENCAO:count('MANUTENCAO'),PRONTA_PARA_DECOLAR:count('PRONTA_PARA_DECOLAR')},
    maintenance:{preventiveACheckRepairs:modules?.maintenance?.status??(log.includes('[Operacao] Manutencao automatica finalizada.')?'completed_observed':
      log.includes('[Operacao] Iniciando manutencao preventiva, A-checks e reparos...')?'started_observed':'not_observed')},
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
  `| Reroutes confirmados | ${d.routes.rerouted??'n/d'} |`,`| Pricing ajustado | ${d.pricing.adjusted??'n/d'} |`,'',
  `Manutencao preventiva/A-check/reparos: **${d.maintenance.preventiveACheckRepairs}**. Campanhas: **${d.campaign.status}**.`,'',
  `Combustivel: **${d.supplies.fuel?.status??'n/d'}** (${d.supplies.fuel?.reason??'sem evidencia'}). CO2: **${d.supplies.co2?.status??'n/d'}** (${d.supplies.co2?.reason??'sem evidencia'}).`,'',
  '## Estados operacionais','',
  `NORMAL ${s.NORMAL}; AGUARDANDO_DEMANDA ${s.AGUARDANDO_DEMANDA}; PRECISA_REVISAR_ROTA ${s.PRECISA_REVISAR_ROTA}; MANUTENCAO ${s.MANUTENCAO}; PRONTA_PARA_DECOLAR ${s.PRONTA_PARA_DECOLAR}.`,'',
  '| Aeronave | Estado | Motivo |','| --- | --- | --- |',
  ...states.map(x=>`| ${safe(x.registration)} | ${x.state} | ${safe(x.reason)} |`),'',
  '_Somente dados observados nos artifacts deste run; campos ausentes permanecem n/d._',''].join('\n');
}
function selfTest(){
 const dir=fs.mkdtempSync('/tmp/am4-dashboard-');
 fs.writeFileSync(path.join(dir,'fleet-observations.json'),JSON.stringify({aircraft:[
  {aircraftId:'1',registration:'A',state:'ready'},{aircraftId:'2',registration:'B',state:'inflight'}]}));
 fs.writeFileSync(path.join(dir,'demand-report.json'),JSON.stringify({summary:{fleetSeen:2}}));
 fs.writeFileSync(path.join(dir,'execution-report.json'),JSON.stringify({summary:{departed:0,held:1,unknown:0},entries:[
  {aircraftId:'1',status:'held',reason:'low demand'}]}));
 fs.writeFileSync(path.join(dir,'route-execution.json'),JSON.stringify({summary:{evaluated:0,rerouted:0,held:0,unknown:0},entries:[]}));
 fs.writeFileSync(path.join(dir,'operational-modules.json'),JSON.stringify({schemaVersion:1,maintenance:{status:'completed_observed',observedAt:'2026-01-01T00:00:00.000Z'},campaign:{status:'completed_observed',observedAt:'2026-01-01T00:00:00.000Z'}}));
 const {dashboard,states}=build(dir,path.join(dir,'missing.log'));
 assert.equal(dashboard.fleet.seen,2);assert.equal(dashboard.operationalStates.AGUARDANDO_DEMANDA,1);
 assert.equal(dashboard.maintenance.preventiveACheckRepairs,'completed_observed');assert.equal(dashboard.campaign.status,'completed_observed');
 assert.equal(states.find(x=>x.aircraftId==='2').state,'NORMAL');
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
