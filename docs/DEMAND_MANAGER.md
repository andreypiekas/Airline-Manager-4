# DemandManager — primeira entrega em simulação

## Estado e limites de ativação

O módulo está implementado para **leitura e simulação**. Nenhuma decisão concede autorização real (`departureAuthorized=false`). `DEMAND_DRY_RUN=false` ou `DEMAND_FAIL_SAFE=false` provoca erro antes do login no fluxo principal. Não há código de clique individual habilitado. A ativação real exige autorização posterior, implementação do executor e validação do resultado de cada decolagem.

Com `ENABLE_DEMAND_MANAGER=true` (padrão desta entrega), a rotina faz login, abre Fleet/Routes, coleta dados e termina. Não executa combustível, CO₂, manutenção, campanhas, decolagens, alteração de preços, Ground, Reroute, compra ou venda. `ENABLE_DEPART` não impede a análise somente de leitura. Falhas **nunca** caem em `departAll`.

O fluxo legado continua no código, acessível exclusivamente com `ENABLE_DEMAND_MANAGER=false`. Ele executa operações reais conforme os antigos `ENABLE_*`; não deve ser usado para testar esta entrega. Essa configuração não ativa decolagem inteligente. O PR não altera variáveis, secrets, cron-job.org nem executa workflows da companhia.

## Inspeção em 29/09/2026

Confirmado por navegação autenticada somente de leitura:

- Fleet contém Routes, Fleet (inventário por modelo), Parked e Pending.
- Havia 26 rotas em duas páginas (20 + 6); cinco cartões com Depart e 21 com Onboard/contador de voo. Pending estava vazio; não foi confirmado agendamento futuro.
- Cartão em solo mostra `Demand: Y / J / F`. Cartão em voo mostra `Onboard`, que **não é demanda restante**.
- Detalhes mostram `Todays demand` como restante/total, distinguindo as três classes por imagens de assentos. Um exemplo era 34/993 na econômica; capacidade 99/0/0. Portanto o teto coberto por demanda era 34,34%.
- Outro exemplo tinha capacidade 131/0/0 e demanda 0/352/383: a demanda das outras classes não permite transportar passageiros em assentos econômicos.
- Duas aeronaves da mesma ligação mostravam exatamente 412/299/168 restantes e 1333/418/273 totais, mas layouts diferentes (90/9/9 e 81/12/10).
- A tela contém `Ground`, `Grounded` e `Depart`. Os controles Ground e Depart são mutações e **não foram acionados**. O efeito e a reversão do estado Grounded permanecem não testados. Manter em solo neste projeto significa não decolar, sem alterar o estado nativo Ground.
- O histórico continha voos com Y0/J0/F0. Não se deve assumir que o jogo bloqueia automaticamente voos vazios.
- Os aeroportos nos detalhes podem aparecer na ordem inversa ao cartão. O relatório preserva o texto do cartão; `from`/`to` representam a ordem mostrada nos detalhes, sem afirmar que esse sentido foi validado por decolagem.

Ainda não confirmado:

- Horário/fuso exato de renovação, eventual reposição gradual, efeito de eventos ou diferenças de modo de jogo. O rótulo diário não prova reset à meia-noite UTC.
- Compartilhamento efetivo do consumo entre sentidos e entre aeronaves. Os valores coincidentes são evidência visual, não um experimento de consumo. Por segurança, o padrão agrega os dois sentidos do mesmo par e reserva passageiros uma única vez.
- Ocupação real: reputação, preço e outras regras podem reduzir embarques. O percentual do relatório é **limite por disponibilidade**, não garantia ou previsão calibrada de ocupação nem teste de rentabilidade.
- Resultado/confirmacão de decolagem individual, reação a concorrência externa e coleta automática ponta a ponta no runner GitHub. Nenhuma operação real foi testada.
- Não houve captura de tráfego de rede: os endpoints abaixo foram identificados nos atributos dos controles DOM. Não foram feitas chamadas diretas, acessos a cookies/tokens ou exploração de APIs internas.

## Seletores observados

