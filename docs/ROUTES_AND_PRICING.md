# Revisão ao retornar à base e tarifas PAX

## Entrega em simulação

Foram adicionados o cálculo de tarifas, a leitura do controle Auto já inspecionado e um motor independente para comparar rotas ao retornar à própria base. Todos os resultados são recomendações: `dryRun=true`, `mutationAuthorized=false`. Não existe clique em Auto, Save ou Reroute, nem alteração de rota/preço/decolagem.

**Integração de rotas ainda pendente:** a inspeção autenticada foi retomada em 2026-09-30 UTC. Foram confirmados dados operacionais e um orçamento de candidato, mas ainda não a base individual, o identificador persistente de chegada, a demanda restante do candidato nem todos os custos. Não foram inventados seletores para essas informações. O relatório automático marca a revisão da rota como indisponível até esses dados estarem confirmados e um provedor preencher `RouteReview`. Portanto este código ainda não troca rotas automaticamente nem afirma encontrar a melhor rota do jogo inteiro.

## Tarifas solicitadas

Sempre partir do **preço automático de referência**, nunca da tarifa atual já multiplicada:

| Classe | Regra | Exemplo |
| --- | --- | --- |
| Y | `floor(auto * 110 / 1000) * 10` | 1234 → 1350 |
| J | `floor(auto * 108 / 1000) * 10` | 3456 → 3730 |
| F | `floor(auto * 106 / 1000) * 10` | 17890 → 18960 |

O arredondamento é sempre para baixo ao múltiplo de 10. A aritmética usa percentuais inteiros, evitando erro de ponto flutuante. Classes sem assentos recebem `null` na proposta, nunca zero para salvar no jogo. Preços inválidos ou que resultariam em zero são bloqueados.

A leitura aproveita `#seat-layout`, o botão de label exato Auto, seu atributo `onclick` com a assinatura observada `ticketPriceSuggest(Y,J,F,this,modelId)` e os campos `#eTicket`, `#bTicket`, `#fTicket`. O JavaScript do atributo é somente analisado, nunca executado. Assinaturas diferentes bloqueiam a proposta. O fator especial VIP de 1,8 (com arredondamento para cima) identificado na inspeção anterior para os modelos 371/383/384 é aplicado à referência antes dos multiplicadores pedidos; precisa ser revalidado caso o jogo mude essa função.

A tarifa atual é lida apenas para detectar se já está correta. Se ela não estiver disponível, o relatório apresenta `recommendation_only`. Uma leitura de preço ausente não invalida a análise independente da demanda.

Se a revisão recomendar uma nova rota, a proposta de tarifa da rota antiga é descartada. A sequência futura deve ser: confirmar troca → obter novo preço Auto → aplicar multiplicadores → confirmar valores salvos → reler demanda. Essa execução permanece não implementada/não autorizada nesta entrega.

## Quando comparar rotas

`confirmedBaseReturn(previous, current)` exige:

- Mesma aeronave, mesma base individual e mesmo identificador de voo.
- Observação anterior em voo com destino à base e observação posterior em solo nessa base.
- Observações em ordem temporal; a posição atual deve ser recente.
- Não basta estar em solo, estar em algum hub ou observar a origem textual da rota.

O `RouteOptimizer` avalia uma vez por identificador de retorno na instância. `lastReviewedArrival` permite ao futuro provedor fornecer a última avaliação persistida entre execuções. Falha de dados não consome a avaliação: é possível repetir a leitura. Um novo voo retornando à base gera um novo evento. A persistência desse evento e a coleta dos estados de voo ainda devem ser conectadas ao runner; não há falsa promessa de deduplicação entre execuções sem essa etapa.

## O que significa melhor rota

Critério inicial explícito: **maior lucro líquido estimado por hora no próximo ciclo completo de ida e volta**, entre os candidatos fornecidos e válidos. Não é uma prova de ótimo global nem previsão garantida de rentabilidade.

Cada candidato precisa de:

