# Estado atual da implementação — 01/10/2026

Este documento consolida e atualiza as pendências dos relatórios anteriores. Todo gerenciamento novo continua em simulação. Não houve operações no jogo nem merge na main.

| Componente | Situação |
| --- | --- |
| Leitura de capacidade e demanda restante das rotas existentes | Validada em coleta real no Actions: 29/29 aeronaves vinculadas a rotas |
| Decisão por aeronave e reservas para rotas compartilhadas | Implementada e testada em simulação |
| Referências de rotas das três bases e calendário de preços | Integradas ao relatório; calendário OCR não verificado |
| Auditoria de passageiros embarcados | Implementada; distingue vazio, baixa ocupação e informação ausente |
| Reajuste de tarifas das rotas existentes | Proposta baseada no controle Auto; nenhum valor aplicado |
| Revisão diária e por retorno | Motor e deduplicação implementados; fornecedor completo de dados de comparação ainda pendente |
| Persistência pela API real do GitHub | Validada com eventos sintéticos em dois runners independentes |
| Leitura das sugestões nativas | Módulo limitado validado no Actions para três aeronaves em solo na própria base |
| Integração da pesquisa à simulação | Validada no Actions; três consultas sem falhas e lista restaurada; gera route-research.json/MD |
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

1. Validar no Actions as novas leituras de referências de custo, além da coleta já aprovada.
2. Obter demanda restante por sentido e reservas das outras aeronaves para as candidatas.
3. Confirmar preços efetivos do orçamento e estimativas completas de custo/ocupação para comparação.
4. Confirmar eventos de retorno persistidos; o gatilho diário funciona independentemente desses eventos, quando existem dados completos e aeronave em solo na base.
5. Revalidar os fornecedores completos de comparação econômica quando suas fontes estiverem confirmadas; a consulta aprovada ainda não produz uma recomendação de troca.

A solução não está pronta para executar trocas ou decolagens inteligentes reais. As decisões com dados ausentes continuam bloqueadas e a revisão permanece pendente, permitindo tentar novamente na próxima execução.

## Inspeção adicional de 01/10

Acesso à companhia confirmado pelo formulário seguro. BC-605 estava em XAP com próximo trecho XAP–GRU; sua origem cadastrada permanece GRU. O ATR retornou de BSB para GRU durante a inspeção e foi consultado em solo na própria base. Confirmados capacidade 44/9/0, demanda restante 731/510/295 e demanda diária 886/543/295. O orçamento sugerido GRU–IGU foi aberto e fechado sem criar rota ou aplicar Autoprice. Ver detalhes em `INSPECTION_2026-10-01.md`.

## Coleta real aprovada no Actions

Execução [36859515879](https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36859515879), commit `191f9d925922b90b46b7371e6bd9256c6fa2fd42`, aprovada em 01/10/2026. Artefato `live-read-only-collection`: `collection-validation.json` status passed, 29 rotas e 29 identidades/capacidades/demandas verificadas. Cinco aeronaves em solo: quatro would_depart e uma hold_insufficient; 24 em voo. Três pesquisas de candidatas observadas, nenhuma falha, uiRestored=true. O escopo são as 29 aeronaves com rota; a aeronave pendente de entrega não está nessa coleta.

A primeira execução real falhou porque os links das aeronaves em voo não contêm o span acRegList usado nos cartões em solo. A correção lê o ID no callback de consulta fleet_details.php, confirma o registro no painel e rejeita links duplicados ou IDs divergentes. O teste isolado de coleta exige todas as identidades verificadas: contar os cartões não basta.

O workflow `validate-collection.yml` usa login padrão do Playwright com os secrets existentes, sem acessar seus valores por ferramentas externas. Não importa utilitários operacionais, força simulação/fail-safe, não usa GITHUB_TOKEN no teste, não persiste eventos reais nem envia Telegram, não grava trace/vídeo/screenshots do login. Compartilha a trava de concorrência da conta. Os testes locais nessa revisão: 253 aprovados, typecheck e build:state aprovados; CI [36859519379](https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36859519379) aprovada.

## Fontes adicionais de candidatas

`candidate-evidence.ts` relaciona origem/destino aos detalhes das rotas existentes, mantém fontes, datas e mínimos conservadores por classe. Evidência do sentido inverso aparece separadamente como reverse_direction_only e não preenche a demanda do sentido solicitado. Sem rota existente, valores inválidos/expirados ou coleta incompleta, demanda continua indisponível. Nunca transforma Daily pax demand ou A/C on route 0 em demanda restante; não presume reservas futuras de outras aeronaves.

`cost-reference-reader.ts` consulta apenas detalhes do catálogo e preços visíveis nos painéis Fuel/Co2. Confirma callbacks, identidade do modelo, labels, valores e unidades. O catálogo ATR 72-500 mostrou A-Check $20.125 e Maint check 480 Hours. Fuel mostrou $1.280 por 1.000 lbs e Co2 $133 por 1.000 quotas, observações pontuais sujeitas a alteração. A referência de catálogo não confirma o custo efetivo de manutenção da aeronave (habilidades/modificações/desgaste); preço de mercado não confirma o custo do estoque adquirido. Não se executam Order, Configuration, Purchase, A-Check ou Repair.

A consulta opcional ENABLE_ROUTE_RESEARCH também gera `candidate-data.json`/MD, com combustível avaliado ao preço observado de mercado, referências de A-check, demanda por sentido e pendências explícitas. CO₂, manutenção efetiva e airportAndOther continuam null, custosComplete=false, netProfit=null e comparisonReady=false. Taxa de criação permanece separada de despesas recorrentes. Todos os dados continuam fora do fornecedor de RouteReview até completar reservas, ida/volta, custos e ocupação calibrada.
