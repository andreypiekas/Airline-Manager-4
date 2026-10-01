# Estado técnico da implementação — 01/10/2026

Todo gerenciamento novo permanece em simulação. Não houve operações no jogo, mudança de variáveis operacionais ou merge na main. Este documento público contém somente mecanismos, validações e limitações técnicas; omite identificadores e dados operacionais da conta.

| Componente | Situação |
| --- | --- |
| Leitura de detalhes das aeronaves vinculadas às rotas | Validada no Actions, incluindo cartões em solo e em voo |
| Demanda restante e capacidade Y/J/F das rotas existentes | Coletadas com validação de identidade, classes e consistência |
| Decisão de decolagem por aeronave | Testada em simulação; dados inválidos bloqueiam a decisão |
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
| Revisão diária e por retorno | Motor testado; comparações incompletas permanecem pendentes |
| Persistência do histórico | Transporte validado em dois runners com dados sintéticos; histórico operacional não inicializado |
| Aplicação de decolagens, rotas ou tarifas | Desativada; integracao e resultados operacionais ainda nao validados |

## Validação

- 376 testes locais aprovados; typecheck, build:state e git diff --check aprovados. Os testes adicionais verificam contadores, limites de disponibilidade, linhas do historico financeiro, sinais, quantidades, controles nao reconhecidos, campos ocultos e ausencia de cliques operacionais.
- CI de código aprovada: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36913978609
- Coleta e fontes implementadas aprovadas: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36913973532
- Commit de código validado: 056005a67fe18f48851057eb3f8eba24ab315d6f.
- Historico financeiro estruturado e consultas candidatas validados: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36912548464
- Persistência sintética em runners independentes: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36790260971

As validacoes confirmaram detalhes de todas as aeronaves vinculadas as rotas, estado individual de manutencao, mercados, historico financeiro e restauracao da interface. A execucao com candidatas elegiveis tambem confirmou consultas e referencias de modelos; a ultima coleta nao encontrou candidatas elegiveis para pesquisa e nao revalida esse percurso por si so. Nos orcamentos anteriormente coletados, os JSON confirmam demanda restante das novas candidatas indisponivel, custos efetivos incompletos, totalOperatingCost=null e comparisonReady=false. Nenhuma lacuna foi convertida em saldo, custo zero ou permissao operacional.

A aprovação da coleta verifica o percurso de leitura, cada identidade, as fontes implementadas e a restauração da interface. Nao comprova comparacao economica completa nem prontidao operacional para producao. O escopo da coleta são as aeronaves vinculadas às rotas; aeronaves pendentes de entrega ou sem rota estão fora desse escopo.

O workflow isolado validate-collection.yml importa apenas módulos de leitura, força simulação/fail-safe, compartilha concurrency com o bot operacional, não envia Telegram nem persiste eventos reais. Usa secrets existentes por variáveis de ambiente sem expor seus valores. Trace, vídeo e screenshots do login ficam desligados. Nenhum conteúdo de sessão é incluído nos relatórios.

## Correções confirmadas

O leitor de manutencao compara ID e registro visivel exatos; data-reg e conferido como chave de ordenacao em minusculas. O leitor do catalogo distingue modelo ausente da lista inspecionada de falha de coleta, mantendo custos desconhecidos bloqueados.

O contador #timer fornece segundos restantes e uma chegada estimada, vinculados a ID e rota verificados. O estimador rejeita zero, formato invalido e datas invalidas. Nao confirma pouso, retorno a base ou horario de decolagem; reservas posteriores continuam sem horario. Os botoes individuais A-Check, Repair e Modify nao apresentam preco em seus labels inspecionados; nenhum deles foi acionado.

O fluxo principal de simulacao usa o mesmo login normal validado na coleta isolada, com erros sanitizados e sem gravacoes de credenciais.

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

## Pendências para produção

1. Fonte confirmada de demanda restante das candidatas sem rota existente.
2. Regra de compartilhamento por sentido e reservas futuras das outras aeronaves.
3. Custos completos da ida/volta, conversão de emissão para quotas, manutenção efetiva e demais despesas.
4. Tarifas efetivas e ocupação calibrada nas tarifas propostas.
5. Validação dos eventos de retorno persistidos e cobertura suficiente da revisão diária.

As decisões incompletas permanecem bloqueadas para permitir nova tentativa na próxima execução. A liberacao operacional permanece tecnicamente bloqueada pelos dados e integracoes ausentes; autorizar producao nao supre essas evidencias. Nenhuma operacao real foi executada para testar esta entrega.