- Aeroportos de ida/volta, distância, duração, pistas e compatibilidade com alcance da aeronave.
- Demanda restante por classe **já descontando compromissos de outras aeronaves**.
- Identificador de demanda compartilhada: ida e volta não podem consumir duas vezes o mesmo saldo.
- Preços Auto de cada trecho; a comparação aplica os multiplicadores PAX solicitados.
- Ocupação esperada por classe, estimada **nas tarifas propostas**. Não assume 100% de ocupação. Sem uma estimativa confiável não recomenda troca.
- Custos por trecho: combustível, CO₂, manutenção, aeroportos/outros; custo de mudança cobrado integralmente no primeiro ciclo da alternativa.
- Instante de observação recente e indicação de que o conjunto pesquisado está completo.

Cálculo: receita de passageiros previstos menos custos, dividido pela soma das horas de voo. A disponibilidade do retorno usa conservadoramente a demanda atual; não pressupõe renovação durante o voo. Rotas fora do alcance/pista são descartadas. A exigência de pista é um parâmetro explícito do modo de jogo, nunca presumida.

Ocupação mínima é exigida em cada trecho; ciclos com lucro não positivo são retidos. Empates mantêm a rota atual, evitando trocas sem ganho. Por padrão qualquer melhora positiva pode recomendar troca; há limite percentual configurável. Se a rota atual ou algum candidato tiver dados incompletos, não declara qual é melhor. O provedor deverá ampliar a busca para poder afirmar que comparou todas as alternativas relevantes; hoje não há busca automática de aeroportos.

## Configuração e relatórios

| Variável | Padrão | Efeito somente na simulação |
| --- | --- | --- |
| `ENABLE_TICKET_PRICING` | `true` | Calcula propostas para os preços Auto disponíveis |
| `ENABLE_ROUTE_OPTIMIZER` | `true` | Habilita revisão quando o provedor fornecer dados confirmados |
| `ROUTE_MIN_OCCUPANCY_PERCENT` | `80` | Ocupação estimada mínima em cada trecho |
| `ROUTE_MIN_IMPROVEMENT_PERCENT` | `0` | Melhora mínima sobre lucro/hora atual |
| `DEMAND_MAX_AGE_SECONDS` | `300` | Limita idade das posições e cotações |

Essas opções são usadas no modo `ENABLE_DEMAND_MANAGER=true`. O fluxo legado não ganha alteração automática de preços/rotas com estas variáveis.

`optimization-report.json` e `optimization-report.md` são gerados ao lado do relatório de demanda, incluídos no mesmo artefato `demand-report` e no resumo do Actions. Exibem propostas de preços, estados e justificativas, inclusive pendências do adaptador. Sem dados confirmados não há recomendação de troca.

Arquivos novos: `pricing/ticket-pricing.ts`, `optimization/route-optimizer.ts`, `optimization/report.ts`, `tests/unit/optimization.spec.ts` e este documento. Integração alterada em `demand/types.ts`, `demand/reader.ts`, `demand/run.ts`, `tests/airlineManager.spec.ts`, `tests/unit/reader.spec.ts` e `.github/workflows/playwright.yml`.

## Validação desta alteração

`npm run typecheck` e `git diff --check` aprovados. `npm test`: 99 testes aprovados, incluindo 12 testes de interface local em Chromium. Os testes cobrem os três exemplos de tarifas, referência Auto sem multiplicação acumulada, retorno confirmado à base, custo de troca, lucro por hora, demanda compartilhada, empate, duplicação de eventos, dados inválidos e falhas de interface. Nenhuma operação real no jogo foi executada.


## Continuação da inspeção — 2026-09-30 UTC

Consulta somente de leitura confirmou os percursos de detalhes e orçamento. A demanda diária do orçamento não comprova demanda restante; taxa de criação não substitui custos operacionais. Dados da conta foram omitidos desta documentação pública.

### Leitores adicionados

`optimization/observations.ts` lê alcance, pista mínima, horas e ciclos durante a coleta de detalhes do DemandReader. Os campos são incluídos nos relatórios JSON de demanda e otimização. Dados ausentes retornam `null` sem invalidar uma leitura independente de demanda. Base e ID de voo permanecem explicitamente `null`.

`optimization/quote-reader.ts` lê **um orçamento já aberto**. Não navega nem dispara ações. Valida a identidade contra o callback observado de `#introSuggestm`, matrícula e par de aeroportos do orçamento. Seletores confirmados:

