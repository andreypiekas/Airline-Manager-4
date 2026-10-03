import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateReturnJournal } from './return-journal';

const BRANCH = 'am4-runtime-state';
const MAX_BYTES = 900000; // Contents API full JSON response is limited to files <= 1 MB.
export interface StateOptions { repository: string; scope: string; directory: string; token: string }
type Fetcher = typeof fetch;
const canonical = (v: unknown) => JSON.stringify(v);
/** Only state files on a fixed dedicated branch. Never writes main, workflows or game endpoints. */
export class GitHubReturnState {
  private readonly path: string;
  constructor(private readonly options: StateOptions, private readonly request: Fetcher = fetch) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(options.repository) || !/^[A-Za-z0-9_-]{1,100}$/.test(options.scope) || !options.token || !options.directory) throw new Error('STATE_CONFIG_INVALID');
    this.path = `/repos/${options.repository}/contents/return-journal-${options.scope}.json`;
  }
  private async api(method: string, body?: object): Promise<any> {
    try {
      const response = await this.request('https://api.github.com' + this.path + (method === 'GET' ? `?ref=${BRANCH}` : ''), {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.options.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error(`STATE_HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(/^STATE_HTTP_\d{3}$/.test(message) ? message : 'STATE_NETWORK_FAILED');
    }
  }
  private parse(text: string) {
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('STATE_TOO_LARGE');
    try { return validateReturnJournal(JSON.parse(text), this.options.scope, new Date()); }
    catch { throw new Error('STATE_INVALID'); }
  }
  /** Explicit one-time initialization; branch must already exist. Never invoked by the bot workflow. */
  async initialize(): Promise<void> {
    const content = JSON.stringify({ schemaVersion: 1, scope: this.options.scope, entries: [] }) + '\n';
    await this.api('PUT', { branch: BRANCH, message: 'chore: initialize return journal [skip ci]', content: Buffer.from(content).toString('base64') });
  }
  async restore(): Promise<void> {
    const directory = this.options.directory;
    // Refuse to overwrite local uncommitted state. Fresh Actions runners start without this directory.
    try { await stat(directory); throw new Error('STATE_LOCAL_EXISTS'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const response = await this.api('GET'); // 404 is a blocker, never an empty/new journal.
    if (response.type !== 'file' || response.encoding !== 'base64' || typeof response.content !== 'string' || !/^[a-f0-9]{40}$/.test(response.sha) || response.size > MAX_BYTES) throw new Error('STATE_RESPONSE_INVALID');
    const text = Buffer.from(response.content, 'base64').toString('utf8');
    const data = this.parse(text);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'return-journal.json'), JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'restored.json'), JSON.stringify({ repository: this.options.repository, scope: this.options.scope, branch: BRANCH, sha: response.sha, original: data }), { flag: 'wx', mode: 0o600 });
  }
  async save(): Promise<'unchanged' | 'saved'> {
    const baseline = JSON.parse(await readFile(join(this.options.directory, 'restored.json'), 'utf8'));
    if (baseline.repository !== this.options.repository || baseline.scope !== this.options.scope || baseline.branch !== BRANCH || !/^[a-f0-9]{40}$/.test(baseline.sha)) throw new Error('STATE_BASELINE_INVALID');
    const original = this.parse(canonical(baseline.original));
    const current = this.parse(await readFile(join(this.options.directory, 'return-journal.json'), 'utf8'));
    const prefix=(before:unknown[]|undefined,after:unknown[]|undefined)=>{const a=before||[],b=after||[];return b.length>=a.length&&a.every((e,i)=>canonical(e)===canonical(b[i]));};
    if (!prefix(original.entries,current.entries)||!prefix(original.events,current.events)||!prefix(original.supplyObservations,current.supplyObservations)||!prefix(original.holdObservations,current.holdObservations)||!prefix(original.uiHealthObservations,current.uiHealthObservations)) throw new Error('STATE_NOT_APPEND_ONLY');
    const originalEvents=original.events||[],currentEvents=current.events||[];
    if(currentEvents.length<originalEvents.length||originalEvents.some((e,i)=>canonical(e)!==canonical(currentEvents[i])))throw new Error('STATE_NOT_APPEND_ONLY');
    if (canonical(original) === canonical(current)) return 'unchanged';
    const content = JSON.stringify(current) + '\n';
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('STATE_TOO_LARGE');
    // SHA is mandatory: competing updates fail instead of losing another runner's events.
    await this.api('PUT', { branch: BRANCH, sha: baseline.sha, message: 'chore: persist simulated return reviews [skip ci]', content: Buffer.from(content).toString('base64') });
    return 'saved';
  }
}
if (require.main === module) {
  (async () => {
    const client = new GitHubReturnState({ repository: process.env.GITHUB_REPOSITORY || '', token: process.env.GITHUB_TOKEN || '', scope: process.env.RETURN_JOURNAL_SCOPE || '', directory: '.am4-state/github' });
    const command = process.argv[2];
    if (command === 'restore') await client.restore();
    else if (command === 'save') await client.save();
    else if (command === 'initialize') await client.initialize();
    else throw new Error('STATE_COMMAND_INVALID');
    console.log('[State] Operacao concluida.');
  })().catch(() => { console.error('[State] Falha de persistencia; verificar estado remoto, escopo, permissoes e conflito. Nenhum segredo foi registrado.'); process.exitCode = 1; });
}
