# Reservas e custos das candidatas — simulacao

Nenhum dado desta camada autoriza uma operacao. O relatorio `candidate-data.json` usa schemaVersion 2, preserva os campos anteriores e acrescenta `reservations`, `costScenarios`, `effectiveCosts` e referencias individuais de manutencao.

## Demanda sem rota existente

O orcamento nativo inspecionado informa `Daily pax demand`, nao o saldo ainda disponivel. A quantidade `A/C on route` nao e prova de saldo pleno. Sem uma observacao valida do mesmo sentido em uma rota existente, `remaining` e `forwardAfterReservations` continuam null. Uma leitura inversa nao preenche o saldo de ida.

Nao foram implementados seletores ou chamadas presumidas para obter saldo de uma rota nova. O suporte oficial descreve demanda diaria e seu esgotamento, mas nao fornece nesta pagina uma API de saldo para candidatas: https://airlinemanager.zendesk.com/hc/en-us/articles/21732303589138-How-does-demand-work

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

## Manutencao observada

`optimization/maintenance-reader.ts` consulta o menu Maintenance e a aba Plan. Aguarda o callback da aba anterior ser substituido pelo callback confirmado de Plan, sem clicar no controle antigo. Le os cartoes `.maint-list-sort`, `data-reg`, `data-base`, `data-wear`, `data-hours` e `controls<ID>`, conferindo registro, identidade e labels visiveis. O registro visivel preserva maiusculas/minusculas; data-reg e somente uma chave de ordenacao em minusculas. A identidade exige ID e registro visivel exatos, alem de conferir a chave de ordenacao. Rejeita filtro diferente de Showing all, cartoes ocultos, duplicados e valores divergentes. Fecha o popup e o chamador restaura Fleet. Diagnosticos registram somente a etapa de falha; nunca HTML, formularios ou dados de sessao.

Os campos Flight hours, Hours to check e Wear sao referencias de estado. At base nao define a origem propria da aeronave. A-Check, Repair, Modify e controles Bulk nunca sao clicados. Precos efetivos de check/reparo continuam indisponiveis; as horas restantes nao permitem deduzir com seguranca o intervalo ou os ajustes de custo da aeronave. Com pesquisa habilitada, manutencao e mercados sao consultados mesmo sem candidatas elegiveis; o teste isolado exige essas fontes e nao considera sua ausencia uma validacao bem-sucedida.

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

## Validacao e pendencias

Os testes usam dados sinteticos, exercitam reservas entre aeronaves em solo/em voo, sentidos separados/compartilhados, esgotamento, alternativas independentes, coleta incompleta e dados invalidos. Os testes de custo cobrem as oito despesas, zeros explicitos, identidade, unidades, expiracao e aritmetica. Os testes HTML de manutencao verificam que nenhum servico e acionado. A coleta isolada do Actions exige leitura integral dos cartoes de manutencao e bloqueios economicos preservados.

Ainda faltam saldo nativo de candidatas sem rota, escopo/horarios/renovacao confirmados para reservas futuras, conversao CO2 e custo efetivo de manutencao, reparos e demais despesas, alem de dados completos da volta e ocupacao calibrada nos precos propostos. Manter DEMAND_DRY_RUN=true e todos os novos controles operacionais desativados.
