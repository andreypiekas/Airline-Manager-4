import { test,expect,Page } from '@playwright/test';
import type { AircraftSnapshot } from '../../demand/types';
import type { RouteExecutionCandidate } from '../../optimization/route-executor';
import { PlaywrightRouteExecutionPort, routePrepareStepTimeout } from '../../optimization/route-playwright-port';
import { inspectRouteMutationHandlerSource } from '../../optimization/route-mutation-control';

const handlerSource=`function() {
  var reg = $('#routeReg').val();
  if(reg.length>0) {
    var eSeat = $('#eSeat').val();
    var bSeat = $('#bSeat').val();
    var fSeat = $('#fSeat').val();
    if(eSeat>0 && bSeat>0 && fSeat>0) {
      isItrouteClick = false;
      addAirpAndHubs();
      $(this).remove();
      Ajax('new_route_info.php?mode=do&id=101&airportId=300&reg='+reg+'&e='+eSeat+'&b='+bSeat+'&f='+fSeat+'&endCostIndex='+endCostIndex+'&stopoverId=0&ferry=0&intro='+intro,'routeNewAction',this,false,true);
    }
  }
}`;

const aircraft:AircraftSnapshot={
  aircraftId:'101',registration:'TEST-101',routeId:'9001',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',
  capacity:{Y:100,J:10,F:5},remaining:{Y:100,J:10,F:5},dailyTotal:{Y:200,J:20,F:10},observedAt:new Date().toISOString()
};
const target=():RouteExecutionCandidate=>({
  aircraftId:'101',from:'AAA',to:'CCC',airportId:'300',comparisonReady:true,observedAt:new Date().toISOString(),
  capacity:{Y:100,J:10,F:5},autoFares:{Y:1000,J:2000,F:3000},costIndex:200,distanceKm:1200,durationSeconds:5400,
  fuelLbs:12000,co2KgPerPaxKm:.12,routeFee:25000,
  routeMutationControl:inspectRouteMutationHandlerSource(handlerSource,{aircraftId:'101',airportId:'300'})
});

async function fixture(page:Page,autoFares={Y:1000,J:2000,F:3000}){
  await page.route('https://am4.test/**',async route=>route.fulfill({
    status:200,headers:{'Access-Control-Allow-Origin':'*'},body:'ok'
  }));
  const html=`
    <div id="newRouteInfo">
      <input id="routeReg" value="XP-0033">
      <input id="eSeat" value="1"><input id="bSeat" value="1"><input id="fSeat" value="1">
      <span id="costIndexBar">200</span>
      <button id="introAuto">Autoprice</button>
      <button id="btnCreateNewRoute">Create route</button>
    </div>
    <script>
      window.endCostIndex=200;window.intro=0;window.charter=0;window.isItrouteClick=true;window.routeMutations=0;
      function addAirpAndHubs(){}
      function jq(sel){
        const el=typeof sel==='string'?document.querySelector(sel):sel;
        return {
          val(v){if(arguments.length){el.value=String(v);return this;}return el.value;},
          remove(){window.routeMutations++;el.remove();return this;}
        };
      }
      window.$=jq;window.jQuery=jq;
      function Ajax(url){fetch('https://am4.test/'+url);}
      const nativeHandler=eval('('+${JSON.stringify(handlerSource)}+')');
      jq._data=(el,key)=>key==='events'&&el.id==='btnCreateNewRoute'?{click:[{handler:nativeHandler,selector:null}]}:null;
      document.querySelector('#btnCreateNewRoute').addEventListener('click',nativeHandler);
      document.querySelector('#introAuto').addEventListener('click',()=>{
        jq('#eSeat').val(${autoFares.Y});jq('#bSeat').val(${autoFares.J});jq('#fSeat').val(${autoFares.F});
      });
    </script>
  `;
  await page.setContent(html);
}

test('prepared route uses native Auto values and performs exactly one verified Create route request',async({page})=>{
  await fixture(page);
  const port=new PlaywrightRouteExecutionPort(page,1000);
  (port as any).prepared={aircraft:{...aircraft},target:target(),routeRegistration:'XP-0033'};
  await port.reroute({...aircraft},target());
  expect(await page.evaluate(()=>(window as any).routeMutations)).toBe(1);
});

test('changed native Auto values stop before Create route mutation',async({page})=>{
  await fixture(page,{Y:1001,J:2000,F:3000});
  const port=new PlaywrightRouteExecutionPort(page,1000);
  (port as any).prepared={aircraft:{...aircraft},target:target(),routeRegistration:'XP-0033'};
  await expect(port.reroute({...aircraft},target())).rejects.toThrow('ROUTE_AUTOPRICE_VALUE_CHANGED');
  expect(await page.evaluate(()=>(window as any).routeMutations)).toBe(0);
});

test('changed Create route handler stops before native mutation',async({page})=>{
  await fixture(page);
  const port=new PlaywrightRouteExecutionPort(page,1000);
  (port as any).prepared={aircraft:{...aircraft},target:target(),routeRegistration:'XP-0033'};
  await page.evaluate(()=>{
    const jq:any=(window as any).jQuery;
    const bad=function(){};
    jq._data=(el:any,key:string)=>key==='events'&&el.id==='btnCreateNewRoute'?{click:[{handler:bad,selector:null}]}:null;
  });
  await expect(port.reroute({...aircraft},target())).rejects.toThrow('ROUTE_CREATE_CONTROL_CHANGED');
  expect(await page.evaluate(()=>(window as any).routeMutations)).toBe(0);
});


test('reroute preparation uses a strict per-operation timeout without reducing shorter configured limits',()=>{
  expect(routePrepareStepTimeout(15_000)).toBe(5_000);
  expect(routePrepareStepTimeout(1_000)).toBe(1_000);
  expect(()=>routePrepareStepTimeout(0)).toThrow('ROUTE_TIMEOUT_INVALID');
});
