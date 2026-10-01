# Inspeção de leitura — 01/10/2026

Login pelo formulário seguro do ChatGPT, sem exposição das credenciais. Companhia xPiekas confirmada. Interface inicialmente mostrava 29 rotas, 30 aeronaves e 1 aeronave pendente. Estes números são uma observação pontual; não foi realizada coleta completa de todas as aeronaves nesta inspeção.

| Aeronave | Origem operacional | Posição/ próximo trecho observado | Capacidade Y/J/F | Demanda restante Y/J/F | Total diário Y/J/F | Avaliação |
| --- | --- | --- | --- | --- | --- | --- |
| BC-605, ID 22316469 | GRU, cadastro do proprietário | Em solo em XAP; próximo trecho XAP–GRU | 12/0/0, confirmado na inspeção anterior e painel de voo | 463/474/72 | 529/474/72 | Demanda cobre os assentos; revisão de rota aguarda retorno a GRU |
| ATR 72-500, ID 20452146 | GRU, única base da rota GRU–BSB | Em solo em GRU; próximo trecho GRU–BSB | 44/9/0 | 731/510/295 | 886/543/295 | Demanda cobre 100% dos assentos; consulta de candidatas elegível |

O ATR foi observado em voo BSB–GRU e posteriormente em solo GRU–BSB durante esta sessão. Isso confirma o retorno visualmente, mas não fornece um ID de evento de voo para persistência/deduplicação.

Orçamento nativo GRU–IGU consultado para o ATR: distância 846 km; duração 01:01:12; combustível 9.678 lbs; CO₂ 0,14 kg/pax/km; índice de custo 200; taxa de rota $13.750; demanda **diária** 732/619/43; A/C on route 0. Referência de callback `autoPrice(509,1237,2216,22)` lida sem execução. Não foram confirmados demanda restante da candidata, preços efetivos, custos completos ou ocupação nas tarifas reajustadas. Portanto, nenhuma conclusão de melhor rota foi produzida.

Navegação confirmada: link da aeronave → detalhes → Reroute (abre planejador) → Suggest route → Next (abre orçamento) → Back (fecha orçamento) → Fleet (reabre lista). Create route, Autoprice, Depart, Ground, Sell e operações financeiras não foram executados.

Constatação para a integração: o menu principal Fleet alterna o popup e pode fechá-lo quando já aberto. A aba `#popBtn1` usa consulta `Ajax('routes.php','routeAction',this,false,false)` para retornar à primeira página quando o painel está aberto. Paginação Next usa consulta `routes.php?start=20&sort=`. O retorno ao detalhe após o planejador pode recriar a lista; não se deve reutilizar o cursor de paginação anterior.

A inspeção foi manual por controles de leitura. Os testes de integração usam DOM sintético e rede bloqueada. Ainda falta validar a coleta integral no GitHub Actions; este documento não comprova execução integral do bot na companhia.
