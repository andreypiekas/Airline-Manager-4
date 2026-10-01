# Estado atual da implementação — 01/10/2026

Este documento consolida e atualiza as pendências dos relatórios anteriores. Todo gerenciamento novo continua em simulação. Não houve operações no jogo nem merge na main.

| Componente | Situação |
| --- | --- |
| Leitura de capacidade e demanda restante das rotas existentes | Implementada, com validação de identidade e testes de DOM sintético |
| Decisão por aeronave e reservas para rotas compartilhadas | Implementada e testada em simulação |
| Referências de rotas das três bases e calendário de preços | Integradas ao relatório; calendário OCR não verificado |
| Auditoria de passageiros embarcados | Implementada; distingue vazio, baixa ocupação e informação ausente |
| Reajuste de tarifas das rotas existentes | Proposta baseada no controle Auto; nenhum valor aplicado |
| Revisão diária e por retorno | Motor e deduplicação implementados; fornecedor completo de dados de comparação ainda pendente |
| Persistência pela API real do GitHub | Validada com eventos sintéticos em dois runners independentes |
| Leitura das sugestões nativas | Novo módulo limitado e testado; exige planejador já aberto para aeronave em solo na base |
| Integração da pesquisa à simulação | Implementada como consulta opcional e limitada; gera route-research.json/MD; coleta integral no Actions ainda pendente |
| Comparação econômica completa das candidatas | Bloqueada por dados incompletos |
| Decolagens, trocas e ajustes automáticos novos | Desativados; dependem de autorização posterior e integração validada |

## Persistência real confirmada

Execução https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36790260971 aprovada. O primeiro runner inicializou e gravou `synthetic-seed`; o segundo restaurou esse evento, acrescentou `synthetic-restore` e confirmou a leitura remota. O arquivo de teste contém dois eventos e permanece na branch `am4-runtime-state`, no scope `ci-36790260971-1`. Artefatos: `remote-state-seed` e `remote-state-restored`.

O workflow `validate-state.yml` usa apenas GITHUB_TOKEN temporário e dados sintéticos, com scope específico por execução/tentativa. Ele não usa secrets do jogo, não acessa o jogo e não altera variáveis operacionais. A branch de estado já existe. O histórico operacional da companhia ainda precisa de scope estável e inicialização própria: os arquivos ci-* não devem ser usados como histórico real. `ENABLE_RETURN_JOURNAL` não foi ativado.

A nova validação roda somente em pushes dos arquivos relevantes na branch de desenvolvimento. A automação do jogo continua com o gatilho workflow_dispatch e o cron externo existente.

## Consulta de candidatas

`optimization/suggestion-reader.ts` consulta até três sugestões por padrão, com limite configurável de 1 a 10. Requer aeronave ready na própria origem resolvida, observação de até cinco minutos e um planejador já aberto para essa aeronave. Verifica os callbacks dos botões Suggest/Next e suas identidades antes dos cliques. Fecha o orçamento apenas pelo botão Back com callback de fechamento confirmado. Não clica Create route, Autoprice, Depart ou Ferry flight.

O coletor encerra destinos repetidos e informa falhas de carregamento ou identidade. O conjunto permanece `candidatesComplete=false` e `comparisonReady=false`: sugestões nativas limitadas não constituem pesquisa exaustiva. O leitor isolado não abre o planejador. A integração `optimization/research-reader.ts`, chamada por `runDemandSimulation`, reabre a lista, localiza a aeronave pela paginação, relê seus detalhes, confirma posição/layout/alcance/pista e só então abre o planejador. A restauração volta a uma lista nova na primeira página; não se presume que o cursor anterior foi preservado. Falha na restauração interrompe a fila. Callbacks desconhecidos são rejeitados antes dos cliques.

A configuração inicial é `ENABLE_ROUTE_RESEARCH=false`, `ROUTE_RESEARCH_MAX_AIRCRAFT=3` e `ROUTE_RESEARCH_MAX_SUGGESTIONS=3`, com limites de 1 a 10. Mesmo habilitada, a consulta apenas lê e gera artefatos; não completa uma comparação econômica e não habilita decisões reais. Os limites podem deixar outras aeronaves pendentes; a consulta limitada não comprova que toda a frota recebeu revisão diária. Nenhuma variável operacional do repositório foi alterada.

A inspeção de 01/10 confirmou que `#mapRoutes` alterna abertura/fechamento do painel; quando o painel já está aberto, a integração usa o callback de consulta da aba `#popBtn1`. O callback do link de aeronave também passa a ser validado. A leitura de sugestões aguarda substituição do botão Next anterior para evitar aceitar destino antigo durante uma resposta Ajax em andamento.

Seletores confirmados na inspeção: `#introSuggest`, `#introSuggestOR`, `#introSuggestm`, `#newRouteInfo`, `.col-3.m-text > b`, `#departFlightTimeInfo`, `#departFuelInfo`, `#departCo2Info`, `#costIndexBar`, `#introAuto`. O leitor de orçamento já valida classe, aeroporto, registro, taxa e número de aeronaves na rota.

A referência `autoPrice(Y,J,F,modelId)` do orçamento é capturada como `autopriceReference.base`. Não se executa o callback; `effectiveFares=null`, pois a transformação de modelos especiais nessa função não foi confirmada. Um controle desconhecido mantém a referência indisponível.

O orçamento apresenta Daily pax demand, e não demanda restante. Não fornece custos completos de manutenção/outros custos nem uma ocupação calibrada nas tarifas propostas. Ausência de aeronaves listadas numa rota também não prova que toda a demanda está disponível no próximo trecho. Não é correto converter esses dados em lucro líquido ou em recomendação automática de troca.

## Pendências concretas

1. Validar a integração publicada na coleta integral em simulação no Actions. O percurso de leitura para o ATR em GRU foi confirmado manualmente no navegador; isso não substitui a execução integral do código.
2. Obter demanda restante por sentido e reservas das outras aeronaves para as candidatas.
3. Confirmar preços efetivos do orçamento e estimativas completas de custo/ocupação para comparação.
4. Confirmar eventos de retorno persistidos; o gatilho diário funciona independentemente desses eventos, quando existem dados completos e aeronave em solo na base.
5. Executar a coleta completa em simulação no Actions, revisando seus artefatos. Nenhum teste sintético comprova essa integração com a companhia.

A solução não está pronta para executar trocas ou decolagens inteligentes reais. As decisões com dados ausentes continuam bloqueadas e a revisão permanece pendente, permitindo tentar novamente na próxima execução.

## Inspeção adicional de 01/10

Acesso à companhia confirmado pelo formulário seguro. BC-605 estava em XAP com próximo trecho XAP–GRU; sua origem cadastrada permanece GRU. O ATR retornou de BSB para GRU durante a inspeção e foi consultado em solo na própria base. Confirmados capacidade 44/9/0, demanda restante 731/510/295 e demanda diária 886/543/295. O orçamento sugerido GRU–IGU foi aberto e fechado sem criar rota ou aplicar Autoprice. Ver detalhes em `INSPECTION_2026-10-01.md`.
