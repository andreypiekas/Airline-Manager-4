import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitHubReturnState } from '../optimization/github-state';

/** Real GitHub transport, exclusively synthetic test scope; never contacts the game. */
export async function validateRemoteState(stage: 'seed'|'restore', env = process.env) {
  const scope=env.RETURN_JOURNAL_SCOPE || '';
  if (env.GITHUB_REPOSITORY !== 'andreypiekas/Airline-Manager-4' || !/^ci-\d+-\d+$/.test(scope) || !env.GITHUB_TOKEN) throw new Error('SMOKE_CONFIG_INVALID');
  const options={repository:env.GITHUB_REPOSITORY,scope,token:env.GITHUB_TOKEN,directory:`.am4-state/smoke-${stage}`};
  const client=new GitHubReturnState(options);
  if(stage==='seed') await client.initialize();
  await client.restore();
  const path=join(options.directory,'return-journal.json');
  const journal=JSON.parse(await readFile(path,'utf8'));
  if(stage==='seed' && journal.entries.length!==0 || stage==='restore' && (journal.entries.length!==1 || journal.entries[0].flightId!=='synthetic-seed')) throw new Error('SMOKE_BASELINE_INVALID');
  journal.entries.push({aircraftId:'synthetic-aircraft',origin:'GRU',flightId:`synthetic-${stage}`,reviewedAt:new Date().toISOString(),decision:'keep_route'});
  await writeFile(path,JSON.stringify(journal)+'\n');
  if(await client.save()!=='saved')throw new Error('SMOKE_SAVE_FAILED');
  const check=new GitHubReturnState({...options,directory:options.directory+'-verification'});
  await check.restore();
  const saved=JSON.parse(await readFile(join(options.directory+'-verification','return-journal.json'),'utf8'));
  if(saved.entries.length!==(stage==='seed'?1:2) || await check.save()!=='unchanged')throw new Error('SMOKE_VERIFICATION_FAILED');
  await mkdir('test-results/remote-state',{recursive:true});
  await writeFile(`test-results/remote-state/${stage}.json`,JSON.stringify({schemaVersion:1,stage,scope,synthetic:true,gameRequests:0,restoredEvents:journal.entries.length-1,savedEvents:saved.entries.length,verified:true,mutationAuthorized:false},null,2)+'\n');
}
if(require.main===module) {
 const stage=process.argv[2];
 if(stage!=='seed'&&stage!=='restore'){console.error('SMOKE_STAGE_INVALID');process.exitCode=1;}
 else validateRemoteState(stage).then(()=>console.log('[State validation] Etapa concluida; somente dados sinteticos.')).catch(()=>{console.error('[State validation] Falha; conferir permissoes e historico de teste.');process.exitCode=1;});
}
