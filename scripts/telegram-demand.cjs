// Optional aggregate-only notification. No aircraft names, balances, HTML or credentials in output.
const fs = require('node:fs');
const https = require('node:https');
function message(report) {
  const s = report.summary;
  if (!s || !['evaluated', 'sufficient', 'insufficient', 'unavailable'].every(k => Number.isSafeInteger(s[k]) && s[k] >= 0)) throw new Error('invalid report');
  if (report.collectionComplete && s.insufficient === 0 && s.unavailable === 0) return null;
  return `AM4 demanda (simulacao): avaliadas ${s.evaluated}; suficientes ${s.sufficient}; insuficientes ${s.insufficient}; indisponiveis ${s.unavailable}; coleta ${report.collectionComplete ? 'completa' : 'incompleta'}. Nenhuma operacao executada pelo modulo.`;
}
async function main() {
  if (process.env.DEMAND_TELEGRAM_ENABLED !== 'true') return;
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log('[Demand] Telegram nao configurado.'); return; }
  if (!fs.existsSync('test-results/demand/demand-report.json')) return;
  const text = message(JSON.parse(fs.readFileSync('test-results/demand/demand-report.json', 'utf8')));
  if (!text) return;
  const body = JSON.stringify({ chat_id: chatId, text });
  await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 15000 }, res => {
      res.resume(); res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error('Telegram failed')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', () => reject(new Error('Telegram failed'))); req.end(body);
  });
}
if (require.main === module) main().catch(() => { console.error('[Demand] Nao foi possivel enviar o resumo Telegram.'); process.exitCode = 1; });
module.exports = { message };
