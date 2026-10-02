import { test, expect } from '@playwright/test';
import { effectiveAutopriceBase, inspectAutopriceFunctionSource } from '../../optimization/autoprice-diagnostics';

const observedSource=`function autoPrice(e,t,a,o){
  [371,383,384].includes(o)&&(e=Math.ceil(1.8*e),t=Math.ceil(1.8*t),a=Math.ceil(1.8*a)),
  $("#introAuto").hide(),
  1==intro&&(Ajax("ddna_logger.php?intro="+intro,"runme")),
  $("#eSeat").val(e).effect("highlight"),
  setTimeout(function(){$("#bSeat").val(t).effect("highlight")},200),
  setTimeout(function(){$("#fSeat").val(a).effect("highlight")},400)
}`;

test('verifies the observed AM4 VIP Autoprice transform without invoking it',()=>{
  const r=inspectAutopriceFunctionSource(observedSource);
  expect(r).toMatchObject({
    observed:true,functionName:'autoPrice',networkMutationObserved:true,
    networkEndpoints:['ddna_logger.php'],pricingMutationNetworkObserved:false,
    formTargets:{economy:true,business:true,first:true},jqueryValueWrites:true,
    fareTransformVerified:true,vipModelIds:[371,383,384],vipMultiplier:1.8,
    modelIds:[371,383,384],comparisonReady:false,mutationAuthorized:false
  });
  expect(r.numericConstants).toEqual(expect.arrayContaining([371,383,384,1.8,200,400]));
});

test('derives effective VIP Auto fares only from verified function evidence',()=>{
  const evidence=inspectAutopriceFunctionSource(observedSource);
  expect(effectiveAutopriceBase({Y:1000,J:2000,F:3000},383,evidence)).toEqual({Y:1800,J:3600,F:5400});
  expect(effectiveAutopriceBase({Y:1000,J:2000,F:3000},39,evidence)).toEqual({Y:1000,J:2000,F:3000});
});

test('network-capable pricing endpoint keeps transform unverified',()=>{
  const source=observedSource.replace(
    '$("#introAuto").hide(),',
    'Ajax("set_price.php?x=1","runme"),$("#introAuto").hide(),'
  );
  const r=inspectAutopriceFunctionSource(source);
  expect(r.observed).toBe(true);
  expect(r.pricingMutationNetworkObserved).toBe(true);
  expect(r.fareTransformVerified).toBe(false);
  expect(effectiveAutopriceBase({Y:1000,J:2000,F:3000},383,r)).toBeNull();
});

test('unknown function source remains unavailable',()=>{
  expect(inspectAutopriceFunctionSource(null).observed).toBe(false);
  expect(inspectAutopriceFunctionSource('function other(){}').observed).toBe(false);
});
