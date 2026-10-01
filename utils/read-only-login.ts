import { Page } from '@playwright/test';

/** Normal sign-in only. No recordings, credential output, fingerprint changes or retries. */
export async function loginForReadOnlyCollection(page: Page, env: NodeJS.ProcessEnv = process.env, timeout = 30000, onPhase: (stage: string) => void = () => {}) {
  if (!env.EMAIL || !env.PASSWORD) throw new Error('READ_ONLY_CREDENTIALS_MISSING');
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('READ_ONLY_TIMEOUT_INVALID');
  try {
    onPhase('open_site');
    await page.goto('https://www.airlinemanager.com/', {waitUntil:'domcontentloaded',timeout});
    onPhase('open_game');
    await page.getByRole('button',{name:/^play free now$/i}).click({timeout});
    onPhase('open_login');
    await page.getByRole('button',{name:/^log in$/i}).click({timeout});
    const email=page.locator('#lEmail'),password=page.locator('#lPass');
    if (await email.getAttribute('type',{timeout}) !== 'email' || await password.getAttribute('type',{timeout}) !== 'password') throw new Error();
    onPhase('fill_login');
    await email.fill(env.EMAIL,{timeout});
    await password.fill(env.PASSWORD,{timeout});
    onPhase('submit_login');
    await page.locator('#btnLogin').click({timeout});
    onPhase('wait_company');
    await page.locator('#mapRoutes').waitFor({state:'visible',timeout});
    // The menu can render before the intro overlay finishes loading.
    onPhase('wait_intro');
    await page.locator('#am4-intro').waitFor({state:'hidden',timeout});
  } catch {
    // Discard Playwright errors: their call logs can contain form input values.
    throw new Error('READ_ONLY_LOGIN_OR_LOADING_FAILED');
  }
}
