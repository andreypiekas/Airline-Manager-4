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

Consulta somente de leitura na companhia xPiekas. A tela listava 27 aeronaves, 26 rotas e 14 disponíveis para decolagem. Esses números são uma observação da tela, não uma nova análise completa de demanda da frota.

- B737-100-1: a lista mostrava JAU–GRU; os detalhes mostravam GRU à esquerda, JAU à direita; o painel de pesquisa indicava São Paulo Guarulhos como localização. O último histórico era JAU–GRU. Isso sustenta que, neste caso em solo, o primeiro aeroporto dos detalhes é a localização atual/próxima origem. Não prova a semântica em voo nem qual é a base atribuída à aeronave.
- Alcance 3.440 km, pista mínima 7.550 ft e horas/ciclos 682/206 foram lidos pelos labels `Range`, `Min runway`, `Flight hours/Cycles` e seus `span.m-text` adjacentes. O contador de ciclos não foi promovido a ID de voo.
- A demanda Y de JAU/GRU apareceu renovada em 802/802, comparada à observação anterior de 34/802. Isso confirma mudança de saldo entre as observações; não determina o horário exato da renovação.
- Reroute abriu pesquisa; Suggest route mostrou GRU–COR; Next abriu orçamento. Nenhum Create route, Save, Auto, Autoprice, Depart, Ground ou Ferry flight foi executado. O orçamento foi fechado sem salvar.

Orçamento observado para GRU–COR: 1.955 km; 01:38:14; 23.695 lb de combustível; 0,15 kg/pax/km de CO₂; cost index 200; taxa $45.716; A/C on route 0; Daily pax demand Y431/J169/F162. A tabela **diária não comprova saldo restante**. A taxa de rota não substitui os custos de operação. Não foi inferido lucro a partir de custos ausentes, nem estendida a cotação de ida ao retorno.

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

A saída mantém `remainingDemand=null`, `netProfit=null`, `comparisonReady=false`, `mutationAuthorized=false`. O callback é analisado como texto, nunca executado. Esse leitor não foi ligado à navegação automática do workflow: ainda não há coleta abrangente de candidatos, base confirmada, persistência dos retornos e custos/ocupação confiáveis para alimentar RouteReview. Assim a revisão automática permanece indisponível no relatório, não é apresentada como concluída.


A tela Hubs confirmou São Paulo Guarulhos como **(Base)**, além de Chapecó e Detroit Metrop. como hubs. Isso identifica a base da companhia, mas não atribui automaticamente todas as aeronaves a GRU. Regra esclarecida pelo usuário: revisar no retorno à origem operacional individual de cada aeronave, incluindo aeronaves baseadas em outros hubs; não limitar a GRU. Falta confirmar e cadastrar o vínculo real de cada ID de aeronave à sua origem.

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
