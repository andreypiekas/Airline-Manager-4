# Reservas e custos das candidatas — simulacao

Nenhum dado desta camada autoriza uma operacao. O relatorio `candidate-data.json` usa schemaVersion 2, preserva os campos anteriores e acrescenta `reservations`, `costScenarios`, `effectiveCosts` e referencias individuais de manutencao.

## Demanda sem rota existente

O orcamento nativo inspecionado informa `Daily pax demand`, nao o saldo ainda disponivel. A quantidade `A/C on route` nao e prova de saldo pleno. Sem uma observacao valida do mesmo sentido em uma rota existente, `remaining` e `forwardAfterReservations` continuam null. Uma leitura inversa nao preenche o saldo de ida.

Nao foram implementados seletores ou chamadas presumidas para obter saldo de uma rota nova. O suporte oficial descreve demanda diaria e seu esgotamento, mas nao fornece nesta pagina uma API de saldo para candidatas: https://airlinemanager.zendesk.com/hc/en-us/articles/21732303589138-How-does-demand-work

O MCDU e um recurso opcional do jogo, conforme informado pelo operador. A presenca do botao no menu nao comprova que a companhia possui esse recurso. A coleta normal nao depende dele, nao abre seu fluxo de compra e registra `optional_not_inspected` enquanto a disponibilidade nao estiver confirmada. Nenhuma compra e proposta ou automatizada. Fleet, Routes e as consultas financeiras existentes continuam sendo as fontes principais.

## Reservas de planejamento

`optimization/reservations.ts` cria um cenario independente por candidata:

- Exclui a propria aeronave, cuja rota atual seria substituida.
- Em solo, reserva capacidade para o proximo trecho conhecido. Em voo, comeca pelo trecho seguinte ao pouso; passageiros ja embarcados nao sao debitados novamente.
- Alterna origem/destino por um numero limitado de trechos, com todas as outras aeronaves antes da candidata no cenario. Usa a capacidade integral por classe, inclusive aeronaves que talvez fossem mantidas em solo. E uma simulacao conservadora de competicao, nao uma previsao de decolagens.
- Rejeita coleta incompleta, identidades duplicadas, capacidade invalida, estado desconhecido e leituras expiradas. Nao modifica snapshots nem acumula reservas de alternativas entre si.
- Limita cada debito ao saldo disponivel; nenhuma classe fica negativa. Leituras compartilhadas usam minimo por classe, nunca soma.

Configuracao:

```ini
ROUTE_RESERVATION_NEXT_LEGS=2
ROUTE_RESERVATION_POOL_SCOPE=airport-pair
DEMAND_MAX_AGE_SECONDS=300
```

`NEXT_LEGS` aceita 1–20. As duas variaveis ROUTE_RESERVATION sao encaminhadas das GitHub Variables pelos workflows operacional e de coleta; nenhum valor foi alterado na conta. `airport-pair` junta conservadoramente os sentidos no cenario; isso nao confirma que o jogo os compartilha. `directional` separa os sentidos. A politica de duas etapas nao garante cobertura de um dia inteiro. Nao sao conhecidos todos os horarios futuros, as trocas futuras de rota ou a renovacao exata da demanda. Por isso `futureScheduleComplete=false`, `demandNetOfOtherAircraft=false` e `comparisonReady=false` permanecem obrigatorios.

## Horarios observados

O contador #timer foi inspecionado nos detalhes de aeronaves em voo. flight-timing.ts registra horario da leitura, segundos restantes e chegada estimada; zeros, valores invalidos e identidades invalidas nao produzem evidencia. O leitor nao confirma pouso nem cria um evento de retorno com essa estimativa. A reserva do primeiro trecho apos pouso pode registrar notBeforeEstimatedAt quando ID, rota e contador recentes concordam. Isso nao e horario de decolagem: manutencao, espera pela proxima execucao, demanda e renovacao continuam relevantes. Trechos posteriores permanecem sem horario e futureScheduleComplete=false.

## Manutencao observada

`optimization/maintenance-reader.ts` consulta o menu Maintenance e a aba Plan. Aguarda o callback da aba anterior ser substituido pelo callback confirmado de Plan, sem clicar no controle antigo. Le os cartoes `.maint-list-sort`, `data-reg`, `data-base`, `data-wear`, `data-hours` e `controls<ID>`, conferindo registro, identidade e labels visiveis. O registro visivel preserva maiusculas/minusculas; data-reg e somente uma chave de ordenacao em minusculas. A identidade exige ID e registro visivel exatos, alem de conferir a chave de ordenacao. Rejeita filtro diferente de Showing all, cartoes ocultos, duplicados e valores divergentes. Fecha o popup e o chamador restaura Fleet. Diagnosticos registram somente a etapa de falha; nunca HTML, formularios ou dados de sessao.

Os campos Flight hours, Hours to check e Wear sao referencias de estado. At base nao define a origem propria da aeronave. A-Check, Repair, Modify e controles Bulk nunca sao clicados. Os textos visiveis dos botoes de servico sao registrados para inspecao da fonte; nao sao clicados e nenhum preco e inferido desses textos. Precos efetivos de check/reparo continuam indisponiveis; as horas restantes nao permitem deduzir com seguranca o intervalo ou os ajustes de custo da aeronave. Com pesquisa habilitada, manutencao e mercados sao consultados mesmo sem candidatas elegiveis; o teste isolado exige essas fontes e nao considera sua ausencia uma validacao bem-sucedida.

`serviceHints` registra somente trechos monetarios dos tooltips e nomes de atributos relacionados a preco/custo. Nao exporta valores ocultos, callbacks de servico ou atributos de autenticacao. Esses metadados passivos nao preenchem effectiveCheckPrice/effectiveRepairPrice e nao acionam nenhum servico. `demandResetHints` registra apenas avisos renderizados de renovacao/reset no painel #list-demand; lista vazia indica que nao houve aviso correspondente nesse painel inspecionado, sem supor horario ou comportamento global de renovacao.

