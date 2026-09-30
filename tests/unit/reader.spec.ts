import { test, expect, Page } from '@playwright/test';
import { DemandReader } from '../../demand/reader';
import { FleetUtils } from '../../utils/fleet.utils';
import { runDemandSimulation } from '../../demand/run';
import { readDemandConfig } from '../../demand/config';
import { readFile } from 'node:fs/promises';

interface FixtureOptions { operational?: boolean; missingCabin?: boolean; badDemand?: boolean; wrongIdentity?: boolean; pages?: number; badCount?: boolean; loop?: boolean; missingDetails?: boolean; unknownAuto?: boolean }
async function fixture(page: Page, options: FixtureOptions = {}) {
  await page.route('**/*', route => route.abort()); // Absolutely no game or other network access.
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(String.raw`<button>Routes (${options.badCount ? 9 : options.pages === 2 ? 3 : 2})</button>
    <div id="routeAction"><div id="routesContainer"></div></div><div id="detailsAction" style="display:none"></div>
    <script>
    window.mutations=0;
    window.ticketPriceSuggest=()=>window.mutations++;
    const options=${JSON.stringify(options)};
    function render(index=0) {
      document.getElementById('routeAction').style.display='block';
      document.getElementById('detailsAction').style.display='none';
      const ids=index===0 ? [101,102] : [103];
      document.getElementById('routesContainer').innerHTML='<button id="departAll" onclick="window.mutations++">Depart all</button>'+ids.map(id=>
        '<div class="row classPAX '+(id===102?'':'listDepartable')+'" id="routeMainList'+id+'">'+
        '<span class="s-text">AAA - BBB</span><a href="#" onclick="show('+id+');return false"><span id="acRegList'+(id+1000)+'">TEST-'+id+'</span> - Test aircraft</a>'+
        (id===102?'Onboard: 40 / 0 / 0':'Demand: 90 / 0 / 0 <button id="listDepart'+id+'" onclick="window.mutations++">Depart</button>')+'</div>').join('')+
        '<ul class="pagination">'+(index===0&&options.pages===2?'<a href="#" onclick="render('+(options.loop?0:1)+');return false">Next</a>':'')+'</ul>';
    }
    function show(id) {
      if(options.missingDetails) return;
      document.getElementById('routeAction').style.display='none';
      const d=document.getElementById('detailsAction');
      d.style.display='block';
      d.innerHTML='<div id="route-name"><span class="glyphicons-chevron-left" onclick="document.getElementById(\'detailsAction\').style.display=\'none\';document.getElementById(\'routeAction\').style.display=\'block\'">Back</span></div>'+
      '<span id="ff-name">TEST-'+id+'</span>'+
      '<button id="routeViewDepart" onclick="window.mutations++; /* route_depart.php?id='+(options.wrongIdentity?999:id)+'&ref=list */">Depart</button>'+
      '<button id="routeViewGround_unground" onclick="window.mutations++">Ground</button>'+
      '<div class="col-5"><span class="l-text">BBB</span></div><div class="col-5"><span class="l-text">AAA</span></div>'+
      '<div onclick="document.getElementById(\'seat-layout\').style.display=\'block\'">Seat layout</div>'+
      '<div id="seat-layout" style="display:none">'+['economy','business','first'].map((c,i)=>'<div><img src="assets/'+c+'_seat.png"><br>'+(i?0:100)+'<div>$<input value="9999"></div></div>').join('')+'</div>'+
      '<div>Todays demand</div><div id="list-demand">'+['economy','business','first'].filter((c,i)=>!options.missingCabin||i!==1).map((c,i)=>'<div><img src="assets/'+c+'_seat.png"><br>'+(i?'0/200':options.badDemand?'90/80':'90/1000')+'</div>').join('')+'</div>';
      if(options.operational) d.insertAdjacentHTML('beforeend', '<span class="s-text">Range</span><br><span class="m-text">3,440km</span><br><span class="s-text">Min runway</span><br><span class="m-text">7,550ft</span><br><span class="s-text">Flight hours/Cycles</span><br><span class="m-text">682 / 206</span>');
      d.querySelector('#seat-layout').insertAdjacentHTML('beforeend', '<button onclick="'+(options.unknownAuto?'unknownCallback()':'ticketPriceSuggest(1234,3456,17890,this,291);')+'">Auto</button><button onclick="window.mutations++">Save</button>');
      d.querySelectorAll('#seat-layout input').forEach((el,i)=>el.id=['eTicket','bTicket','fTicket'][i]);
    }
    render();
    </script>`);
  expect(errors).toEqual([]);
  await expect(page.locator('#routeMainList101')).toBeVisible();
}
test('reader matches inspected DOM, ignores ticket prices, reads remaining/total and next leg', async ({ page }) => {
  await fixture(page); const result = await new DemandReader(page, 400).collect();
  expect(result.complete).toBe(true); expect(result.aircraft).toHaveLength(2);
  expect(result.aircraft[0]).toMatchObject({ aircraftId: '1101', routeId: '101', capacity: { Y: 100, J: 0, F: 0 }, remaining: { Y: 90, J: 0, F: 0 }, dailyTotal: { Y: 1000, J: 200, F: 200 }, from: 'BBB', to: 'AAA', state: 'ready' });
  expect(result.aircraft[1].state).toBe('inflight'); expect(await page.evaluate(() => (window as any).mutations)).toBe(0);
});
test('pagination reads every page once', async ({ page }) => {
  await fixture(page, { pages: 2 }); const r = await new DemandReader(page, 400).collect(); expect(r.complete).toBe(true); expect(r.aircraft).toHaveLength(3);
});
for (const options of [{ missingCabin: true }, { badDemand: true }, { wrongIdentity: true }, { missingDetails: true }]) {
  test(`UI loading/structure error fails closed ${JSON.stringify(options)}`, async ({ page }) => {
    await fixture(page, options); const r = await new DemandReader(page, 400).collect();
    expect(r.aircraft[0].state).toBe('unavailable'); expect(r.warnings).toContain('DETAILS_UNAVAILABLE:101');
    expect(await page.evaluate(() => (window as any).mutations)).toBe(0);
  });
}
test('route count mismatch blocks simulated approval', async ({ page }) => {
  await fixture(page, { badCount: true });
  await expect(runDemandSimulation(page, readDemandConfig({}))).rejects.toThrow('Coleta incompleta');
  const report = JSON.parse(await readFile('test-results/demand/demand-report.json', 'utf8'));
  expect(report.summary.sufficient).toBe(0); expect(report.collectionComplete).toBe(false);
});
test('pagination loop fails closed instead of duplicate evaluation', async ({ page }) => {
  await fixture(page, { pages: 2, loop: true }); expect((await new DemandReader(page, 400).collect()).complete).toBe(false);
});
test('FleetUtils simulation never clicks departAll, individual Depart or Ground', async ({ page }) => {
  await fixture(page); const previous = process.env.ENABLE_DEMAND_MANAGER; process.env.ENABLE_DEMAND_MANAGER = 'true';
  try { await new FleetUtils(page).departPlanes(); } finally {
    if (previous === undefined) delete process.env.ENABLE_DEMAND_MANAGER; else process.env.ENABLE_DEMAND_MANAGER = previous;
  }
  expect(await page.evaluate(() => (window as any).mutations)).toBe(0);
  const report = JSON.parse(await readFile('test-results/demand/demand-report.json', 'utf8'));
  expect(report.summary).toMatchObject({ sufficient: 1, notReady: 1 });
});
test('total UI load failure returns an incomplete report', async ({ page }) => {
  await page.setContent('<p>Loading</p>'); const r = await new DemandReader(page, 100).collect();
  expect(r.complete).toBe(false); expect(r.warnings).toContain('COLLECTION_FAILED');
});


