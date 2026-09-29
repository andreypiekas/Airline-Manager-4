# Revisão ao retornar à base e tarifas PAX

## Entrega em simulação

Foram adicionados o cálculo de tarifas, a leitura do controle Auto já inspecionado e um motor independente para comparar rotas ao retornar à própria base. Todos os resultados são recomendações: `dryRun=true`, `mutationAuthorized=false`. Não existe clique em Auto, Save ou Reroute, nem alteração de rota/preço/decolagem.

**Integração de rotas ainda pendente:** a sessão autenticada anterior não estava disponível ao retomar a inspeção. Não foram inventados seletores para base da aeronave, posição atual, ID de voo/chegada, candidatos ou custos. O relatório automático marca a revisão da rota como indisponível até esses dados estarem confirmados e um provedor preencher `RouteReview`. Portanto este código ainda não troca rotas automaticamente nem afirma encontrar a melhor rota do jogo inteiro.

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
