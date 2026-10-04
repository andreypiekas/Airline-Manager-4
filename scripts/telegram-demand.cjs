// Optional aggregate-only notification. No aircraft names, balances, HTML or credentials in output.
const fs = require('node:fs');
const https = require('node:https');
function message(report) {
  const s = report.summary;
  if (!s || !['evaluated', 'sufficient', 'insufficient', 'unavailable'].every(k => Number.isSafeInteger(s[k]) && s[k] >= 0)) throw new Error('invalid report');
  if (report.collectionComplete && s.insufficient === 0 && s.unavailable === 0) return null;
  return `AM4 demanda (simulacao): avaliadas ${s.evaluated}; suficientes ${s.sufficient}; insuficientes ${s.insufficient}; indisponiveis ${s.unavailable}; coleta ${report.collectionComplete ? 'completa' : 'incompleta'}. Nenhuma operacao executada pelo modulo.`;
}
const read=(dir,name)=>{try{return JSON.parse(fs.readFileSync(dir+'/'+name,'utf8'));}catch{return null;}};
function importantMessage(dir='test-results/demand',botResult=process.env.BOT_RESULT,journalPath='.am4-state/github/return-journal.json'){
 const events=[];const ui=read(dir,'ui-health.json'),demand=read(dir,'demand-report.json'),route=read(dir,'route-execution.json'),execution=read(dir,'execution-report.json'),pricing=read(dir,'pricing-execution.json'),supply=read(dir,'supply-report.json'),candidate=read(dir,'candidate-data.json');
 if(botResult&&botResult!=='success')events.push('falha do run: '+botResult);
 if(ui?.status==='UI_CHANGE_DETECTED')events.push('UI_CHANGE_DETECTED em superficie critica');
 const unknown=(name,r)=>{const n=r?.summary?.unknown;if(Number.isSafeInteger(n)&&n>0)events.push(name+' com resultado incerto: '+n);if(r?.halted===true)events.push(name+' interrompido por fail-safe');};
 unknown('decolagem',execution);unknown('reroute',route);unknown('pricing',pricing);if(supply?.halted===true)events.push('suprimentos interrompidos por fail-safe');
 const fuelHeld=(execution?.entries||[]).filter(x=>x?.status==='held'&&x?.reason==='FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY').length;
 if(fuelHeld>0)events.push('decolagens retidas por combustivel insuficiente verificado: '+fuelHeld);
 const rerouted=route?.summary?.rerouted;if(Number.isSafeInteger(rerouted)&&rerouted>0)events.push('rotas alteradas e confirmadas: '+rerouted);
 if(Array.isArray(demand?.decisions)){const exhausted=demand.decisions.filter(x=>x?.decision==='hold_insufficient'&&x?.occupancyPercentage===0).length;if(exhausted>0)events.push('demanda esgotada observada: '+exhausted);}
 const hours=Number(process.env.HOURS_CHECK||'20'),wear=Number(process.env.REPAIR_WEAR||'30');
 if(candidate?.maintenance?.status==='observed'&&candidate.maintenance.complete===true&&Number.isFinite(hours)&&Number.isFinite(wear)){const critical=(candidate.maintenance.aircraft||[]).filter(x=>Number.isFinite(x.hoursToCheck)&&Number.isFinite(x.wearPercentage)&&(x.hoursToCheck<=hours||x.wearPercentage>=wear)).length;if(critical>0)events.push('manutencao critica pela politica verificada: '+critical);}
 const fuel=(supply?.entries||[]).find(x=>x?.kind==='fuel'),policy=supply?.adaptive?.fuel;
 if(policy?.source==='verified-live-history'&&Number.isSafeInteger(policy.historicalReference)&&fuel?.before&&Number.isSafeInteger(fuel.before.pricePer1000)&&fuel.before.pricePer1000<=policy.historicalReference&&['purchased','would_buy'].includes(fuel.status))events.push('combustivel materialmente barato vs historico verificado');
 const journal=(()=>{try{return JSON.parse(fs.readFileSync(journalPath,'utf8'));}catch{return null;}})();const holdMinutes=Number(process.env.DEMAND_PROLONGED_HOLD_MINUTES||'180');
 if(journal&&Number.isFinite(holdMinutes)&&holdMinutes>0){const departures=journal.events||[],holds=journal.holdObservations||[],groups=new Map();for(const x of holds){const k=x.aircraftId+':'+x.routeId,a=groups.get(k)||[];a.push(x);groups.set(k,a);}let prolonged=0;for(const [k,a] of groups){const [aircraftId,routeId]=k.split(':');const lastDep=Math.max(0,...departures.filter(x=>x.aircraftId===aircraftId&&x.routeId===routeId).map(x=>Date.parse(x.observedAt)||0));const active=a.filter(x=>(Date.parse(x.observedAt)||0)>lastDep).sort((x,y)=>Date.parse(x.observedAt)-Date.parse(y.observedAt));if(active.length>=2&&(Date.parse(active.at(-1).observedAt)-Date.parse(active[0].observedAt))/60000>=holdMinutes)prolonged++;}if(prolonged>0)events.push('holds prolongados com duracao verificada: '+prolonged);}
 if(!events.length)return null;return 'AM4 alerta: '+[...new Set(events)].join('; ')+'.';
}
async function main() {
  if (process.env.DEMAND_TELEGRAM_ENABLED !== 'true') return;
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log('[Demand] Telegram nao configurado.'); return; }
  if (!fs.existsSync('test-results/demand/demand-report.json')) return;
  const text = importantMessage('test-results/demand',process.env.BOT_RESULT);
  if (!text) return;
  const body = JSON.stringify({ chat_id: chatId, text });
  await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, res => {
      res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error('Telegram failed')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', () => reject(new Error('Telegram failed'))); req.end(body);
  });
}
if (require.main === module) main().catch(() => { console.error('[Demand] Nao foi possivel enviar o resumo Telegram.'); process.exitCode = 1; });
module.exports = { message, importantMessage };
