# Auditoria de ocupação observada

O coletor preserva o texto `Onboard: Y / J / F` dos cartões de rotas em voo, confirmado novamente na interface em 30/09/2026. O relatório `test-results/demand/occupancy-audit.json` compara esses passageiros com a configuração de assentos lida nos detalhes. Integra os artefatos existentes do workflow.

Estados: `empty` para zero passageiros confirmado, `low` abaixo de `MIN_DEMAND_PERCENTAGE`, `sufficient` no limite ou acima e `unavailable` quando faltam dados confiáveis. Somam-se passageiros e assentos físicos das classes configuradas; não se pondera J/F por preço ou espaço de configuração.

Uma coleta incompleta, identidade duplicada, leitura expirada, falha dos detalhes, número negativo, passageiros acima dos assentos ou capacidade total zero impedem o cálculo. Um campo desconhecido jamais é convertido em zero. A ausência de passageiros não é inferida da demanda restante.

Esse indicador descreve um voo em andamento. Não estima ocupação após novos preços, não comprova a causa de um voo vazio e não autoriza decolagem ou mudança de rota. A proposta de decolagem continua usando exclusivamente demanda restante e as regras do DemandManager. Aeronaves em solo não entram nesta auditoria de voos em andamento.

A sessão autenticada foi restabelecida por formulário protegido, sem leitura ou armazenamento de credenciais pelo assistente. Esta inspeção não realizou operações no jogo. Candidatas completas para otimização e persistência real entre runners continuam pendentes; testes com API simulada não substituem essa validação.
