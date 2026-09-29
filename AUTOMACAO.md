# Operacao automatica do Airline Manager 4

## Situacao

- A execucao e iniciada manualmente pela aba **Actions** ou pela API `workflow_dispatch` utilizada no **cron-job.org**.
- O arquivo `.github/workflows/playwright.yml` **nao possui agendamento interno**. Assim, nao ha dois agendadores solicitando execucoes.
- O GitHub Actions possui `concurrency` para evitar duas execucoes **simultaneas** do workflow. Chamadas adicionais podem ficar pendentes; nao se deve interpretar o agendamento externo como execucao garantida em horario exato.
- O jogo precisa estar em **ingles**, pois os seletores Playwright dependem dos rotulos em ingles.

## Seguranca

Cadastre os seguintes **Secrets** em **Settings > Secrets and variables > Actions**:
- `EMAIL`: login web do Airline Manager 4.
- `PASSWORD`: senha web do jogo (nao a senha do Apple ID).
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`: opcionais, para notificacoes.

As credenciais do jogo sao encaminhadas por variaveis de ambiente ao job e nao sao gravadas em `.env` no GitHub Actions. Nao inclua tokens ou senhas nos arquivos do repositorio.

## Variaveis de operacao

Em **Settings > Secrets and variables > Actions > Variables**:

| Variavel | Exemplo | Funcao |
| --- | --- | --- |
| `MAX_FUEL_PRICE` | `550` | Limite de compra normal de combustivel |
| `MAX_CO2_PRICE` | `120` | Limite de compra normal de CO2 |
| `REPAIR_WEAR` | `30` | Percentual usado nas reparacoes |
| `HOURS_CHECK` | `20` | Limite de horas da verificacao de aeronaves |
| `INCREASE_AIRLINE_REPUTATION` | `true` | Habilita campanha de reputacao |
| `CAMPAIGN_TYPE` | `1` | Tipo de campanha |
| `CAMPAIGN_DURATION` | `4` | Duracao da campanha |
| `ENABLE_FUEL` | `true` | Habilita combustivel e CO2 |
| `ENABLE_MAINTENANCE` | `true` | Habilita manutencao e A-Check |
| `ENABLE_CAMPAIGN` | `true` | Habilita campanhas |
| `ENABLE_DEPART` | `true` | Habilita decolagens |
| `ALERT_CASH_ABOVE` | `5000000` | Alerta opcional por Telegram se o saldo detectado for igual/maior |

Variaveis `ENABLE_*` omitidas equivalem a `true`, preservando o comportamento anterior. Coloque `false` para desligar algum modulo. O alerta de saldo so funciona se houver Telegram configurado e o modulo de combustivel conseguir registrar o saldo. Ele nao dispara sozinho fora dos ciclos do bot.

**Atencao:** o algoritmo original tambem permite compras emergenciais por limites fixos, separados de `MAX_FUEL_PRICE` e `MAX_CO2_PRICE`. Revise antes de usar com uma companhia com pouco saldo.

## Agendador externo

Configure cron-job.org:
- Metodo: `POST`
- URL: `https://api.github.com/repos/andreypiekas/Airline-Manager-4/actions/workflows/playwright.yml/dispatches`
- Headers: `Authorization: Bearer <SEU_TOKEN>`, `Accept: application/vnd.github+json`, `Content-Type: application/json`
- Body: `{"ref":"main","inputs":{"aktifkan_random_delay":"false","paksa_simpan_video":"false"}}`
- Intervalo desejado: 30 minutos.

Um HTTP 204 na API significa que o GitHub aceitou o pedido, e **nao** que todas as operacoes no jogo foram concluidas. Verifique a aba **Actions**.

## Diagnostico

Os relatorios do Playwright, prints de falhas e `test-results/bot.log` sao publicados como artefato `playwright-report`. Procure por `[Login]`, `[Operacao]` ou `[Depart]`.

O workflow tenta enviar uma mensagem no Telegram ao final, mas essa notificacao e opcional e erros de notificacao nao alteram o resultado do job. Um job verde nao prova, por si so, que todas as aeronaves sairam: confirme o resultado no jogo.

## Limites

Este repositorio ja automatiza as operacoes de combustivel/CO2, manutencao, campanhas e decolagens. Compra automatica de novas aeronaves, abertura de rotas, alteracao de precos e outras operacoes de investimento **nao foram habilitadas**: exigem seletores testados e limites financeiros especificos para evitar gastos irreversiveis.

Nao existe garantia de ausencia de banimento, disponibilidade 24h, sucesso de login ou horarios exatos de execucao. O uso do bot pode contrariar as regras do jogo.
