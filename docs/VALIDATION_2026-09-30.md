# Validacao de integracao — 30/09/2026

Status: simulacao validada; operacoes reais ainda nao liberadas.

## Evidencias confirmadas no navegador

- Companhia xPiekas autenticada; navegacao apenas de leitura.
- Interface: 27 rotas, Fleet 28 e Pending 1. Sao contadores diferentes; nao tratar o numero de rotas como tamanho total da frota.
- BC-605, aeronave 22316469, rota 33272938, em solo. Lista GRU-XAP; detalhes mostram proximo trecho XAP-GRU.
- Capacidade Y/J/F: 12/0/0. Demanda restante/total: 495/529, 474/474, 72/72.
- Historico mais recente GRU-XAP, Y11/J0/F0. Demanda suficiente para 12 assentos nao garante embarque de 12 passageiros.
- Auto: `ticketPriceSuggest(469,1157,2096,this,383)`. Funcao incorporada ao DOM confirma fator VIP 1,8 com arredondamento para cima. Referencia resultante 845/2083/3773; proposta Y 920, J/F sem alteracao porque nao possuem assentos. Inputs de tarifa estavam vazios, portanto apenas recomendacao.
- `#routeViewDepart` chama `route_depart.php?id=33272938&ref=list&costIndex=200`, mas esconde o botao ANTES da chamada. Desaparecimento do botao nao confirma sucesso. Nenhuma chamada executada.
- Save usa `set_ticket_prices.php` com a identidade da rota. Auto e Save nao foram clicados; tarifas nao foram preenchidas.
- ATR 72-500 em voo GRU-BSB, chegada exibida 12:09:55 UTC, capacidade 44/9/0, passageiros a bordo 38/7/0. O primeiro registro do historico ja representa este voo ainda em andamento. Historico nao e prova de pouso.
- `#flight-history` inspecionado possui horarios relativos, sem ID de voo ou timestamp absoluto por linha. Horarios HH:mm:ss UTC e contador de ciclos nao foram validados como identificador unico de retorno.

## Validacao automatizada

`npm run typecheck`, `npm run build:state` e `npm test` executados localmente, sem acesso ao jogo nos testes. Dois testes adicionais reproduzem os dados observados da BC-605, a referencia VIP, ausencia de origem, classes inativas e demanda economica esgotada. A colecao de uma aeronave nesses testes e sintetica; nao representa coleta integral real.

Execucao GitHub 36710166568, commit 5ddd8ea45bef62c4bb2addb56a0744978907890c: sucesso, 150 testes, leitura de 27 aeronaves vinculadas a rotas; uma avaliada e 26 em voo. Nenhuma operacao real pelo gerenciador.

## Pendencias para producao operacional

1. Confirmar e cadastrar a origem operacional de cada aeronave. Nao inferir pela base da companhia, pela ordem dos aeroportos ou pelo aeroporto atual.
2. Implementar e validar observacoes persistentes de voo/chegada com identidade inequivoca. Uma linha de historico ou botao oculto nao basta. A transicao real de retorno nao foi observada nesta sessao.
3. Concluir o provedor de candidatos com demanda restante, ida/volta, custos e ocupacao prevista. A pesquisa de demanda diaria nao basta para comparar lucro por hora. Melhor rota significa melhor entre candidatos validos e completos, nao garantia global.
4. Implementar executor individual com registro persistente de tentativa ANTES do clique, releitura de estado/demanda e confirmacao independente posterior. Resultado incerto deve bloquear repeticao automatica; nunca repetir so porque houve timeout.
5. Validar aplicacao de tarifas e mudanca de rota em teste operacional controlado, autorizado separadamente. Nova rota exige nova referencia Auto e avaliacao de custos antes de salvar/criar.
6. Inicializar e testar transporte do journal no GitHub antes de habilita-lo; testes locais usam API simulada. Nenhuma branch de estado foi criada nesta validacao.

Nao houve merge, alteracao de cron, criacao/alteracao de rota, compra, manutencao, campanha, decolagem ou alteracao de preco. `DEMAND_DRY_RUN=true`, `DEMAND_FAIL_SAFE=true` e `ENABLE_RETURN_JOURNAL=false` permanecem como padrao.
