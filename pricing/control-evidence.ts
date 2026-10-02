export type PricingSaveTarget = 'route' | 'aircraft' | 'other' | 'unavailable';

export interface PricingSaveControlEvidence {
  endpointVerified: boolean;
  target: PricingSaveTarget;
  targetMatchesContext: boolean;
  shape: string | null;
}

const redactShape = (raw: string) =>
  raw.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Passive parser only. It validates the exact native Save callback that was
 * inspected in production, extracts the numeric target in memory and returns
 * only a redacted shape plus whether that target matches the current
 * aircraft/route context. It never clicks or submits anything.
 */
export function inspectPricingSaveControl(
  onclick: string | null | undefined,
  aircraftId: string,
  routeId: string
): PricingSaveControlEvidence {
  const raw = (onclick || '').trim();
  const unavailable: PricingSaveControlEvidence = {
    endpointVerified: false,
    target: 'unavailable',
    targetMatchesContext: false,
    shape: raw ? redactShape(raw) : null,
  };
  if (!/^\d+$/.test(aircraftId) || !/^\d+$/.test(routeId) || !raw) return unavailable;

  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(
    /^playSound\('neutral_click'\);Ajax\('set_ticket_prices\.php\?e='\+\$\('#eTicket'\)\.val\(\)\+'&b='\+\$\('#bTicket'\)\.val\(\)\+'&f='\+\$\('#fTicket'\)\.val\(\)\+'&id=(\d+)','runme',this\);$/
  );
  if (!match) return unavailable;

  const id = match[1];
  const target: PricingSaveTarget =
    id === routeId ? 'route' :
    id === aircraftId ? 'aircraft' :
    'other';

  return {
    endpointVerified: true,
    target,
    targetMatchesContext: target === 'route' || target === 'aircraft',
    shape: redactShape(raw),
  };
}
