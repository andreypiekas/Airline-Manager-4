import { test,expect } from '@playwright/test';
import { inspectRouteQuoteResponse } from '../../optimization/route-response-diagnostics';

test('extracts demand-related response structure without authorizing mutation',()=>{
  const html=`
    <input type="hidden" id="routeMode" value="2">
    <input type="hidden" name="airportId" value="12345">
    <script>
      var dailyDemandY = 1000;
      var remainingPax = 42;
      Ajax('new_route_info.php?mode=do&id=123456&airportId=12345','routeNewAction',this);
    </script>`;
  const r=inspectRouteQuoteResponse(html);
  expect(r.observed).toBe(true);
  expect(r.hiddenInputs.map(x=>x.name)).toEqual(['routeMode','airportId']);
  expect(r.phpEndpoints).toContain('new_route_info.php');
  expect(r.demandSignals.some(x=>/dailyDemandY/i.test(x))).toBe(true);
  expect(r.demandSignals.some(x=>/remainingPax/i.test(x))).toBe(true);
  expect(r.mutationAuthorized).toBe(false);
});

test('redacts long ids and query values from response snippets',()=>{
  const r=inspectRouteQuoteResponse(`
    <script>
      const token='0123456789abcdef0123456789abcdef';
      Ajax('route.php?id=123456&airportId=999999','x',this);
      const remainingDemand=777;
    </script>`);
  const serialized=JSON.stringify(r);
  expect(serialized).not.toContain('0123456789abcdef0123456789abcdef');
  expect(serialized).not.toContain('123456');
  expect(serialized).not.toContain('999999');
  expect(serialized).toContain('route.php');
  expect(serialized).toContain('remainingDemand');
});

test('oversized or empty response fails closed',()=>{
  expect(inspectRouteQuoteResponse('').observed).toBe(false);
  expect(inspectRouteQuoteResponse('x'.repeat(2_000_001)).observed).toBe(false);
});
