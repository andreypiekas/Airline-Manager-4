/** Describe an observed UI handler without exporting query values or session data. */
export function departureControlShape(callback: string): string | null {
  if (callback.length > 4000) return null;
  const shape = callback.replace(/(['"])(.*?)\1/g, (_whole, _quote, value: string) => {
    if (/^route_depart\.php\?/.test(value)) {
      const pairs = value.slice(value.indexOf('?') + 1).split('&').map(p => p.split('='));
      if (!pairs.every(p => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p[0]))) return "'<string>'";
      return "'route_depart.php?" + pairs.map(([k,v]) => `${k}=${k==='ref' && ['list','details','fleet','route','single'].includes(v)?v:k==='costIndex' && /^\d{1,3}$/.test(v) && Number(v)<=200?v:'<value>'}`).join('&') + "'";
    }
    if (['neutral_click', 'detailsAction', 'routeAction', '#routeAction', '#detailsAction', '#routeViewDepart'].includes(value)) return `'${value}'`;
    // Static CSS selectors and named UI target arguments, never arbitrary query values.
    if (/^#[A-Za-z][A-Za-z_-]{0,50}$/.test(value) || ['doNotShow','doNothing','nothing','dummy','blank','notification','notifications','routeView','routeDepart'].includes(value)) return `'${value}'`;
    return "'<string>'";
  }).replace(/\b\d+\b/g, '<number>').replace(/\s+/g, ' ').trim();
  return shape.includes('route_depart.php?') ? shape : null;
}
