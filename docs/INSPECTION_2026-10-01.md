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

A inspeção foi manual por controles de leitura. Os testes de integração usam DOM sintético e rede bloqueada. A coleta integral das 29 rotas foi posteriormente validada no Actions 36859515879, com 29/29 detalhes verificados. Isso comprova o percurso de leitura nessa execução, sem comprovar a comparação econômica completa ou qualquer operação real.

## Inspeção de custos e identidade dos cartões em voo

O cartão em voo do DC-9-10 não tem span acRegList, mas seu link tem callback de consulta fleet_details.php?id=21038003. Seu registro foi confirmado no detalhe. Essa observação orientou a correção posteriormente aprovada no Actions.

Maintenance e Plan mostram horas, wear e disponibilidade em base, sem orçamento completo. A-Check/Repair chamam maint_plan_do.php, endpoint de serviço que NÃO foi acionado. At base nesse painel não foi usado para inferir a origem operacional própria de cada aeronave.

Na aba Order, apenas o cartão de detalhes do ATR 72-500 foi aberto; o botão Order não foi acionado. #acModel contém linhas com células A-Check / $20,125 e Maint check / 480 Hours; #modelSelection confirma o nome, e o callback da consulta contém model ID 22. As referências não bastam para computar toda a manutenção por voo.

Fuel: Current price $1,280 e gráfico Fuel price per 1,000 Lbs. Co2: Quota cost $133 e gráfico Co2 quota cost per 1,000. Os campos de compra não foram alterados. A conversão entre emissão kg/pax/km e quotas cobradas não foi confirmada.

A documentação oficial [How does demand work](https://airlinemanager.zendesk.com/hc/en-us/articles/21732303589138-How-does-demand-work) confirma demanda diária por classe e ausência de passageiros após esgotamento; não fornece, nessa página, horário de renovação nem regra de compartilhamento por sentido. Referência de custo por hora baseada numa divisão linear do A-check seria uma hipótese, portanto não foi usada como custo confirmado.
