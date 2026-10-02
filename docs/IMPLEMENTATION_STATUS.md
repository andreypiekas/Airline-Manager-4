# Estado técnico da implementação — 01/10/2026

O executor individual de retornos pela rota existente foi validado em simulacao e em um piloto real autorizado, com confirmacao posterior de identidade, estado em voo, contador e passageiros embarcados. Sem ativacao, os workflows usam simulacao; operacao real exige input explicito ou EXECUTE_INDIVIDUAL=true no repositorio. Rotas, tarifas e revisao economica incompleta permanecem bloqueadas. O workflow principal integra compras limitadas de combustivel/CO2 conforme [SUPPLIES.md](SUPPLIES.md), sob o mesmo modo de simulacao/producao. Este documento omite identificadores e dados operacionais da conta.

| Componente | Situação |
| --- | --- |
| Leitura de detalhes das aeronaves vinculadas às rotas | Validada no Actions, incluindo cartões em solo e em voo |
| Demanda restante e capacidade Y/J/F das rotas existentes | Coletadas com validação de identidade, classes e consistência |
| Decisão de decolagem por aeronave | Motor puro testado; executor real separado com releitura e bloqueio de dados invalidos |
| Pesquisa nativa limitada de candidatas | Validada no Actions, com restauração da interface |
| Demanda das candidatas coincidentes com rotas existentes | Adaptador por sentido implementado; evidência inversa permanece separada |
| Referências de A-check e intervalo por modelo | Leitura do catálogo validada no Actions; custo efetivo por voo ainda ausente |
| Preços atuais Fuel/Co2 e unidades | Leitura dos mercados validada no Actions; não representam custo histórico do estoque |
| Reservas das outras aeronaves | Cenarios limitados por classe e proximos trechos implementados; horarios futuros e renovacao continuam nao confirmados |
| Chegada estimada de aeronaves em voo | Contador nativo inspecionado; primeiro trecho futuro recebe limite de disponibilidade, sem inventar decolagem ou confirmar retorno |
| Manutencao individual e oito despesas | Leitura de estado validada no Actions; orcamento auditavel implementado; custos efetivos ausentes bloqueiam totais |
| Historico financeiro e pagamentos Fuel/Co2 | Leitura estruturada validada no Actions; lancamentos agregados nao comprovam custo por trecho ou custo medio do estoque |
| MCDU | Recurso opcional; coleta normal nao depende de sua disponibilidade e nao abre fluxo de compra |
| Custos e demanda completos de todas as candidatas | Pendentes; comparação econômica bloqueada |
| Triagem conservadora de candidatas | Implementada: usa demanda diaria apenas como teto, elimina candidatas que nao conseguiriam atingir o limite minimo nem no melhor caso e calcula teto de receita sem autorizar mutacoes |
| Revisão diária e por retorno | Motor testado; comparações incompletas permanecem pendentes |
| Persistência do histórico | Transporte validado em dois runners com dados sintéticos; histórico operacional não inicializado |
| Decolagens individuais de retorno | Piloto real autorizado aprovado; limite e confirmacao posterior validados |
| Aplicacao de rotas ou tarifas | Desativada; dados economicos incompletos mantem a revisao bloqueada |

## Validacao atual do executor

- Executor em simulacao no Actions: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36919208772
- Piloto real autorizado aprovado, com uma decolagem confirmada e nenhum resultado incerto: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36920005857
- CI de codigo do piloto aprovada: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36920013310
- Codigo do piloto: ff4b7dcd3da4e684f1646c3e058f3181f68e2d39.
- O gatilho transitorio do piloto por push foi removido antes da publicacao. Workflows operacionais aceitam somente workflow_dispatch e recusam reruns reais.
- Configuracao, limite, travas, relatorios e escopo: [PRODUCTION_DEPARTURES.md](PRODUCTION_DEPARTURES.md).

## Validacoes anteriores das fontes

- 443 testes locais aprovados; typecheck, build:state e git diff --check aprovados. Os testes adicionais verificam contadores, limites de disponibilidade, linhas do historico financeiro, sinais, quantidades, controles nao reconhecidos, campos ocultos e ausencia de cliques operacionais.
- CI de código aprovada: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36913978609
- Coleta e fontes implementadas aprovadas: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36913973532
- Commit de código validado: 056005a67fe18f48851057eb3f8eba24ab315d6f.
- Historico financeiro estruturado e consultas candidatas validados: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36912548464
- Persistência sintética em runners independentes: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36790260971

