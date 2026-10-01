/** Describe an observed UI handler without exporting query values or session data. */
export function departureControlShape(callback: string): string | null {
  if (callback.length > 4000) return null;
  const shape = callback.replace(/(['"])(.*?)\1/g, (_whole, _quote, value: string) => {
    if (/^route_depart\.php\?/.test(value)) {
      const keys = value.slice(value.indexOf('?') + 1).split('&').map(p => p.split('=')[0]);
      if (!keys.every(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))) return "'<string>'";
      return "'route_depart.php?" + keys.map(k => `${k}=<value>`).join('&') + "'";
    }
    if (['neutral_click', 'detailsAction', 'routeAction', '#routeAction', '#detailsAction', '#routeViewDepart'].includes(value)) return `'${value}'`;
    return "'<string>'";
  }).replace(/\b\d+\b/g, '<number>').replace(/\s+/g, ' ').trim();
  return shape.includes('route_depart.php?') ? shape : null;
}
