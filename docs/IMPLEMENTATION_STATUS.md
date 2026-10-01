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
| Manutencao individual e oito despesas | Leitura de estado e orcamento auditavel implementados; custos efetivos ausentes bloqueiam totais |
| Custos e demanda completos de todas as candidatas | Pendentes; comparação econômica bloqueada |
| Revisão diária e por retorno | Motor testado; comparações incompletas permanecem pendentes |
| Persistência do histórico | Transporte validado em dois runners com dados sintéticos; histórico operacional não inicializado |
| Aplicação de decolagens, rotas ou tarifas | Desativada; depende de integração completa e autorização posterior |

## Validação

- 338 testes locais aprovados; typecheck, build:state e git diff --check aprovados. Validacao adicional das novas fontes no Actions ainda em andamento.
- CI de código aprovada: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36862961607
- Coleta e fontes implementadas aprovadas: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36862952783
- Commit de código validado: 0ee119a39c68375c1f01f0f7d5e7831707612fac.
- Persistência sintética em runners independentes: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36790260971

A aprovação da coleta verifica o percurso de leitura, cada identidade, as fontes implementadas e a restauração da interface. Não comprova comparação econômica completa nem autorização para produção. O escopo da coleta são as aeronaves vinculadas às rotas; aeronaves pendentes de entrega ou sem rota estão fora desse escopo.

O workflow isolado validate-collection.yml importa apenas módulos de leitura, força simulação/fail-safe, compartilha concurrency com o bot operacional, não envia Telegram nem persiste eventos reais. Usa secrets existentes por variáveis de ambiente sem expor seus valores. Trace, vídeo e screenshots do login ficam desligados. Nenhum conteúdo de sessão é incluído nos relatórios.

## Correções confirmadas

Cartões em voo podem não conter o span acRegList usado nos cartões em solo. O leitor obtém o ID no callback de consulta fleet_details.php, confirma o registro no painel e rejeita IDs conflitantes ou links duplicados. Contar cartões não substitui verificar seus detalhes.

O popup aberto pode interceptar cliques nos menus principais. O leitor usa o fechamento nativo verificado no cabeçalho antes de abrir o mercado, sem forçar cliques através do overlay. Os testes incluem overlay, controles desconhecidos e restauração. Diagnósticos de falha registram apenas etapa e labels de unidade; não coletam HTML, formulários ou dados de sessão.

## Fontes e limites das candidatas

candidate-evidence.ts relaciona origem/destino aos detalhes das rotas existentes e guarda fonte/data/sentido. O mínimo por classe entre observações do mesmo sentido evita somar demanda compartilhada. Dados apenas do sentido inverso permanecem em reverseRemaining, sem preencher remaining do sentido solicitado. Sem rota existente, com dados inválidos/expirados ou coleta incompleta, a demanda permanece indisponível. Não há conversão de demanda diária em restante nem presunção de demanda plena quando A/C on route é zero.

cost-reference-reader.ts consulta detalhes do catálogo e preços nos painéis Fuel/Co2. Verifica callbacks, modelo, labels, valores e unidades. Não aciona Order, Configuration, Purchase, A-Check ou Repair. Referência de A-check do catálogo não confirma custo efetivo de manutenção por voo. Preço de mercado não confirma custo de aquisição do estoque.

candidate-data.json/MD apresenta evidências, reservas limitadas, estado de manutenção e cenarios de combustível, CO2 e rateio de A-check. As formulas da planilha sao referencias explicitamente separadas dos custos efetivos. Taxa de criação fica separada das despesas recorrentes. Não se supõem custos efetivos zero. CO₂, manutenção efetiva e airportAndOther ficam null quando ausentes. costsComplete=false, netProfit=null e comparisonReady=false permanecem obrigatórios. Nenhum orçamento parcial alimenta RouteReview. Regras, fontes e configuracoes: [RESERVATIONS_AND_COSTS.md](RESERVATIONS_AND_COSTS.md).

ENABLE_ROUTE_RESEARCH=false é o padrão. Quando habilitado, maxAircraft/maxSuggestions aceitam 1–10; a consulta limitada não garante a melhor rota ou revisão diária de toda a frota. O cron-job.org continua disparando workflow_dispatch; nenhum schedule ou configuração financeira foi alterado.

## Pendências para produção

1. Fonte confirmada de demanda restante das candidatas sem rota existente.
2. Regra de compartilhamento por sentido e reservas futuras das outras aeronaves.
3. Custos completos da ida/volta, conversão de emissão para quotas, manutenção efetiva e demais despesas.
4. Tarifas efetivas e ocupação calibrada nas tarifas propostas.
5. Validação dos eventos de retorno persistidos e cobertura suficiente da revisão diária.

As decisões incompletas permanecem bloqueadas para permitir nova tentativa na próxima execução. A solução continua sem autorização para operar decolagens, trocas ou preços reais.