O leitor do catalogo distingue modelo observado, modelo ausente da lista inspecionada e falha de coleta. Ausencia nessa lista nao prova inexistencia do modelo: nenhuma fonte alternativa e presumida. A validacao isolada pode aprovar o tratamento seguro dessa lacuna, mas registra modelSourcesComplete=false e mantem a manutencao efetiva e a comparacao economica bloqueadas.

## Custos e origem das formulas

`optimization/cost-budget.ts` separa calculos de referencia de custos efetivos.

| Cenario de referencia | Calculo | Limitacao |
| --- | --- | --- |
| Combustivel a preco de reposicao | lbs do orcamento × preco de mercado / 1000 | Nao e o custo contabil do estoque |
| CO2 | distancia × kg/pax/km × passageiros fisicos × preco de quotas / 1000 | Assume 1 quota/kg; conversao nao confirmada |
| A-check de catalogo | preco do modelo / intervalo do modelo × horas do trecho | Rateio de referencia; exclui reparos e ajustes efetivos |

Fontes das formulas: calculadora AM4 fornecida pelo operador, aba Calculadoras (1), celula G7; aba Faturamento e Lucro, celulas E13, E14 e E15. A propria planilha indica estar incompleta. O workbook nao e publicado neste repositorio.

CO2 e calculado separadamente com todos os assentos fisicos e com o teto por classe permitido pelo saldo apos reservas. `Y+2J+3F` nao representa pessoas. Reputacao nao e convertida em taxa de ocupacao. Sem saldo, o cenario de capacidade continua identificado como hipotese e o subtotal dependente da demanda fica null.

`partialSubtotalAtDemandCeiling` inclui somente combustivel, CO2 de referencia e rateio de A-check. Nao e custo operacional completo, lucro ou criterio de troca. A taxa de criacao permanece separada como despesa inicial. `totalOperatingCost` continua null.

O orcamento efetivo exige oito componentes: fuel, co2, aCheck, wearRepair, airport, staff, marketing e otherRecurring. Cada valor, inclusive zero, precisa de evidencia recente em USD por trecho, vinculada a aeronave e ao sentido correto, de cotacao efetiva inspecionada ou alocacao calibrada. Valores negativos, nao finitos, fontes de catalogo, identidade/sentido divergentes e totais fora do intervalo numerico seguro sao rejeitados. Somente todos os componentes verificados permitem total e agrupamento para RouteLeg. Essa validacao numerica nao substitui confirmar a fonte e a politica de alocacao.

O coletor atual nao fornece essas evidencias efetivas e nao cria um RouteReview completo. Historico financeiro agregado de salarios, marketing ou Bulk Repairs nao determina despesa de uma aeronave/trecho, nem custo medio de estoque. Despesas ausentes nao recebem zero automatico.

## Historico financeiro observado

`optimization/finance-reader.ts` consulta o menu Finance pelo ID e tooltip observados, pois Maintenance e Finance compartilham o ID mapMaint. Exige o callback exato `hideAllWhenClick();popup('finances.php','Finances');`, o titulo Finances e `#financeAction #transactionContainer`. Le as tres colunas visiveis (tempo relativo, tipo e valor). Fecha o popup pelo controle nativo e o chamador restaura Fleet. Nao clica em Expenses, Marketing, Stock, servicos, compras ou formularios.

Os tipos inspecionados incluem compras de Fuel/Co2, Bulk A-Check, Staff salary, Marketing, Lounge maintenance, New route fee, A/C Purchased, Daily Gift e creditos de partidas agrupadas. Tipos desconhecidos ficam unclassified, sem reter sua descricao; valores invalidos ou sinais conflitantes invalidam a leitura. Aquisoes de aeronaves e taxas iniciais nao sao convertidas em despesas recorrentes do voo.

`finance-history.json` e `candidate-data.json.financeHistory` registram os lancamentos visiveis e referencias de preco pago por mil unidades nas compras visiveis de Fuel/Co2. Nao leem saldo, pontos, credenciais ou dados de sessao. Esses pagamentos sao evidencia de uma transacao; nao comprovam o custo medio do estoque, o historico completo ou o custo de um trecho futuro. Horarios como "hours ago" sao arredondados e nao geram timestamps exatos. Bulk A-Check nao identifica aeronaves/ciclos; salarios, campanhas e lounges nao possuem alocacao confirmada por voo. `historyComplete=false`, `exactTransactionTimesAvailable=false`, `perLegCostsComplete=false` e `comparisonReady=false` permanecem obrigatorios. Essa fonte e referencia contabil, nao preenche automaticamente nenhum dos oito componentes efetivos.

## Validacao e pendencias

Os testes usam dados sinteticos, exercitam reservas entre aeronaves em solo/em voo, sentidos separados/compartilhados, esgotamento, alternativas independentes, coleta incompleta e dados invalidos. Os testes de custo cobrem as oito despesas, zeros explicitos, identidade, unidades, expiracao e aritmetica. Os testes HTML de manutencao verificam que nenhum servico e acionado. A coleta isolada do Actions exige leitura integral dos cartoes de manutencao e bloqueios economicos preservados.

Ainda faltam saldo nativo de candidatas sem rota, escopo/horarios/renovacao confirmados para reservas futuras, conversao CO2 e custo efetivo de manutencao, reparos e demais despesas, alem de dados completos da volta e ocupacao calibrada nos precos propostos. Manter DEMAND_DRY_RUN=true e todos os novos controles operacionais desativados.