| Campo | Fonte |
| --- | --- |
| Painel | `#newRouteInfo` / `#newRouteContainer` |
| Matrícula | texto direto do cabeçalho `.blue-bg` |
| Aeroportos | `.col-3.m-text > b` |
| Distância | `.col-2 > span.s-text` |
| Demanda diária | tabela com label exato Daily pax demand; ordem validada pelas imagens das três classes |
| Duração | `#departFlightTimeInfo` |
| Combustível | `#departFuelInfo` |
| Emissão por passageiro/km | `#departCo2Info` |
| Cost index | `#costIndexBar` |
| Taxa | valor adjacente ao label Route fee |
| Aeronaves na rota | valor adjacente ao label A/C on route |

A saída mantém `remainingDemand=null`, `netProfit=null`, `comparisonReady=false`, `mutationAuthorized=false`. O callback é analisado como texto, nunca executado. Esse leitor está ligado à consulta opcional ENABLE_ROUTE_RESEARCH, validada em simulação no Actions. Ainda faltam coleta abrangente de candidatos e custos/ocupação confiáveis para alimentar RouteReview. Assim a revisão automática permanece indisponível no relatório, não é apresentada como concluída.


A origem operacional é individual por aeronave; a lista de hubs não determina esse vínculo.

Validação da continuação: TypeScript sem erros; 115 testes locais aprovados, incluindo 28 testes de interface em Chromium com rede bloqueada. Há testes de identidade divergente, orçamento oculto, números inválidos, ordem das classes, ausência de dados e propagação das observações aos dois relatórios JSON. Nenhuma chamada ao jogo é feita pelos testes.


## Origem operacional individual — regra confirmada

A base de comparação é a origem operacional de **cada avião**. Pousar em qualquer outro hub não representa retorno à sua base. Uma rota de ida e volta pode inverter a ordem dos aeroportos na interface; essa inversão não altera o vínculo aeronave–origem. Renomear a matrícula ou trocar o destino também não deve redefinir a origem.

`AIRCRAFT_ORIGINS_JSON` recebe uma lista de IDs estáveis de aeronave e aeroportos IATA. Exemplo **fictício**, não corresponde a um cadastro da frota real:

```json
[{"aircraftId":"1","origin":"GRU"},{"aircraftId":"2","origin":"DTW"}]
```

O workflow encaminha a variável do repositório com padrão `[]`. Nenhuma variável do GitHub foi preenchida nesta entrega. Origem desconhecida, ID duplicado, formato inválido ou divergência entre o cadastro e as observações impedem a revisão. Não há padrão implícito GRU nem inferência pelo último pouso. O cadastro permanece independente dos snapshots e só muda mediante alteração explícita da configuração.

A integração exige que ambas as observações da transição de voo concordem com a origem cadastrada. A origem individual aparece no JSON e no Markdown do relatório de otimização. A avaliação ainda requer retorno confirmado, candidatos completos e custos/demanda confiáveis; esse cadastro não habilita trocas ou decolagens.

Validação: `npm run typecheck`, `git diff --check` e 125 testes aprovados. Os testes novos incluem duas aeronaves retornando a origens distintas, pouso em outro hub, ausência de cadastro, duplicação de IDs e serialização do cadastro no relatório.


## Registro persistente de revisões — módulo independente

`optimization/return-journal.ts` disponibiliza `reviewWithReturnJournal(input, options, now)` para o futuro provedor de retornos confirmados. A função executa exclusivamente a análise simulada do RouteOptimizer, sob lock local, e salva o resultado antes de devolvê-lo.

- A chave é composta por ID da aeronave, origem operacional e ID do voo confirmado. Não usa matrícula, relógio relativo ou contador de ciclos como substituto do ID.
- O arquivo guarda todas as chegadas revisadas, e não apenas a última. Uma observação antiga reapresentada após outro voo continua bloqueada.
- `would_reroute`, `keep_route` e `hold` registram revisão concluída; dados ausentes/inconsistentes não consomem o evento.
- JSON inválido, companhia/ambiente divergente, registro duplicado, data futura, falta de acesso ou lock existente bloqueiam a análise. O arquivo não é apagado ou reinicializado automaticamente nesses casos.
- A gravação usa arquivo temporário exclusivo, sincronização do conteúdo e substituição por rename no mesmo diretório. Duas execuções que compartilham esse diretório não conseguem revisar simultaneamente a mesma chegada. Não representa uma transação com o servidor do jogo.
- O registro só contém IDs operacionais, origem, instante e decisão; não recebe credenciais, cookies ou dados de sessão.