| Objetivo | Elemento confirmado | Uso |
| --- | --- | --- |
| Abrir frota/rotas | `#mapRoutes` | Navegação |
| Lista | `#routeAction`, `#routesContainer` | Aguardar painel |
| Cartão | `#routeMainList<ID_ROTA>` | Separar aeronaves/rotas |
| Aeronave | `a span#acRegList<ID_AERONAVE>` | ID técnico e registro |
| Rota exibida | `span.s-text` com `IATA - IATA` | Identificar par |
| Em solo | `.listDepartable` + botão visível/habilitado | Candidato, não autorização |
| Decolagem individual | `#listDepart<ID_ROTA>` | Apenas alvo preparado, sem clique |
| Detalhes | link da aeronave; `#detailsAction` | Leitura |
| Identidade dos detalhes | `#ff-name`, `#routeViewDepart[onclick]` | Verificar registro e ID da rota |
| Voltar | `#route-name .glyphicons-chevron-left` | Navegação |
| Capacidade | `#seat-layout img[src$="/economy_seat.png"]`, `business_seat.png`, `first_seat.png` | Texto direto no elemento pai; não lê campos de preço |
| Demanda | mesmas imagens em `#list-demand` | Restante/total por classe |
| Trecho em detalhes | `.col-5 span.l-text` | Conferir aeroportos contra o cartão |
| Próxima página | `#routesContainer .pagination` → link `Next` | Percorrer e conferir contagem |
| Ground | `#routeViewGround_unground` | Verificar disponibilidade, sem clicar |

Atributos observados referenciam `routes.php?start=...`, `fleet_details.php?id=...`, `route_depart.php?id=...` e `fleet_ground.php?id=...`. Apenas os links de navegação da própria interface são usados. IDs concretos são extraídos dos cartões, não gravados como configuração da companhia.

## Cálculo

Para cada classe c:

`passageiros_possiveis[c] = min(capacidade[c], demanda_disponivel[c])`

`percentual = 100 * soma(passageiros_possiveis) / soma(capacidade)`

No modo `aggregate`, exige `ceil(soma(capacidade) * limite / 100)` passageiros. No modo opcional `per-class`, exige esse percentual separadamente em cada classe com assentos. Classes sem assentos não vetam a aeronave. Demanda zero nas classes utilizadas mantém em solo mesmo que outras classes tenham demanda.

Ao simular uma liberação, reserva o máximo possível em cada classe, e não só o mínimo do limite. A próxima aeronave utiliza o saldo simulado. A ordem é a ordem dos cartões/páginas; não é um otimizador de lucro. Leituras diferentes do mesmo pool usam o menor restante observado. Totais diários divergentes bloqueiam o pool (possível virada de dia ou hipótese de compartilhamento incorreta).

Não há estado persistente de bloqueio: cada execução relê a demanda. Quando ela se renova, a próxima simulação pode liberar novamente. Dados ausentes, fracionários, negativos, expirados, identidade divergente, total inconsistente ou duplicidades nunca autorizam decolagem. Uma coleta global incompleta bloqueia todas as liberações simuladas.

## Configuração

| Variável | Padrão | Observação |
| --- | --- | --- |
| `ENABLE_DEMAND_MANAGER` | `true` | Ativa a rotina exclusivamente de simulação |
| `MIN_DEMAND_PERCENTAGE` | `80` | Maior que 0 e até 100; 80 é política inicial, não regra do jogo |
| `DEMAND_DRY_RUN` | `true` | `false` rejeitado nesta versão |
| `DEMAND_FAIL_SAFE` | `true` | `false` rejeitado nesta versão |
| `DEMAND_THRESHOLD_MODE` | `aggregate` | Alternativa `per-class` |
| `DEMAND_POOL_SCOPE` | `airport-pair` | Conservador; `directional` apenas para simulação/estudo |
| `DEMAND_MAX_AGE_SECONDS` | `300` | Máximo 3600; leituras antigas bloqueadas |
| `DEMAND_TELEGRAM_ENABLED` | `false` | Envia apenas totais agregados se habilitado explicitamente |

Booleanos aceitam apenas `true`/`false`; erros de digitação são rejeitados. Carga/charter não suportado é indisponível, nunca convertido em passageiros. O layout e os labels devem estar em inglês.

## Concorrência e segurança

- Workflow operacional mantém `concurrency.group: airline-manager-4-main` e `cancel-in-progress: false`, compartilhado por branches no mesmo repositório.
- Execuções locais no mesmo checkout usam diretório exclusivo `.am4-run.lock`. Após encerramento abrupto, confirme que não há execução ativa e remova manualmente o lock abandonado. Não há remoção automática perigosa.
- Locks locais não cobrem outros computadores/checkouts; GitHub concurrency não cobre outros repositórios nem operações manuais. Antes de futura operação real, escolha um único executor e releia os dados antes de cada decolagem, confirmando resultado sem repetir cliques de resultado incerto.
- ID de aeronave ou rota duplicado bloqueia a decisão. Não há execução individual nesta entrega, portanto nenhuma repetição de decolagem gerada pelo novo módulo.
- Trace, vídeo e screenshots automáticos são desligados para evitar gravação da autenticação; a opção antiga de vídeo não reativa gravação nesta entrega. Capturas explícitas de diagnóstico existentes ficam no fluxo legado.
- Não foram adicionados mecanismos de evasão, mudanças de fingerprint ou acesso a sessão.

