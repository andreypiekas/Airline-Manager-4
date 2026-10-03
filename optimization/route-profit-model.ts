export interface RouteProfitModelEvidence {
  status:'verified_route_variable_model';
  verified:true;
  componentSet:readonly ['income','fuel','co2','aCheck','repair'];
  excludedCompanyLevel:readonly ['marketing','staff','inventory','hub'];
  sourceRepository:'abc8747/am4';
  sourceCommit:'d243dcd13d102b28a548b6346af62fbd62c7c9aa';
  sourcePath:'src/am4/utils/cpp/route.cpp';
  formulaShape:'income-fuel-co2-aCheck-repair';
  mutationAuthorized:false;
}

/**
 * Pinned provenance for the AM4 route-profit model used by the variable-cycle
 * comparison. Company-level cash flows are not silently allocated to a route.
 * Live account evidence still has to verify each route-specific input.
 */
export function routeProfitModelEvidence():RouteProfitModelEvidence {
  return {
    status:'verified_route_variable_model',
    verified:true,
    componentSet:['income','fuel','co2','aCheck','repair'],
    excludedCompanyLevel:['marketing','staff','inventory','hub'],
    sourceRepository:'abc8747/am4',
    sourceCommit:'d243dcd13d102b28a548b6346af62fbd62c7c9aa',
    sourcePath:'src/am4/utils/cpp/route.cpp',
    formulaShape:'income-fuel-co2-aCheck-repair',
    mutationAuthorized:false
  };
}
