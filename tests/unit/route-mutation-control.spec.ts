import { test, expect } from '@playwright/test';
import { inspectRouteMutationHandlerSource } from '../../optimization/route-mutation-control';

const source=(aircraftId='101',airportId='200')=>`function() {
  var reg = $('#routeReg').val();
  if(reg.length>0) {
    var eSeat = $('#eSeat').val();
    var bSeat = $('#bSeat').val();
    var fSeat = $('#fSeat').val();
    if(eSeat>0 && bSeat>0 && fSeat>0) {
      isItrouteClick = false;
      addAirpAndHubs();
      if(charter==1) {
        var cCycles = $('#charterCycles').val();
        if(is_numeric(cCycles) && cCycles>0 && cCycles<=10) {
          $(this).remove();
          Ajax('new_route_info.php?mode=do&id=${aircraftId}&airportId=${airportId}&reg='+reg+'&e='+eSeat+'&b='+bSeat+'&f='+fSeat+'&endCostIndex='+endCostIndex+'&stopoverId=0&ferry=0&charter=1&cycles='+cCycles+'&intro='+intro,'routeNewAction',this,false,true);
        }
      } else {
        /* Ajax('new_route_info.php?mode=old&id=999&airportId=999&reg='+reg+'&e='+eSeat+'&b='+bSeat+'&f='+fSeat+'&stopoverId=0&ferry=0&intro='+intro,'routeNewAction',this,false,true); */
        $(this).remove();
        Ajax('new_route_info.php?mode=do&id=${aircraftId}&airportId=${airportId}&reg='+reg+'&e='+eSeat+'&b='+bSeat+'&f='+fSeat+'&endCostIndex='+endCostIndex+'&stopoverId=0&ferry=0&intro='+intro,'routeNewAction',this,false,true);
      }
    }
  }
}`;

test('verified native Create route handler matches aircraft and airport context',()=>{
  const r=inspectRouteMutationHandlerSource(source(),{aircraftId:'101',airportId:'200'});
  expect(r).toMatchObject({
    observed:true,source:'jquery-direct-click',endpointVerified:true,targetVerified:true,
    aircraftIdMatchesContext:true,airportIdMatchesContext:true,
    registrationInputVerified:true,seatInputsVerified:true,endCostIndexVerified:true,
    nonCharterBranchVerified:true,charterBranchObserved:true,stopoverIds:[0],ferryModes:[0],directRouteVerified:true,
    nativeClickReady:true,mutationAuthorized:false
  });
  expect(r.shape).toContain('new_route_info.php?mode=do&id=#&airportId=#');
  expect(r.shape).not.toContain('101');
  expect(r.shape).not.toContain('200');
  expect(r.shape).not.toContain('999');
});

test('aircraft context mismatch fails closed',()=>{
  const r=inspectRouteMutationHandlerSource(source('102','200'),{aircraftId:'101',airportId:'200'});
  expect(r.aircraftIdMatchesContext).toBe(false);
  expect(r.nativeClickReady).toBe(false);
});

test('airport context mismatch fails closed',()=>{
  const r=inspectRouteMutationHandlerSource(source('101','201'),{aircraftId:'101',airportId:'200'});
  expect(r.airportIdMatchesContext).toBe(false);
  expect(r.nativeClickReady).toBe(false);
});

test('unknown endpoint or missing seat guard fails closed',()=>{
  const unknown=source().replaceAll('new_route_info.php','other.php');
  expect(inspectRouteMutationHandlerSource(unknown,{aircraftId:'101',airportId:'200'}).nativeClickReady).toBe(false);
  const missing=source().replace('if(eSeat>0 && bSeat>0 && fSeat>0)','if(eSeat>0)');
  expect(inspectRouteMutationHandlerSource(missing,{aircraftId:'101',airportId:'200'}).nativeClickReady).toBe(false);
});

test('stopover or ferry handler remains observable but is not direct-route evidence',()=>{
  const stopover=source().replaceAll('stopoverId=0','stopoverId=12');
  const s=inspectRouteMutationHandlerSource(stopover,{aircraftId:'101',airportId:'200'});
  expect(s).toMatchObject({endpointVerified:true,stopoverIds:[12],ferryModes:[0],directRouteVerified:false});
  const ferry=source().replaceAll('ferry=0','ferry=1');
  const f=inspectRouteMutationHandlerSource(ferry,{aircraftId:'101',airportId:'200'});
  expect(f).toMatchObject({endpointVerified:true,stopoverIds:[0],ferryModes:[1],directRouteVerified:false});
  expect(s.mutationAuthorized).toBe(false);expect(f.mutationAuthorized).toBe(false);
});

test('invalid expected ids never classify a control',()=>{
  expect(inspectRouteMutationHandlerSource(source(),{aircraftId:'x',airportId:'200'}).observed).toBe(false);
  expect(inspectRouteMutationHandlerSource(null,{aircraftId:'101',airportId:'200'}).observed).toBe(false);
});
