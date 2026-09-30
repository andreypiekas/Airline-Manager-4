# Simulações de múltiplas execuções — 30/09/2026

A suíte local passou com 199 testes, incluindo três cenários completos, um por base XAP, GRU e DTW. Cada cenário usa seis diretórios de execução independentes, com restauração e salvamento pelo transporte GitHubReturnState contra uma API simulada em memória.

| Execução | Condição | Resultado esperado |
| --- | --- | --- |
| 1 | Candidatas incompletas | Indisponível; não grava revisão concluída |
| 2 | Demanda esgotada | Manter em solo; grava revisão |
| 3 | Repetição no mesmo dia | Já revisado; não duplica histórico |
| 4 | Demanda renovada no dia seguinte | Manter rota atual viável; nova revisão |
| 5 | Repetição dessa análise | Já revisado; histórico preservado |
| 6 | Rota mais rentável em novo dia | Propor troca; sem aplicar |

A simulação inclui custos de troca, demanda por trecho e reajuste de preço, sempre com dados sintéticos. O servidor de teste gera uma nova versão SHA para cada gravação, reproduzindo conflitos de versões também após mais de uma atualização.

O workflow de validação publica `synthetic-simulation-reports`, com um `simulation-report.json` por base. Os relatórios contêm decisões, justificativas, resultados econômicos simulados e quantidade de eventos persistidos; não incluem credenciais ou dados reais da companhia. Não há chamadas ao jogo nem à API real do GitHub nesses testes.

## O que ainda não foi validado

Esses testes não substituem uma execução com transporte real entre runners do GitHub Actions. A inicialização do histórico remoto e sua configuração operacional continuam pendentes. A coleta completa de candidatas, custos e demanda atual na interface também permanece pendente; referências de planilhas não são suficientes para habilitar trocas automáticas.

A validação do commit 60848e0 passou no GitHub Actions (execução 36749871839). A sessão do navegador disponível nesta etapa abriu a página pública do jogo, sem acesso autenticado à companhia. É necessário restabelecer o login para continuar a inspeção de leitura. Nenhuma operação no jogo foi realizada.
