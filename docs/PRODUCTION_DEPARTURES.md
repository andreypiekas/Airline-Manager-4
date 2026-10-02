# Decolagens individuais em producao

O executor opera **os dois sentidos da rota existente**: pode sair da propria base ou retornar para ela, desde que identidade, rota, controle nativo e demanda fresca estejam validados. O workflow principal executa abastecimento separado antes da frota, conforme [SUPPLIES.md](SUPPLIES.md); o executor isolado nao compra. Nao modifica rotas nem tarifas.

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
3. Origem explicita por ID ou unica base nos extremos da rota. O trecho atual precisa incluir a base operacional confirmada: pode sair dela ou retornar para ela. Origem ambigua ou trecho sem a base confirmada: retencao.
4. Releitura individual de identidade, trecho, layout e demanda restante. Demanda diaria nunca substitui saldo restante.
5. Alocacao conservadora entre aeronaves prontas do mesmo par, pela ordem dos cartoes. Nao e um otimizador de lucro nem um horario futuro confirmado.
6. Verificacao do handler inteiro observado em Actions 36917592989 e 36918147380, com somente efeitos de interface e `route_depart.php?id=...&ref=list&costIndex=...`. Comentarios com URLs, comandos extras, parametros extras e IDs divergentes sao rejeitados. O indice nativo nao e alterado.
7. Persistencia de `attempting` antes de um unico clique nativo em `#detailsAction #routeViewDepart`. Nenhuma chamada manual ao endpoint.
8. Resposta nativa HTTP bem-sucedida seguida de nova coleta: identidade/trecho/layout, estado em voo, contador fresco e passageiros embarcados. Isso confirma a decolagem; a cobertura por demanda anterior nao e uma previsao de embarque.
9. Falha apos tentativa de clique: `outcome_unknown`, encerramento sem retry, sem `departAll` e sem continuar com outras aeronaves.

## Executar

Depois da publicacao na main, o workflow **Decolagens individuais controladas** permite `execute=false` (simulacao) ou `execute=true`, com `max_departures=1` inicialmente.

O workflow principal **Automacao Airline Manager 4** tambem aceita `execute_individual=true` e `max_individual_departures=1`. Sem o input explicito, usa a politica configurada em `EXECUTE_INDIVIDUAL`, descrita abaixo. A entrada publicada fixa gerenciador/fail-safe ativos; nao ativa o legado por variaveis antigas.

Os dois workflows agora respeitam as variaveis do repositorio `EXECUTE_INDIVIDUAL=true` e `MAX_INDIVIDUAL_DEPARTURES=1`. Nesse caso, disparos existentes do cron-job.org, mesmo sem novos inputs, ativam o executor real limitado. Sem a variavel de ativacao, permanece simulacao. A antiga variavel `DEMAND_DRY_RUN` do repositorio nao governa estes workflows: o valor efetivo e calculado pelo resolvedor e registrado em `[DepartureConfig]`.

`departure_mode=simulation` sempre impede decolagens reais, inclusive com a variavel de ativacao ligada. `departure_mode=production` solicita producao explicitamente. O padrao `repository` usa a politica do repositorio; os inputs de ativacao anteriores continuam compativeis. Limite de input positivo sobrescreve a variavel; `0` (novo padrao) usa `MAX_INDIVIDUAL_DEPARTURES`, ou 1 se ausente. Valores invalidos interrompem antes do login.

O cron-job.org continua usando o workflow_dispatch existente. Para uma execucao real explicita, o corpo pode conter:

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

## Correcao da ativacao por variaveis

A execucao 36922342131 permaneceu em simulacao porque a primeira versao lia apenas inputs e ignorava as variaveis de ativacao criadas pelo operador. O resolvedor compartilhado liga essas variaveis aos dois workflows e informa modo, limite e origem de cada configuracao antes do login. Inicie uma nova execucao na main atualizada; rerun utiliza o codigo antigo e execucoes reais de segunda tentativa sao bloqueadas.
