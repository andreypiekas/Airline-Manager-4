export interface RouteCreateControlEvidence {
  observed: boolean;
  visible: boolean;
  enabled: boolean;
  id: string | null;
  label: string | null;
  onclickShape: string | null;
  phpEndpoints: string[];
  ajaxTargets: string[];
  mutationAuthorized: false;
}

const redact = (raw:string) =>
  raw.replace(/\d+/g,'#').replace(/\s+/g,' ').trim().slice(0,500);

/**
 * Passive evidence only. The callback is inspected in memory and reduced to a
 * redacted structural shape. It never authorizes or performs a route change.
 */
export function inspectRouteCreateControl(raw:{
  id:string|null;label:string|null;onclick:string|null;visible:boolean;enabled:boolean;
}):RouteCreateControlEvidence {
  const onclick=(raw.onclick||'').trim();
  const phpEndpoints=[...new Set(Array.from(onclick.matchAll(/([A-Za-z0-9_-]+\.php)(?:\?|['"])/g),m=>m[1]))].slice(0,10);
  const ajaxTargets=[...new Set(Array.from(onclick.matchAll(/Ajax\([^,]+,\s*['"]([A-Za-z_][A-Za-z0-9_-]{0,80})['"]/g),m=>m[1]))].slice(0,10);
  return {
    observed:!!onclick,
    visible:raw.visible,
    enabled:raw.enabled,
    id:raw.id?.slice(0,100)||null,
    label:raw.label?.replace(/\s+/g,' ').trim().slice(0,100)||null,
    onclickShape:onClickShape(onclick),
    phpEndpoints,
    ajaxTargets,
    mutationAuthorized:false
  };
}
function onClickShape(onclick:string){return onclick?redact(onclick):null;}