test('reads automatic fare reference without clicking Auto/Save or changing prices', async ({ page }) => {
  await fixture(page); const result = await new DemandReader(page, 400).collect();
  expect(result.aircraft[0].fares).toMatchObject({ automatic: { Y: 1234, J: 3456, F: 17890 }, current: { Y: 9999, J: 9999, F: 9999 }, source: 'inspected-auto-control' });
  expect(await page.locator('#eTicket').inputValue()).toBe('9999');
  expect(await page.evaluate(() => (window as any).mutations)).toBe(0);
});
test('unknown Auto callback does not invalidate valid demand but blocks pricing', async ({ page }) => {
  await fixture(page, { unknownAuto: true }); const result = await new DemandReader(page, 400).collect();
  expect(result.aircraft[0].state).toBe('ready'); expect(result.aircraft[0].fares?.source).toBe('unavailable');
  expect(await page.evaluate(() => (window as any).mutations)).toBe(0);
});


test('operational observations reach both JSON reports without authorizing operations', async ({ page }) => {
  await fixture(page, { operational: true });
  await runDemandSimulation(page, readDemandConfig({}));
  const demand = JSON.parse(await readFile('test-results/demand/demand-report.json', 'utf8'));
  const optimization = JSON.parse(await readFile('test-results/demand/optimization-report.json', 'utf8'));
  expect(demand.decisions[0].operational).toMatchObject({rangeKm:3440,minRunwayFt:7550,cycles:206,homeBase:null,flightId:null});
  expect(optimization.aircraft[0].operational).toEqual(demand.decisions[0].operational);
  expect(optimization.aircraft[0].route.decision).toBe('unavailable');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
