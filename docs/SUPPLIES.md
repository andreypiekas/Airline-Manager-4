# Abastecimento no fluxo de demanda

O workflow principal `playwright.yml` consulta combustível e CO₂ antes de coletar a frota e executar as decolagens individuais. `ENABLE_FUEL` controla ambos; ausente significa `true`, como no fork original. A simulação de decolagens também torna as compras simuladas. O workflow isolado de decolagens não executa compras.

| Variável | Regra |
| --- | --- |
| MAX_FUEL_PRICE | Compra somente abaixo deste preço por 1.000 **Lbs**; padrão 550 |
| MAX_CO2_PRICE | Compra somente abaixo deste preço por 1.000 quotas; padrão 120 |
| MAX_FUEL_PURCHASE_PER_RUN | Quantidade máxima de combustível por execução; ausente/0 usa espaço disponível |
| MAX_CO2_PURCHASE_PER_RUN | Quantidade máxima de quotas por execução; ausente/0 usa espaço disponível |
| MIN_CASH_RESERVE | Saldo que deve permanecer disponível; padrão 0 |
| ENABLE_FUEL | false desabilita combustível e CO₂ |

A igualdade ao teto não autoriza compra, preservando a comparação `<` do upstream. As exceções emergenciais do upstream (combustível até 1250 e CO₂ até 180) não são usadas no novo fluxo: estoque baixo nunca ignora os tetos configurados. O preço é lido da tela atual; o calendário fornecido não substitui essa leitura.

Se houver saldo disponível para o volume planejado, ele é comprado. Caso contrário, usa-se no máximo metade do saldo disponível após a reserva. Aplica-se essa proteção também ao CO₂. A quantidade respeita espaço livre e limite por execução; o saldo é relido após o combustível, antes do CO₂. A cotação total deve corresponder à quantidade, permanecer no orçamento e ter preço estável antes do clique. Não compra nos últimos 10 segundos antes da mudança de preço.

Os controles de menu, unidades e handlers nativos de Purchase foram observados em leitura autenticada no Actions 36940453426 (01/10/2026). O combustível é medido em **Lbs**, apesar do comentário em litros no código antigo. Nenhum botão de aumento de capacidade é usado. O módulo clica o controle nativo confirmado; não envia chamadas diretas aos endpoints do jogo.

A intenção de compra é persistida antes do clique. Estoque, espaço disponível e pagamento são confirmados por leitura após a resposta nativa. Uma confirmação inconclusiva encerra a execução, sem repetir a compra ou seguir para decolagens. Alterações simultâneas manuais podem provocar essa parada conservadora. O mesmo bloqueio de conta, uma tentativa no Actions e marcador exclusivo por execução protegem as compras contra duplicação.

`supply-report.json` e `supply-report.md` ficam no artefato `demand-report` e no resumo do Actions. `purchased` exige confirmação; `would_buy` é apenas simulação; `skipped` explica preço/estoque/orçamento; `unknown` exige inspeção do estoque antes de nova execução. Não confundir comprar estoque com calcular lucro líquido por trecho: os custos completos de rotas candidatas continuam pendentes. Manutenção, campanhas e ajuste de rotas/tarifas não são ativados por esta alteração.
