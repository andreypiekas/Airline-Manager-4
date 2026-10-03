export interface RouteResponseDiagnostic {
  endpoint:'new_route_info.php';
  observed:boolean;
  hiddenInputs:Array<{name:string;valueShape:string|null}>;
  scriptSignals:string[];
  phpEndpoints:string[];
  demandSignals:string[];
  mutationAuthorized:false;
}

const sanitize=(value:string)=>{
  return value
    .replace(/[A-Fa-f0-9]{24,}/g,'<token>')
    .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\s)]+)/g,'$1=<value>')
    .replace(/\b\d{6,}\b/g,'#')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,500);
};

/**
 * Parses the already-returned read-only route quote response. It never performs
 * a network request and never treats any discovered field as actionable.
 */
export function inspectRouteQuoteResponse(html:string):RouteResponseDiagnostic{
  const base:RouteResponseDiagnostic={
    endpoint:'new_route_info.php',observed:false,hiddenInputs:[],scriptSignals:[],phpEndpoints:[],
    demandSignals:[],mutationAuthorized:false
  };
  if(typeof html!=='string'||html.length<1||html.length>2_000_000)return base;

  const inputs=[...html.matchAll(/<input\b[^>]*type=['"]?hidden['"]?[^>]*>/gi)].flatMap(m=>{
    const tag=m[0];
    const name=tag.match(/\bname=['"]([^'"]{1,100})['"]/i)?.[1]||tag.match(/\bid=['"]([^'"]{1,100})['"]/i)?.[1];
    if(!name)return [];
    const value=tag.match(/\bvalue=['"]([^'"]{0,300})['"]/i)?.[1]??null;
    return [{name,valueShape:value===null?null:sanitize(value)}];
  }).slice(0,80);

  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const relevantLines=scripts.split(/[;\n]+/).map(s=>sanitize(s)).filter(Boolean)
    .filter(s=>/demand|remain|remaining|pax|seat|route|airport|costindex|endcost|fare|price|quota|fuel|co2|flight/i.test(s))
    .slice(0,120);
  const endpoints=[...new Set(Array.from((html+'\n'+scripts).matchAll(/([A-Za-z0-9_-]+\.php)(?:\?|['"\s]|$)/g),m=>m[1]))].slice(0,40);
  const demandSignals=relevantLines.filter(s=>/demand|remain|remaining|pax|seat/i.test(s)).slice(0,80);

  return {
    endpoint:'new_route_info.php',
    observed:true,
    hiddenInputs:inputs,
    scriptSignals:[...new Set(relevantLines)],
    phpEndpoints:endpoints,
    demandSignals:[...new Set(demandSignals)],
    mutationAuthorized:false
  };
}