## Relatórios, Telegram e execução

- `test-results/demand/demand-report.json`: schema, instante de leitura, estado, IDs, trechos, capacidade, restante, total diário, pool, reservas, necessidade mínima, percentual e justificativa.
- `test-results/demand/demand-report.md`: tabela legível e resumo.
- Artefato `demand-report` e resumo do GitHub Actions; retenção 7 dias. Relatórios contêm dados operacionais da frota: considere a visibilidade do repositório antes de compartilhar artefatos.
- Telegram opcional usa os secrets existentes e envia somente contagens de problemas. Não inclui saldo, nomes de aeronaves, URLs autenticadas ou logs. Não foi enviado Telegram nesta entrega.
- Os relatórios gerados pelos testes são apagados antes da coleta autenticada para não confundir dados simulados com dados reais.
- `npm ci`, `npm run typecheck`, `npx playwright install chromium`, `npm test`: validação local com fixtures, sem credenciais ou chamadas ao jogo.
- `npm run bot`: **não executar para testar cálculos**; acessa a conta. No padrão, faz somente leitura/simulação. Configurar credenciais via ambiente apenas no executor autorizado.
- `validate.yml` executa somente compilação e fixtures em PR/push. Não recebe secrets do jogo.
- `playwright.yml` continua exclusivamente `workflow_dispatch`, sem schedule/push/PR para operações. O corpo usado pelo cron-job.org permanece compatível.

## Critérios antes de ativação real

1. Rever o relatório de um ciclo somente de leitura executado no GitHub Actions e confirmar total de rotas, IDs, capacidade e demanda.
2. Confirmar sentido/compartilhamento da demanda e comportamento na renovação usando observação autorizada.
3. Implementar executor individual com autorização explícita, releitura fresca e confirmação inequívoca do resultado, sem fallback para `departAll`.
4. Resolver mudanças de interface/idioma e limitações observadas; não declarar operação real validada só pelos testes de fixtures.

Esta entrega é uma base validada localmente em simulação, **não uma integração operacional concluída**.

## Validação desta entrega

- `npm run typecheck`: aprovado (TypeScript 5.9.3, `--noEmit`). Foi necessário incluir as bibliotecas DOM no tsconfig e tipar o mapa de menus legado.
- `npm test`: 58 testes aprovados, incluindo 10 testes de leitor/integração em Chromium local, sem rede do jogo.
- Cenários: demanda plena/parcial/zero; múltiplas classes; ausência de assentos em classes; compartilhamento e reservas; demanda renovada; dados inválidos/expirados; duplicidades; paginação; identidade incorreta; falhas de carregamento; bloqueio de concorrência; resumo Telegram sem envio; nenhum clique de mutação na simulação.
- YAML: validado; workflow operacional mantém apenas `workflow_dispatch`, mesmo grupo de concorrência e sem novo agendamento.
- `git diff --check`: aprovado.
- Não executado: bot autenticado no runner nem decolagem real. A evidência do jogo vem da inspeção manual assistida no navegador Work; as verificações automatizadas do leitor usam fixtures locais.

## Arquivos

Criados: `demand/types.ts`, `demand/config.ts`, `demand/manager.ts`, `demand/parsing.ts`, `demand/reader.ts`, `demand/report.ts`, `demand/run.ts`, `utils/run-lock.ts`, `tests/unit/demand.spec.ts`, `tests/unit/reader.spec.ts`, `playwright.unit.config.ts`, `scripts/telegram-demand.cjs`, `.github/workflows/validate.yml` e este documento.

Modificados: `utils/fleet.utils.ts`, `tests/airlineManager.spec.ts`, `.github/workflows/playwright.yml`, `playwright.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `.gitignore`, `AUTOMACAO.md` e `README.md`.

`utils/general.utils.ts` foi inspecionado; o login existente foi reutilizado sem alteração. Os módulos financeiros não foram modificados nem executados.

## Extensão: rotas e tarifas

A atualização posterior acrescenta a proposta de tarifas e o motor de revisão de rotas documentados em [ROUTES_AND_PRICING.md](ROUTES_AND_PRICING.md). As novas propostas também são exclusivamente simuladas; dados ausentes de base/retorno/candidatos bloqueiam a revisão da rota.
