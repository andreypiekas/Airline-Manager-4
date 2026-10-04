'use strict';
const fs = require('node:fs');

function booleanValue(raw, name) {
  const value = (raw || '').trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} deve ser true ou false.`);
}

/** No credentials: resolve manual/API inputs and explicitly configured repository policy. */
function resolveDepartureSettings(env) {
  const mode = (env.AM4_INPUT_MODE || 'repository').trim();

  if (!['repository', 'simulation', 'production'].includes(mode)) {
    throw new Error('departure_mode invalido.');
  }

  const inputExecute = booleanValue(env.AM4_INPUT_EXECUTE, 'input execute');
  const repositoryExecute = booleanValue(env.AM4_REPOSITORY_EXECUTE, 'EXECUTE_INDIVIDUAL');

  const execute =
    mode === 'production' ||
    (mode === 'repository' && (inputExecute || repositoryExecute));

  const modeSource =
    mode !== 'repository'
      ? `input:${mode}`
      : inputExecute
        ? 'input:execute'
        : repositoryExecute
          ? 'variable:EXECUTE_INDIVIDUAL'
          : 'default:simulation';

  // O input 0 significa "usar configuracao do repositorio".
  // Se a variavel do repositorio estiver vazia ou tambem for 0,
  // usamos o limite seguro padrao de 1 decolagem.
  const inputLimit = (env.AM4_INPUT_MAX_DEPARTURES || '').trim();
  const repositoryLimit = (env.AM4_REPOSITORY_MAX_DEPARTURES || '').trim();
  const useRepositoryLimit = inputLimit === '' || inputLimit === '0';

  let rawLimit;
  let limitSource;

  if (!useRepositoryLimit) {
    rawLimit = inputLimit;
    limitSource = 'input:limit';
  } else if (repositoryLimit === '' || repositoryLimit === '0') {
    rawLimit = '1';
    limitSource = 'default:1';
  } else {
    rawLimit = repositoryLimit;
    limitSource = 'variable:MAX_INDIVIDUAL_DEPARTURES';
  }

  if (!/^[1-9]\d*$/.test(rawLimit)) {
    throw new Error('Limite de decolagens deve ser inteiro positivo.');
  }

  let maxDepartures = Number(rawLimit);
  if (!Number.isSafeInteger(maxDepartures)) {
    throw new Error('Limite de decolagens deve ser inteiro positivo.');
  }
  if (!useRepositoryLimit && maxDepartures > 20) {
    throw new Error('Limite de decolagens manual deve ser inteiro de 1 a 20.');
  }
  if (useRepositoryLimit && maxDepartures > 20) {
    maxDepartures = 20;
    limitSource = 'variable:MAX_INDIVIDUAL_DEPARTURES:clamped-to-20';
  }

  return {
    dryRun: !execute,
    maxDepartures,
    modeSource,
    limitSource
  };
}

function main(env = process.env) {
  const settings = resolveDepartureSettings(env);

  if (!env.GITHUB_OUTPUT) {
    throw new Error('GITHUB_OUTPUT ausente.');
  }

  fs.appendFileSync(
    env.GITHUB_OUTPUT,
    `dry_run=${settings.dryRun}\nmax_departures=${settings.maxDepartures}\n`
  );

  console.log('[DepartureConfig] ' + JSON.stringify(settings));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('[DepartureConfig] ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveDepartureSettings, main };
