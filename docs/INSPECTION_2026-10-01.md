# Inspeção técnica de leitura — 01/10/2026

Foram consultados Fleet, detalhes de aeronaves, planejador de rotas, catálogo, Maintenance/Plan e mercados Fuel/Co2. Esta versão pública omite identificação da companhia, aeronaves, rotas e valores observados na conta.

## Mecanismos confirmados

- Cartões em solo e em voo usam callbacks de consulta fleet_details.php com ID da aeronave. O span acRegList pode faltar nos cartões em voo; o ID do callback e o registro do painel devem concordar.
- Os detalhes apresentam configuração Y/J/F, demanda restante/diária, próximos aeroportos, alcance, pista mínima e horas/ciclos. Ciclos não foram promovidos a ID de evento de voo.
- Reroute abre o planejador; Suggest/Next abrem orçamentos; Back fecha o orçamento. Apenas esses percursos de consulta foram usados. A tabela Daily pax demand não fornece saldo restante da candidata.
- O menu Fleet pode alternar o popup; a aba Fleet consulta routes.php para restaurar uma lista nova. Paginação exige validar o callback e aguardar substituição da página.
- O catálogo permite consultar o modelo sem acionar Order/Configuration. #modelSelection confirma o nome; #acModel contém células adjacentes A-Check e Maint check. São referências de catálogo, não custos completos da aeronave por voo.
- Fuel apresenta Current price e unidade Fuel price per 1,000 Lbs; Co2 apresenta Quota cost e unidade Co2 quota cost per 1,000. Cada preço recebe data de observação.
- Maintenance/Plan apresenta horas, desgaste e disponibilidade em base. Os controles de serviço chamam maint_plan_do.php e não foram acionados. At base não foi usado para atribuir a origem operacional própria da aeronave.
- O controle de fechar é o único [onclick] no pai de #popTitle, com callback closePop();document.getElementById('rewardPopup').style.display='none';. Fechar a consulta antes de mudar para Fuel evita cliques interceptados pelo overlay.

## Evidência e limites

Percurso automatizado de leitura aprovado no Actions: https://github.com/andreypiekas/Airline-Manager-4/actions/runs/36862952783. O relatório de validação verifica detalhes, consultas candidatas, referências de modelo, preços/unidades e restauração; não aprova uma comparação econômica completa.

A documentação oficial https://airlinemanager.zendesk.com/hc/en-us/articles/21732303589138-How-does-demand-work confirma demanda diária por classe e ausência de passageiros após esgotamento. Horário de renovação e compartilhamento por sentido não foram confirmados nessa fonte.

Demanda das candidatas sem rota existente, reservas futuras, conversão kg/quotas, manutenção efetiva, custos adicionais e ocupação nas tarifas propostas continuam pendentes. Não foram executados Depart, Create route, Autoprice, Ground, Ferry, compras ou serviços.
