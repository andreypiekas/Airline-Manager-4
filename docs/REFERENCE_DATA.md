# Referências de rotas e calendário de preços

Integração exclusivamente informativa, em simulação. Não altera rotas, tarifas, compras ou decolagens. O relatório `test-results/demand/reference-report.json` acompanha os artefatos de demanda do GitHub Actions. Nenhum arquivo original ou credencial é necessário no workflow.

## Rotas

Importação de `All_routes.xlsx`: 1.003.236 linhas examinadas, 4.651 registros direcionais relacionados a XAP, GRU ou DTW, sem conflitos detectados entre duplicatas direcionais. São referências estáticas, não demanda restante. Cada registro preserva linha de origem; o catálogo registra SHA-256 do arquivo. A comparação com os dados brutos A:H de `Rotas por Hub 2.3.xlsx` encontrou 4.521 correspondências direcionais e nenhuma diferença de distância.

Para cada aeronave com origem resolvida, configuração válida e alcance conhecido, o relatório lista até dez destinos dentro do alcance direto. Prioriza cobertura dos assentos configurados pela demanda de referência, com desempate por distância menor e código do destino. Classes sem assentos não penalizam a avaliação. Registros invertidos preservam `sourceDirection`: isso não confirma a demanda do sentido inverso. A lista é uma fila de pesquisa, não uma classificação de lucro ou garantia das melhores rotas.

A coleta incompleta impede a criação da lista. A origem continua sendo resolvida pelas bases XAP/GRU/DTW e pelas configurações explícitas, incluindo exceções cadastradas explicitamente pelo operador. Duas bases na mesma rota exigem desambiguação. Revisão no retorno e revisão diária continuam sob a política existente.

Antes de avaliar uma troca, faltam cotações atuais por sentido, demanda restante por classe, reservas de outras aeronaves, preços automáticos, tempos, pistas e custos completos. Por isso `remainingDemand` e `estimatedProfit` ficam nulos e `mutationAuthorized` é sempre falso. O catálogo não alimenta artificialmente o DemandManager nem marca uma revisão econômica como concluída.

## Combustível e CO₂

Os PDFs para meses de 30 e 31 dias usam Brasília/GMT−3 e avisam que os preços podem sofrer alteração sem aviso prévio. As páginas são imagens. A extração OCR gerou 418 horários de combustível e 588 de CO₂ no calendário de 30 dias; 429 e 589 no de 31 dias. Todos permanecem `verified: false` e `ocr-unverified`: a extração pode omitir linhas ou ler números incorretamente, mesmo sem erro estrutural. A origem e seu SHA-256 ficam registrados.

O relatório seleciona o calendário pelo número real de dias do mês em GMT−3. Fevereiro não é coberto. Mostra o preço de referência somente se o minuto consultado estiver explicitamente listado; não presume que o preço persiste nos horários omitidos. Mostra até cinco próximos horários listados do mesmo dia, sem executar agendamentos nem compras. Dias sem dados válidos ou com horários duplicados/desordenados ficam indisponíveis. Toda decisão futura deve conferir o preço visível no jogo; o calendário nunca autoriza compra.

## Calculadora

`CALCULADORAS AM4 v1.41 (1).xlsx` confirma os multiplicadores Y 1,10 / J 1,08 / F 1,06 e truncamento para múltiplo de dez. A implementação existente continua usando o preço automático observado, sem substituir esse valor por estimativas de distância. A planilha apresenta fórmulas de preço por distância diferentes nos modos Easy e Realism; resultados em cache e wrappers `__xludf.DUMMYFUNCTION` não provam recálculo válido.

A coluna de passageiros totais da base de rotas é ponderada (Y + 2J + 3F); não deve ser somada como ocupação física. Células geradas com `#REF!` na planilha de hubs foram excluídas. O lucro simplificado da calculadora desconta combustível e CO₂, mas não todos os custos exigidos pelo otimizador. Reputação não foi adotada como garantia de ocupação após reajuste de tarifa. Esses pontos impedem declarar uma rota a mais lucrativa apenas com as planilhas.

## Reprodução offline

Execute somente sobre os arquivos fornecidos, em um diretório separado do repositório:

```bash
python scripts/import-route-references.py /caminho/dos/arquivos
python scripts/import-fuel-calendar.py /caminho/dos/arquivos
```

O primeiro usa apenas a biblioteca padrão Python e lê XML em streaming. O segundo requer PyMuPDF, Pillow, NumPy e Tesseract; suas imagens intermediárias ficam em diretório temporário. Importação é uma tarefa manual offline, não executada no GitHub Actions. As tabelas OCR sempre voltam a não verificadas ao reimportar. Preserve os originais para auditoria; não é preciso publicá-los.

## Pendências de produção

A persistência do transporte foi validada com eventos sintéticos em dois runners reais do GitHub Actions. Permanecem pendentes o histórico operacional da companhia, a coleta completa de candidatas e sua integração à execução do bot. Consulte [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) para evidências e limites atuais. Este avanço não habilita produção. Os testes usam dados simulados, sem operações no jogo.
