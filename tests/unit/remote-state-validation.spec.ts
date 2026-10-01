import { test,expect } from '@playwright/test';
import { validateRemoteState } from '../../scripts/validate-remote-state';
for(const env of [
 {},
 {GITHUB_REPOSITORY:'other/repo',RETURN_JOURNAL_SCOPE:'ci-1-1',GITHUB_TOKEN:'synthetic-token'},
 {GITHUB_REPOSITORY:'andreypiekas/Airline-Manager-4',RETURN_JOURNAL_SCOPE:'production',GITHUB_TOKEN:'synthetic-token'},
 {GITHUB_REPOSITORY:'andreypiekas/Airline-Manager-4',RETURN_JOURNAL_SCOPE:'ci-1-1'}
]) test(`remote smoke refuses non-test configuration ${JSON.stringify({...env,GITHUB_TOKEN:undefined})}`,async()=>{
 await expect(validateRemoteState('seed',env)).rejects.toThrow('SMOKE_CONFIG_INVALID');
});
