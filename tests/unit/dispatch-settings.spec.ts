import { test,expect } from '@playwright/test';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const {resolveDepartureSettings}=require('../../scripts/resolve-departure-settings.cjs');
test('exact reported repository configuration activates real mode and keeps its one-flight limit',()=>{
 expect(resolveDepartureSettings({AM4_INPUT_EXECUTE:'false',AM4_INPUT_MAX_DEPARTURES:'0',AM4_REPOSITORY_EXECUTE:'true',AM4_REPOSITORY_MAX_DEPARTURES:'1'})).toMatchObject({dryRun:false,maxDepartures:1,modeSource:'variable:EXECUTE_INDIVIDUAL'});
});
test('absent settings default to simulation and one-flight limit',()=>expect(resolveDepartureSettings({})).toMatchObject({dryRun:true,maxDepartures:1}));
test('cron with no new inputs inherits the repository activation and limit',()=>expect(resolveDepartureSettings({AM4_REPOSITORY_EXECUTE:'true',AM4_REPOSITORY_MAX_DEPARTURES:'3'})).toMatchObject({dryRun:false,maxDepartures:3}));
test('default zero input does not shadow the repository limit',()=>expect(resolveDepartureSettings({AM4_INPUT_MAX_DEPARTURES:'0',AM4_REPOSITORY_MAX_DEPARTURES:'4'}).maxDepartures).toBe(4));
test('explicit positive input overrides repository limit',()=>expect(resolveDepartureSettings({AM4_INPUT_MAX_DEPARTURES:'2',AM4_REPOSITORY_MAX_DEPARTURES:'4'}).maxDepartures).toBe(2));
test('repository zero limit falls back to safe default one',()=>expect(resolveDepartureSettings({AM4_REPOSITORY_MAX_DEPARTURES:'0'})).toMatchObject({maxDepartures:1,limitSource:'default:1'}));
test('simulation override prevents operations even with both activation switches true',()=>expect(resolveDepartureSettings({AM4_INPUT_MODE:'simulation',AM4_INPUT_EXECUTE:'true',AM4_REPOSITORY_EXECUTE:'true'}).dryRun).toBe(true));
test('production input is explicit activation',()=>expect(resolveDepartureSettings({AM4_INPUT_MODE:'production',AM4_REPOSITORY_EXECUTE:'false'}).dryRun).toBe(false));
test('legacy activation input still works',()=>expect(resolveDepartureSettings({AM4_INPUT_EXECUTE:'true',AM4_REPOSITORY_EXECUTE:'false'}).dryRun).toBe(false));
for(const [index,env] of [{AM4_INPUT_MODE:'automatic'},{AM4_REPOSITORY_EXECUTE:'tru'},{AM4_INPUT_EXECUTE:'yes'},{AM4_INPUT_MAX_DEPARTURES:'-1'},{AM4_INPUT_MAX_DEPARTURES:'21'},{AM4_INPUT_MAX_DEPARTURES:'1.5'},{AM4_REPOSITORY_MAX_DEPARTURES:'1\nother=secret'}].entries())
 test(`invalid settings fail before any game login case ${index}`,()=>expect(()=>resolveDepartureSettings(env)).toThrow());
test('both workflows wire repository variables into the shared resolver and use its outputs',async()=>{
 for(const name of ['playwright.yml','individual-departures.yml']){
  const s=await readFile('.github/workflows/'+name,'utf8');expect(s).toContain('AM4_REPOSITORY_EXECUTE: ${{ vars.EXECUTE_INDIVIDUAL }}');expect(s).toContain('AM4_REPOSITORY_MAX_DEPARTURES: ${{ vars.MAX_INDIVIDUAL_DEPARTURES }}');expect(s).toContain('DEMAND_DRY_RUN: ${{ steps.departure_settings.outputs.dry_run }}');expect(s).toContain('DEMAND_MAX_DEPARTURES_PER_RUN: ${{ steps.departure_settings.outputs.max_departures }}');expect(s).toContain('group: airline-manager-4-main');expect(s).not.toContain('\n  push:');
 }
});
test('resolver CLI produces safe Action outputs and explicit operational-mode log without credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'am4-dispatch-'));const target=join(dir,'output');
 try{const log=execFileSync(process.execPath,['scripts/resolve-departure-settings.cjs'],{env:{GITHUB_OUTPUT:target,AM4_REPOSITORY_EXECUTE:'true',AM4_REPOSITORY_MAX_DEPARTURES:'1'},encoding:'utf8'});expect(await readFile(target,'utf8')).toBe('dry_run=false\nmax_departures=1\n');expect(log).toContain('"dryRun":false');expect(log).toContain('variable:EXECUTE_INDIVIDUAL');}finally{await rm(dir,{recursive:true,force:true});}
});

test('main production workflow forwards the declared departure limit input instead of forcing twenty',async()=>{
 const s=await readFile('.github/workflows/playwright.yml','utf8');
 expect(s).toContain('AM4_INPUT_MAX_DEPARTURES: ${{ inputs.max_individual_departures }}');
 expect(s).not.toContain("AM4_INPUT_MAX_DEPARTURES: '20'");
});

test('legacy repository limit above hard safety cap is bounded to twenty and reported as clamped',()=>{
 expect(resolveDepartureSettings({AM4_INPUT_MAX_DEPARTURES:'0',AM4_REPOSITORY_MAX_DEPARTURES:'30'})).toMatchObject({
  maxDepartures:20,limitSource:'variable:MAX_INDIVIDUAL_DEPARTURES:clamped-to-20'
 });
 expect(resolveDepartureSettings({AM4_REPOSITORY_MAX_DEPARTURES:'99'}).maxDepartures).toBe(20);
});
test('explicit manual limit above twenty still fails instead of being silently clamped',()=>{
 expect(()=>resolveDepartureSettings({AM4_INPUT_MAX_DEPARTURES:'21',AM4_REPOSITORY_MAX_DEPARTURES:'30'})).toThrow();
});


test('main workflow skips every game-access step when queued SHA is stale',async()=>{
 const s=await readFile('.github/workflows/playwright.yml','utf8');
 expect(s).toContain('name: Verificar SHA atual antes de acessar o jogo');
 expect(s).toContain('git rev-parse refs/remotes/origin/main');
 expect(s).toContain('echo "stale=true" >> "$GITHUB_OUTPUT"');
 expect(s).toContain("if: vars.ENABLE_DEMAND_MANAGER != 'false' && steps.current_head.outputs.stale != 'true'");
 for(const step of ['Instalar servidor de tela virtual Xvfb','Resolver modo e limite de decolagens','Executar bot Airline Manager 4']){
  const block=s.slice(s.indexOf('name: '+step),s.indexOf('name: '+step)+800);
  expect(block).toContain("if: steps.current_head.outputs.stale != 'true'");
 }
});
