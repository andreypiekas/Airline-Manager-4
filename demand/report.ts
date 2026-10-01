import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cabins, DemandReport } from './types';
const cabins = (value: Cabins | null) => value ? `${value.Y} / ${value.J} / ${value.F}` : 'indisponivel';
const safe = (text: string) => text.replace(/[|\r\n<>]/g, ' ');
export function markdownReport(report: DemandReport): string {
  const s = report.summary;
  return [
    '# Demanda — simulacao, sem operacoes no jogo', '',
    `Coleta completa: ${report.collectionComplete}. Aeronaves vistas: ${s.fleetSeen}; avaliadas: ${s.evaluated}; suficientes: ${s.sufficient}; insuficientes: ${s.insufficient}; indisponiveis: ${s.unavailable}; em voo: ${s.notReady}.`, '',
    'Ocupacao abaixo e o teto coberto por demanda, nao uma previsao de embarque real. Y/J/F = economica/executiva/primeira.', '',
    '| Aeronave | Rota exibida | Demanda lida Y/J/F | Disponivel apos reservas Y/J/F | Assentos Y/J/F | Teto ocupacao | Decisao | Motivo |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.decisions.map(d => `| ${safe(d.registration)} | ${safe(d.routeLabel)} | ${cabins(d.remaining)} | ${cabins(d.availableBefore)} | ${cabins(d.capacity)} | ${d.occupancyPercentage === null ? '—' : d.occupancyPercentage.toFixed(2) + '%'} | ${d.decision} | ${safe(d.reason)} |`), '',
    ...report.warnings.map(w => `- ${safe(w)}`), '',
  ].join('\n');
}
export async function writeDemandReport(report: DemandReport, directory = 'test-results/demand'): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'demand-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(directory, 'demand-report.md'), markdownReport(report));
  console.log('[Demand] ' + JSON.stringify(report.summary));
  for (const d of report.decisions.filter(d => d.decision !== 'not_ready')) console.log(`[Demand] ${safe(d.registration)}: ${d.decision} — ${safe(d.reason)}`);
}