`options.directory` deve apontar para armazenamento persistente (por exemplo `.am4-state/<identificador-da-companhia>`); `options.scope` identifica companhia/ambiente sem usar e-mail ou outro segredo; `options.origin` deve vir do cadastro confirmado AIRCRAFT_ORIGINS_JSON. A pasta sugerida está ignorada pelo Git. O arquivo usa schemaVersion 1 e bloqueia novas gravações ao atingir 100 mil eventos, sem descartar eventos antigos silenciosamente.

**Situação na primeira entrega do registro:** o módulo foi inicialmente testado apenas em reaberturas locais. A continuação abaixo adiciona transporte e integração opcionais no workflow; falta validar esse transporte com estado real e fornecer posição anterior/atual com ID real de voo. O primeiro arquivo ausente inicia um registro vazio; um transporte que perca estado NÃO pode fingir que se trata da primeira execução. A concorrência do workflow continua sendo necessária entre runners. Não há garantia de deduplicação entre runners antes dessa integração.

Nada nesta entrega habilita decolagens, mudanças de preço ou troca de rota. Não foram configuradas origens reais nem deduzidas a partir dos aeroportos alternados na interface.

Validação do registro: `npm run typecheck` e `git diff --check` aprovados; 137 testes locais aprovados, incluindo 12 cenários de persistência/reabertura, repetição de voo antigo, concorrência, bloqueio por corrupção, identidade de ambiente e revisão indisponível com nova tentativa. A consulta ao jogo nesta retomada encontrou a tela pública, sem acesso autenticado à frota; não houve coleta adicional nem operações.


## Transporte de estado no GitHub Actions — preparado, desligado

`optimization/github-state.ts` implementa restauração e gravação pela API Contents do GitHub. O destino é fixo: branch **am4-runtime-state**, arquivo `return-journal-<scope>.json`. Nunca usa a branch padrão como destino implícito. O arquivo contém apenas o registro operacional; não inclui credenciais ou cookies. Se o repositório for público, esses IDs e eventos serão públicos nessa branch também.

Fluxo preparado no workflow operacional:

1. Compilar a ferramenta com `npm run build:state` (também validado pelo CI sem credenciais).
2. Se habilitado explicitamente, restaurar o registro antes de entregar as credenciais do jogo ao processo do bot. Estado remoto ausente, inacessível ou inválido faz a etapa falhar e impede o bot.
3. `runDemandSimulation` passa pela integração `analyzeOptimizationWithJournal`. Quando um provedor entrega `RouteReview` confirmado, a origem/identidade/layout/coleta são validados antes do registro da revisão. O fluxo atual ainda fornece contexto vazio porque esse provedor real está pendente; assim não inventa eventos nem recomenda trocas.
4. Após sucesso do bot, salvar apenas acréscimos ao registro. Sem novos eventos não há commit. O SHA do arquivo restaurado acompanha a atualização: conflito resulta em falha, sem tentativa de sobrescrever o estado mais recente. A concorrência global do workflow foi preservada.

Configurações, todas sem alterações nas variáveis reais do repositório:

| Variável | Padrão | Significado |
| --- | --- | --- |
| ENABLE_RETURN_JOURNAL | false | Ativa exclusivamente o registro das revisões simuladas |
| RETURN_JOURNAL_SCOPE | vazio | Identificador estável da companhia/ambiente, sem e-mail ou segredo |
| AIRCRAFT_ORIGINS_JSON | [] | Cadastro confirmado de origem individual |

