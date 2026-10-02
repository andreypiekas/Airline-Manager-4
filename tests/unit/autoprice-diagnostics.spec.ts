import { test, expect } from '@playwright/test';
import { inspectAutopriceFunctionSource } from '../../optimization/autoprice-diagnostics';

test('classifies DOM-only autoPrice without executing it',()=>{
  const source=`function autoPrice(e,b,f,model){
    if(model===383){ e=Math.ceil(e*18/10); }
    $('#eSeat').val(e); $('#bSeat').val(b); $('#fSeat').val(f);
  }`;
  const r=inspectAutopriceFunctionSource(source);
  expect(r).toMatchObject({
    observed:true,functionName:'autoPrice',networkMutationObserved:false,
    formTargets:{economy:true,business:true,first:true},jqueryValueWrites:true,
    comparisonReady:false,mutationAuthorized:false
  });
  expect(r.numericConstants).toEqual(expect.arrayContaining([383,18,10]));
  expect(r.modelIds).toContain(383);
});

test('network-capable autoPrice is explicitly flagged',()=>{
  const r=inspectAutopriceFunctionSource(`function autoPrice(e,b,f,model){ Ajax('price.php','x',this); $('#eSeat').val(e); }`);
  expect(r.observed).toBe(true);
  expect(r.networkMutationObserved).toBe(true);
});

test('unknown function source remains unavailable',()=>{
  expect(inspectAutopriceFunctionSource(null).observed).toBe(false);
  expect(inspectAutopriceFunctionSource('function other(){}').observed).toBe(false);
});