As validacoes confirmaram detalhes de todas as aeronaves vinculadas as rotas, estado individual de manutencao, mercados, historico financeiro e restauracao da interface. A execucao com candidatas elegiveis tambem confirmou consultas e referencias de modelos; a ultima coleta nao encontrou candidatas elegiveis para pesquisa e nao revalida esse percurso por si so. Nos orcamentos anteriormente coletados, os JSON confirmam demanda restante das novas candidatas indisponivel, custos efetivos incompletos, totalOperatingCost=null e comparisonReady=false. Nenhuma lacuna foi convertida em saldo, custo zero ou permissao operacional.

A aprovação da coleta verifica o percurso de leitura, cada identidade, as fontes implementadas e a restauração da interface. Nao comprova comparacao economica completa; a prontidao do executor de retornos e validada separadamente pelo piloto. O escopo da coleta são as aeronaves vinculadas às rotas; aeronaves pendentes de entrega ou sem rota estão fora desse escopo.

O workflow isolado validate-collection.yml importa apenas módulos de leitura, força simulação/fail-safe, compartilha concurrency com o bot operacional, não envia Telegram nem persiste eventos reais. Usa secrets existentes por variáveis de ambiente sem expor seus valores. Trace, vídeo e screenshots do login ficam desligados. Nenhum conteúdo de sessão é incluído nos relatórios.

## Correções confirmadas

O leitor de manutencao compara ID e registro visivel exatos; data-reg e conferido como chave de ordenacao em minusculas. O leitor do catalogo distingue modelo ausente da lista inspecionada de falha de coleta, mantendo custos desconhecidos bloqueados.

O contador #timer fornece segundos restantes e uma chegada estimada, vinculados a ID e rota verificados. O estimador rejeita zero, formato invalido e datas invalidas. Nao confirma pouso, retorno a base ou horario de decolagem; reservas posteriores continuam sem horario. Os botoes individuais A-Check, Repair e Modify nao apresentam preco em seus labels inspecionados; nenhum deles foi acionado.

O fluxo principal de demanda usa o mesmo login normal validado na coleta isolada, com erros sanitizados e sem gravacoes de credenciais.

Maintenance e Finance usam o mesmo ID mapMaint no menu. A consulta de Finance deve desambiguar pelo tooltip Finance, Marketing & Stock e verificar a chamada nativa de consulta finances.php com dois argumentos. O MCDU e opcional; o bot nao exige sua compra nem usa apenas a presenca do botao como prova de disponibilidade.

A inspecao passiva final nao encontrou avisos correspondentes de reset/renovacao no painel #list-demand nem precos em tooltips ou nomes de atributos de custo nos controles individuais de manutencao. Isso descreve somente os paineis inspecionados, nao prova ausencia de fontes em outras telas. Os campos de custos efetivos e previsao completa permanecem bloqueados.

Cartões em voo podem não conter o span acRegList usado nos cartões em solo. O leitor obtém o ID no callback de consulta fleet_details.php, confirma o registro no painel e rejeita IDs conflitantes ou links duplicados. Contar cartões não substitui verificar seus detalhes.

O popup aberto pode interceptar cliques nos menus principais. O leitor usa o fechamento nativo verificado no cabeçalho antes de abrir o mercado, sem forçar cliques através do overlay. Os testes incluem overlay, controles desconhecidos e restauração. Diagnósticos de falha registram apenas etapa e labels de unidade; não coletam HTML, formulários ou dados de sessão.

## Fontes e limites das candidatas

candidate-evidence.ts relaciona origem/destino aos detalhes das rotas existentes e guarda fonte/data/sentido. O mínimo por classe entre observações do mesmo sentido evita somar demanda compartilhada. Dados apenas do sentido inverso permanecem em reverseRemaining, sem preencher remaining do sentido solicitado. Sem rota existente, com dados inválidos/expirados ou coleta incompleta, a demanda permanece indisponível. Não há conversão de demanda diária em restante nem presunção de demanda plena quando A/C on route é zero.

cost-reference-reader.ts consulta detalhes do catálogo e preços nos painéis Fuel/Co2. Verifica callbacks, modelo, labels, valores e unidades. Não aciona Order, Configuration, Purchase, A-Check ou Repair. Referência de A-check do catálogo não confirma custo efetivo de manutenção por voo. Preço de mercado não confirma custo de aquisição do estoque.

finance-reader.ts consulta #financeAction #transactionContainer, validando linhas do historico sem tocar nos controles financeiros. Pagamentos de Fuel/Co2 fornecem referencias de transacoes visiveis. Bulk A-Check, salarios, campanhas e lounges sao despesas da companhia, sem alocacao confirmada por aeronave/trecho. Datas relativas nao sao timestamps exatos; historico incompleto nao define custo medio do estoque.