`GITHUB_TOKEN` é disponibilizado somente às etapas de transporte; não é passado ao bot. O workflow já possuía `contents: write`; não houve ampliação das permissões. A ferramenta utiliza apenas api.github.com, rejeita redirecionamentos e não registra token/corpo de respostas de erro. O transporte usa arquivos abaixo de 900.000 bytes e bloqueia excesso em vez de truncar o histórico.

### Inicialização posterior

Não criamos a branch de estado e não inicializamos arquivos nesta entrega. Após revisão e autorização da ativação, será necessário criar a branch dedicada, selecionar um scope estável e inicializar **uma única vez** um arquivo vazio pela ferramenta:

```sh
npm run build:state
node .am4-tools/optimization/github-state.js initialize
```

Esse comando exige `GITHUB_REPOSITORY`, `GITHUB_TOKEN` e `RETURN_JOURNAL_SCOPE` no ambiente. Não o use para substituir um registro existente: a inicialização não informa SHA para atualização e deve falhar se o arquivo já existir. O workflow nunca chama initialize. Não cole tokens em comandos, logs ou documentação; use ambiente protegido. Se uma inicialização falhar, verifique o estado existente antes de repetir.

A restauração se recusa a sobrescrever uma pasta local existente, para não perder mudanças ainda não gravadas. No runner novo, `.am4-state/github` ainda não existe. A CLI `restore` e `save` está compilada em `.am4-tools/optimization/github-state.js`; ambas as pastas são ignoradas pelo Git.

### Limites e validação

O transporte está implementado e testado com API simulada e diretórios independentes representando runners distintos. Ainda **não foi executado contra a branch real de estado**, nem validado num ciclo automático autenticado. A escrita usa controle de versão do arquivo, mas não é uma transação com o jogo e não oferece garantia de execução única de operações reais. O código continua sem executor de troca de rota/decolagem inteligente.

A origem por aeronave, o ID estável do voo e os dados completos dos candidatos continuam sendo requisitos para ativar a comparação real. A perda externa do estado exige recuperação deliberada; um 404 nunca é tratado como primeira execução.

Referência da API utilizada: https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents (branch explícita e SHA para atualizar arquivo).

Validação desta integração: 150 testes locais aprovados (incluindo transporte remoto simulado, conflito de SHA e deduplicação no relatório após restauração em runner novo); `npm run typecheck`, `npm run build:state`, estrutura/condições do YAML e `git diff --check` aprovados. Nenhuma chamada de escrita à API de estado nem execução do workflow do jogo foi realizada.

## Coleta ampliada e cadastro de origens

A simulacao agora consulta detalhes de aeronaves PAX em voo, alem das disponiveis. O estado em voo exige contador `#timer`, ausencia de Depart visivel e identidades de aeronave e rota nos controles de detalhes ja inspecionados. Nenhum controle Rename e acionado. Uma falha preserva o estado em voo, registra alerta e nao publica uma posicao confirmada.

O artefato `demand-report` inclui:

- `fleet-observations.json`: estado, aeroporto atual quando em solo, destino, capacidade, alcance/ciclos, origem cadastrada e bloqueios por aeronave. `flightId=null` e `returnConfirmed=false` ate existir um provedor de eventos validado. Este arquivo e evidencia para diagnostico, nao estado duravel automaticamente restaurado.
- `aircraft-origins.template.json`: pares `aircraftId`/`origin` das aeronaves com identidade unica. Preencher os `null` com a origem operacional confirmada e copiar a lista para a variavel `AIRCRAFT_ORIGINS_JSON`. Nao copiar o modelo incompleto: a validacao rejeita origens nulas. IDs cadastrados mas nao observados aparecem em `configuredButNotObserved`, pois podem estar estacionados ou pendentes; nao sao removidos automaticamente.

Nao escolher a origem pelo aeroporto atual ou pelo primeiro aeroporto da rota. Aeronaves em voo nao tem aeroporto atual confirmado. A coleta nao inclui aeronaves estacionadas/pendentes sem rota: cadastrar suas origens quando aparecerem na colecao de rotas.

A comparacao agora exige que a posicao fornecida corresponda ao aeroporto atual da aeronave coletada, que a leitura esteja dentro de `DEMAND_MAX_AGE_SECONDS` e, quando disponiveis, que alcance e pista coincidam com a ficha. Um provedor externo nao pode recomendar troca usando posicao ou configuracao divergente.

