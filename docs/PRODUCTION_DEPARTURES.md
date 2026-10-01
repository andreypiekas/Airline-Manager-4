# Decolagens individuais em producao

O executor suporta **somente o retorno para a propria base pela rota existente**. Nao compra combustivel/CO2, nao executa servicos, nao modifica rotas nem tarifas. A comparacao economica de candidatas continua sem fornecedores completos de saldo, horarios futuros e custos efetivos; uma aeronave na propria base fica em solo com `BASE_ROUTE_REVIEW_INCOMPLETE`.

## Controles

- `DEMAND_DRY_RUN=true` continua como padrao. Simulacao usa o mesmo leitor e verifica o mesmo controle, sem clicar em Depart.
- Execucao real: `DEMAND_DRY_RUN=false`, `ENABLE_DEMAND_MANAGER=true`, `DEMAND_FAIL_SAFE=true`, `DEMAND_EXECUTION_ACK=individual-return-legs-v1`.
- Somente Actions deste repositorio, com `GITHUB_RUN_ATTEMPT=1`, pode usar a entrada real. Reruns sao rejeitados antes do login.
- `DEMAND_MAX_DEPARTURES_PER_RUN=1` por padrao, configuravel entre 1 e 20. O limite tambem vale na simulacao do executor.
- Pool `airport-pair` obrigatorio em execucao real enquanto o compartilhamento direcional nao estiver confirmado. Limite inicial de cobertura por demanda: 80% agregado; classes sem assentos nao penalizam a aeronave.
- Um marcador exclusivo impede repetir a entrada no mesmo runner. Identidades e rotas tentadas sao registradas antes do clique. Concurrency compartilhada com todos os workflows da companhia, worker unico e zero retries.

## Fluxo

1. Coleta integral fresca, com detalhes de cada aeronave vinculada a rota.
2. Nova coleta antes de cada alvo original; pousos durante a execucao aguardam a proxima execucao.
3. Origem explicita por ID ou unica base nos extremos da rota. Origem ambigua, revisao incompleta na base ou destino diferente da propria base: retencao.
4. Releitura individual de identidade, trecho, layout e demanda restante. Demanda diaria nunca substitui saldo restante.
5. Alocacao conservadora entre aeronaves prontas do mesmo par, pela ordem dos cartoes. Nao e um otimizador de lucro nem um horario futuro confirmado.
6. Verificacao do handler inteiro observado em Actions 36917592989 e 36918147380, com somente efeitos de interface e `route_depart.php?id=...&ref=list&costIndex=...`. Comentarios com URLs, comandos extras, parametros extras e IDs divergentes sao rejeitados. O indice nativo nao e alterado.
7. Persistencia de `attempting` antes de um unico clique nativo em `#detailsAction #routeViewDepart`. Nenhuma chamada manual ao endpoint.
8. Resposta nativa HTTP bem-sucedida seguida de nova coleta: identidade/trecho/layout, estado em voo, contador fresco e passageiros embarcados. Isso confirma a decolagem; a cobertura por demanda anterior nao e uma previsao de embarque.
9. Falha apos tentativa de clique: `outcome_unknown`, encerramento sem retry, sem `departAll` e sem continuar com outras aeronaves.

## Executar

Depois da publicacao na main, o workflow **Decolagens individuais controladas** permite `execute=false` (simulacao) ou `execute=true`, com `max_departures=1` inicialmente.

O workflow principal **Automacao Airline Manager 4** tambem aceita `execute_individual=true` e `max_individual_departures=1`. Sem o input explicito, faz somente simulacao. A entrada publicada fixa gerenciador/fail-safe ativos; nao ativa o legado por variaveis antigas.

O cron-job.org continua usando o workflow_dispatch existente. Para usar a execucao real controlada, o corpo pode conter:

```json
{"ref":"main","inputs":{"execute_individual":true,"max_individual_departures":1}}
```

Nao publicar o token do disparo. Nenhuma configuracao do cron foi alterada por esta entrega. As operacoes manuais no jogo ou outros repositorios nao sao cobertas pela trava deste repositorio.

## Relatorios e limites

`execution-report.json/.md` registra decisoes, dados por classe, cobertura por demanda, intentos e passageiros reais observados. Artefatos ficam por sete dias, sem credenciais, HTML, cookies, tokens, trace ou video de login.

O controlador pode executar com todas as aeronaves retidas: isso significa que os requisitos nao estavam satisfeitos, e nao que houve uma decolagem. Um status verde nao substitui conferir `summary.departed` e `summary.unknown`.

Alteracao automatica de rotas, tarifas, custos efetivos completos, renovacao/agenda futura e a revisao economica diaria completa continuam bloqueados. Esta capacidade de producao nao declara o otimizador completo pronto.

## Evidencias de 01/10/2026

Simulacao autenticada: Actions 36919208772. Piloto real autorizado: Actions 36920005857, com uma decolagem confirmada por coleta posterior e nenhum resultado incerto. CI do piloto: Actions 36920013310. O gatilho temporario por push foi removido; a versao publicada aceita apenas acionamento manual/API.