candidate-data.json/MD apresenta evidências, historico financeiro estruturado, reservas limitadas, estado de manutenção e cenarios de combustível, CO2 e rateio de A-check. As formulas da planilha sao referencias explicitamente separadas dos custos efetivos. Taxa de criação fica separada das despesas recorrentes. Não se supõem custos efetivos zero. CO₂, manutenção efetiva e airportAndOther ficam null quando ausentes. costsComplete=false, netProfit=null e comparisonReady=false permanecem obrigatórios. Nenhum orçamento parcial alimenta RouteReview. Regras, fontes e configuracoes: [RESERVATIONS_AND_COSTS.md](RESERVATIONS_AND_COSTS.md).

ENABLE_ROUTE_RESEARCH=false é o padrão. Quando habilitado, maxAircraft/maxSuggestions aceitam 1–10; a consulta limitada não garante a melhor rota ou revisão diária de toda a frota. O cron-job.org continua disparando workflow_dispatch; nenhum schedule ou configuração financeira foi alterado.

## Evidencia de ciclo ida e volta — 02/10/2026

A coleta de candidatas agora monta um envelope explicito de ciclo para cada rota pesquisada. O trecho de ida usa somente o orcamento live observado. O trecho de volta e criado apenas como estrutura `destino -> base`; tarifa, duracao, combustivel, CO2 e custos da volta permanecem nulos/bloqueados ate existir uma fonte live ou equivalente validada.

O catalogo `data/reference/routes.json` pode corroborar a existencia da rota e a distancia, mesmo quando a linha estiver armazenada no sentido inverso. Essa referencia e identificada com fonte, linha e direcao original, mas sua demanda de referencia nao e tratada como demanda restante da volta. Quando a frota ja fornece uma observacao independente no sentido inverso, `reverseAfterReservations` e anexado ao ciclo; sem essa evidencia, a volta continua com `RETURN_REMAINING_DEMAND_UNAVAILABLE`.

A triagem de teto de ocupacao agora tambem evita consultas de referencia por modelo para candidatas que matematicamente nao conseguem atingir `ROUTE_MIN_OCCUPANCY_PERCENT` nem usando toda a demanda diaria exibida. Isso reduz navegacao desnecessaria sem transformar a triagem em uma decisao de troca.

O novo envelope continua com `comparisonReady=false` e `mutationAuthorized=false`. Os bloqueios de volta ficam expostos no `candidate-data.json`/Markdown para que cada lacuna seja fechada explicitamente antes de KEEP/HOLD/REROUTE.

## Triagem economica conservadora — 02/10/2026

A pesquisa de candidatas agora produz uma triagem adicional antes da comparacao economica completa. A demanda diaria exibida no orcamento e usada somente como **teto**: nunca e convertida em demanda restante. Com a capacidade real da aeronave, o sistema calcula o maximo de passageiros que a candidata poderia atender em uma decolagem e o teto percentual de cobertura. Se nem esse teto atingir `ROUTE_MIN_OCCUPANCY_PERCENT`, a candidata pode ser descartada da pesquisa economica sem depender de suposicoes sobre reset ou reservas.

Quando a referencia Auto da candidata e reconhecida como PAX normal, o relatorio tambem calcula as tarifas de referencia ajustadas Y1,10/J1,08/F1,06, o teto de receita bruta por decolagem e o teto apos a taxa inicial de criacao da rota. Esses valores continuam sendo limites de triagem, nao lucro previsto. Referencias VIP permanecem indisponiveis ate validacao especifica.

Nenhuma candidata recebe `comparisonReady=true` ou `mutationAuthorized=true` por causa desta triagem. Demanda restante, ciclo de volta, reservas futuras e custos completos continuam obrigatorios para KEEP/HOLD/REROUTE.

## Pendencias para producao do otimizador de rotas

1. Fonte confirmada de demanda restante das candidatas sem rota existente.
2. Regra de compartilhamento por sentido e reservas futuras das outras aeronaves.
3. Custos completos da ida/volta, conversão de emissão para quotas, manutenção efetiva e demais despesas.
4. Tarifas efetivas e ocupação calibrada nas tarifas propostas.
5. Validação dos eventos de retorno persistidos e cobertura suficiente da revisão diária.

As decisões incompletas permanecem bloqueadas para permitir nova tentativa na próxima execução. Essas lacunas bloqueiam trocas de rota e a liberacao de aeronaves na propria base. O executor validado pode realizar retornos de rotas existentes, sem afirmar que o otimizador completo esta pronto.

## Ativacao por variaveis do repositorio

A execucao 36922342131 confirmou sete decisoes suficientes em simulacao e nenhuma chamada ao executor: o workflow lia apenas inputs. Os dois workflows agora resolvem EXECUTE_INDIVIDUAL e MAX_INDIVIDUAL_DEPARTURES em um script compartilhado, com precedencia documentada, override de simulacao e log sanitizado do modo efetivo. Dezenove testes de configuracao elevam a suite para 443; typecheck, build:state e diff check aprovados. A correcao nao repete decolagens reais durante seus testes.