A leitura ampliada aumenta o tempo de coleta. Caso as primeiras leituras expirem, a politica continua bloqueando liberacoes em vez de aumentar automaticamente a janela. A integracao ampliada foi testada com DOM sintetico baseado na inspecao; ainda requer uma execucao de simulacao no Actions para validar a frota completa.

Permanecem bloqueados: inferencia de origem, geracao de ID de voo a partir de ciclos/horarios relativos, confirmacao de retorno, busca automatica completa de candidatos, executor de decolagem e alteracoes reais. O journal existente deduplica revisoes fornecidas por um provedor; nao cria esse provedor. Manter `ENABLE_RETURN_JOURNAL=false` ate inicializacao e validacao explicitas.

## Regra de origem atualizada pelo operador em 30/09/2026

Esta regra substitui a exigencia anterior de cadastro manual de toda a frota. As bases informadas pelo operador sao Chapeco (XAP), Guarulhos (GRU) e Detroit Metropolitan (DTW). `AIRLINE_BASES_JSON` pode substituir essa lista, por exemplo `["XAP","GRU","DTW"]`.

A origem e resolvida por prioridade:

1. Cadastro explicito `AIRCRAFT_ORIGINS_JSON` por ID de aeronave.
2. Exatamente uma base entre os dois aeroportos da rota: atribuir essa base, independentemente do sentido ou do estado de voo.
3. Duas bases (GRU-XAP, por exemplo) ou nenhuma: bloquear a origem automatica e explicar o motivo. Coleta incompleta, dados inconsistentes e identidades duplicadas tambem bloqueiam inferencia.

Os relatorios mostram `originResolution.source`: `registered`, `unique-route-base` ou `unavailable`, junto com a justificativa. A atribuicao pela rota e uma regra operacional autorizada pelo dono, nao um campo nativo confirmado do jogo. Nao comprova retorno, nao cria ID de voo e nao habilita operacoes. O modelo de origens passa a preencher os casos univocos e deixa `null` somente nos casos nao resolvidos. As atribuicoes pela rota sao recalculadas a cada coleta; o cadastro explicito tem prioridade e nao e sobrescrito.

## Revisao diaria e cadastro explícito — 30/09/2026

Cadastros explícitos fornecidos pelo operador têm prioridade. AIRCRAFT_ORIGINS_JSON pode sobrescrever o cadastro padrão. Identificadores reais foram omitidos desta documentação pública; nome/registro não é chave de identidade.

A cada execucao, o relatorio agora verifica a necessidade de revisao diaria para todas as aeronaves coletadas. O dia segue `ROUTE_REVIEW_TIMEZONE` (padrao `America/Sao_Paulo`). Uma revisao completa por retorno a base tambem satisfaz a revisao daquele dia. Ausencia de historico persistente e marcada como `historyAvailable=false`; nao e apresentada como revisao realizada.

Sem um novo retorno confirmado, uma aeronave em solo na propria base pode ser comparada pelo gatilho `daily`. O evento e `daily_YYYYMMDD`, nao um voo inventado. O campo legado `flightId` do journal armazena esse ID de evento para revisoes diarias; para revisoes por retorno continua armazenando o ID de voo confirmado. A chave inclui aeronave e origem, e os registros anteriores permanecem preservados.

Somente comparacoes completas (`would_reroute`, `keep_route`, `hold`) gravadas com sucesso no journal contam como revisao diaria concluida. Falha, dados ausentes e candidatos incompletos mantem a pendencia para a proxima execucao. Um retorno ja consumido em outro dia nao impede nova revisao diaria. Um novo retorno no mesmo dia continua podendo gerar uma revisao adicional.

Aeronaves em voo ou fora da propria base ficam pendentes ate uma execucao que as observe em solo na base. Nao se garante uma comparacao completa a cada 24 horas se o bot nao executar, se a aeronave nao retornar, ou se faltarem dados. O gatilho diario nao cria agendamento: o cron-job.org continua disparando o workflow existente. Nao foram alterados cron, branch main ou permissoes.

