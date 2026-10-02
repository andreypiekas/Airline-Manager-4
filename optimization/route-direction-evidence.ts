export interface RouteDirectionEvidence {
  primaryFrom:string|null;
  primaryTo:string|null;
  headerFrom:string|null;
  headerTo:string|null;
  primaryMatchesContext:boolean;
  headerMatchesContext:boolean;
  independentSourcesAgree:boolean;
  verified:boolean;
  mutationAuthorized:false;
}

/**
 * Requires two independently rendered route-code sources to agree with the
 * candidate identity. This is evidence only and never authorizes a mutation.
 */
export function inspectRouteDirectionEvidence(
  primaryCodes:readonly (string|null|undefined)[],
  headerLabel:string|null|undefined,
  expected:{from:string;to:string}
):RouteDirectionEvidence {
  const valid=(v:string|null|undefined)=>typeof v==='string'&&/^[A-Z0-9]{3}$/.test(v)?v:null;
  const primaryFrom=valid(primaryCodes[0]);
  const primaryTo=valid(primaryCodes[1]);
  const header=typeof headerLabel==='string'
    ? headerLabel.trim().match(/^([A-Z0-9]{3})\s+[\d,]+\s*km\s+([A-Z0-9]{3})$/)
    : null;
  const headerFrom=header?.[1]||null;
  const headerTo=header?.[2]||null;
  const primaryMatchesContext=primaryCodes.length===2&&primaryFrom===expected.from&&primaryTo===expected.to;
  const headerMatchesContext=headerFrom===expected.from&&headerTo===expected.to;
  const independentSourcesAgree=!!primaryFrom&&!!primaryTo&&primaryFrom===headerFrom&&primaryTo===headerTo;
  return {
    primaryFrom,primaryTo,headerFrom,headerTo,
    primaryMatchesContext,headerMatchesContext,independentSourcesAgree,
    verified:primaryMatchesContext&&headerMatchesContext&&independentSourcesAgree,
    mutationAuthorized:false
  };
}