O mecanismo de calendario, comparacao e deduplicacao esta implementado e testado localmente. A coleta automatica de candidatos completos e de eventos de retorno reais continua pendente. O transporte do journal deve ser inicializado/validado antes de habilitar `ENABLE_RETURN_JOURNAL`; enquanto estiver desabilitado, os relatorios sinalizam a pendencia e nao alegam persistencia entre execucoes. Todas as decisoes continuam em simulacao, sem alterar rotas, precos ou decolar.


## Atualização consolidada — 01/10/2026

A persistência real com eventos sintéticos foi validada em dois runners do GitHub Actions; a branch am4-runtime-state já existe. O scope operacional ainda não foi inicializado e ENABLE_RETURN_JOURNAL permanece desativado. As afirmações anteriores de que não existia branch ou teste de transporte real descrevem etapas anteriores. Consulte [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) para o estado atual, evidências e pendências da pesquisa de candidatas.

### Consulta opcional integrada à simulação — 01/10/2026

`ENABLE_ROUTE_RESEARCH=false` mantém a pesquisa nativa desligada inicialmente. Com `true`, a simulação consulta até `ROUTE_RESEARCH_MAX_AIRCRAFT=3` aeronaves elegíveis na própria origem, até `ROUTE_RESEARCH_MAX_SUGGESTIONS=3` orçamentos cada. Os dois limites aceitam 1–10. Gera `route-research.json` e `route-research.md` no artefato demand-report. Dados ausentes, aeronave fora da base e callbacks desconhecidos bloqueiam a consulta; falha de restauração interrompe a fila.

O percurso reabre a lista pela aba Fleet quando o popup já está aberto, confirma a identidade por ID/registro e relê posição/layout antes do planejador. Retorna à primeira página de uma lista nova. A consulta não fornece RouteReview completo e não altera o histórico de revisões bem-sucedidas. Sugestões limitadas não garantem melhor rota nem revisão de toda a frota no dia. A coleta e as fontes implementadas foram aprovadas no Actions 36862952783; os custos completos da comparação permanecem pendentes. A alteração não habilita trocas, tarifas ou decolagens.

## Evidências adicionais das candidatas

Com ENABLE_ROUTE_RESEARCH=true, o fluxo também produz candidate-data.json e candidate-data.md. O relatório relaciona a candidata a rotas existentes por origem/destino e guarda fonte, data, demanda restante e sentido observado. Usa o mínimo por classe entre observações do mesmo sentido; não soma demandas compartilhadas. Um dado apenas do sentido inverso fica em reverseRemaining, nunca em remaining do sentido solicitado. Ausência de observação, duplicidade, valores inválidos, expiração ou coleta incompleta bloqueiam esse enriquecimento. As reservas futuras das outras aeronaves continuam pendentes.

O catálogo fornece referência de A-check e intervalo por modelo; os painéis Fuel/Co2 fornecem preços de mercado e suas unidades. Os leitores verificam os callbacks de consulta e não clicam controles de compra, configuração ou manutenção. Até dez modelos diferentes são consultados por execução; excedentes aparecem como pendência. Os limites de aeronaves e sugestões continuam valendo, sem garantir pesquisa exaustiva nem revisão diária de toda a frota.

fuelAtObservedMarketPrice é somente a quantidade em lbs do orçamento vezes o preço observado por 1.000 lbs. Não representa custo histórico do estoque. A-check do catálogo não é convertido por divisão linear em manutenção efetiva por voo. Taxa de criação fica em setupFee, separada de despesas recorrentes. Não há conversão confirmada de kg de emissão para quotas de CO₂, nem custos completos de manutenção e demais despesas. Assim costsComplete=false, netProfit=null e comparisonReady=false continuam obrigatórios; o relatório não é usado como RouteReview.

Validação isolada no Actions: validate-collection.yml força DEMAND_DRY_RUN=true e DEMAND_FAIL_SAFE=true, registra collection-validation.json, verifica cada identidade da coleta e consulta opcionalmente três aeronaves/uma sugestão por aeronave. A coleta inclui as aeronaves vinculadas às rotas, excluindo pendentes de entrega e sem rota. Evidências e resultados atualizados: IMPLEMENTATION_STATUS.md.
