# Cost Guard

| Field      | Value                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| Owner      | Solo operator                                                           |
| Workflow   | `.github/workflows/cost-guard.yml`                                      |
| Cadence    | Monday 11:00 UTC + manual                                               |
| Pairs with | `docs/SOLO_OPERATOR.md` §2 (weekly ritual), `docs/operations/budget.md` |
| Atualizado | 2026-04-19                                                              |

## Por que existe

Ferramentas cloud + agentes de IA + free tiers generosos = uma bill
pode 10× de uma semana para a outra sem sinal nenhum além da fatura.
Eu, solo operador, não consigo confiar só na intuição ("ah, o Vercel
não deve estar caro") — preciso de um **forcing function** que abra
uma issue que eu não posso ignorar todo domingo.

## O que o workflow faz hoje

1. Segunda 11:00 UTC (08:00 BRT) abre issue `Cost review — week of YYYY-MM-DD`
   com label `cost-review, operations`.
2. Issue tem checklist de todos os vendors + espaço para preencher MTD
   - red flags pré-pensadas.
3. Se a issue da semana anterior ainda estiver aberta → comenta
   "ainda pendente", não abre duplicata.
4. Operador (humano) preenche durante o ritual semanal, fecha,
   atualiza `docs/operations/budget.md`.

Isso é um **1/2 automatizado** intencional. Um alerta fully automated
que nunca disparou porque ninguém ajustou o threshold vale MENOS que
um lembrete semanal inescapável.

## Vendors monitorados

| Vendor             | Dashboard                                                         | Tier hoje                   | Ceiling de preocupação |
| ------------------ | ----------------------------------------------------------------- | --------------------------- | ---------------------- |
| Vercel             | https://vercel.com/cabralandre-3009/clinipharma/usage             | Pro                         | > $80/mês              |
| Supabase           | https://supabase.com/dashboard/project/jomdntqlgrupvhrqoyai/usage | Free → Pro quando MAU > 50k | > $50/mês              |
| Upstash Redis      | https://console.upstash.com/redis                                 | Pay-as-you-go               | > 1M req/mês           |
| Sentry             | https://sentry.io/organizations/.../usage/                        | Team                        | > quota de events      |
| Resend             | https://resend.com/emails                                         | Free tier                   | > 3000 email/mês       |
| Asaas              | https://www.asaas.com/                                            | Transacional                | — (taxa por transação) |
| OpenAI / Anthropic | https://platform.openai.com/usage                                 | Pay-as-you-go               | > $30/semana           |
| Cloudflare / DNS   | https://dash.cloudflare.com/                                      | Free                        | —                      |

## Thresholds (ainda manual, regras de bolso)

Ainda não temos integração automática; portanto estes thresholds vivem
na sua cabeça e neste documento (revisar trimestralmente):

- **Vercel**: > 150% da média dos 3 meses anteriores = investigar.
- **Supabase DB size**: > 500 MB de crescimento por semana = checar
  retention policy e tabelas em crescimento anormal (`pg_total_relation_size`).
- **Upstash req**: > 200k req/dia por ≥ 2 dias = cron mal comportado.
- **Sentry events**: > 50k/dia = loop de erro em produção.
- **AI tokens**: > $30/semana = conversar com si mesmo sobre o que
  está consumindo (provável que um agente rodou sem WIP=1).

## Roadmap — automação total

Quando as credenciais abaixo estiverem provisionadas como GitHub
Secrets, os jobs comentados em `cost-guard.yml` podem ser ativados
para popular a issue automaticamente em vez de deixá-la em branco.

| Secret                                        | Como obter                                      | API                                                                                                          |
| --------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `VERCEL_API_TOKEN`                            | Já existe como `VERCEL_TOKEN` localmente        | [Vercel REST API — Usage](https://vercel.com/docs/rest-api/endpoints#get-team-usage)                         |
| `VERCEL_TEAM_ID`                              | `team_fccKc8W6hyQmvCcZAGCqV1UK` (de AGENTS.md)  | n/a                                                                                                          |
| `SUPABASE_ACCESS_TOKEN`                       | `https://supabase.com/dashboard/account/tokens` | [Supabase Management API](https://api.supabase.com/api/v1) — `/v1/projects/{ref}/usage`                      |
| `SUPABASE_PROJECT_REF`                        | `jomdntqlgrupvhrqoyai`                          | n/a                                                                                                          |
| `UPSTASH_MGMT_EMAIL` + `UPSTASH_MGMT_API_KEY` | `https://console.upstash.com/account/api`       | [Upstash Mgmt API](https://developer.upstash.com/) — `/v2/stats/*`                                           |
| `SENTRY_AUTH_TOKEN`                           | Já existe                                       | [Sentry API — Stats](https://docs.sentry.io/api/organizations/retrieve-event-counts-for-an-organization-v2/) |

Ordem de prioridade para automatizar (alto → baixo):

1. Vercel (maior variação potencial, token já existe)
2. Sentry (token já existe, detectar spike de erros cedo)
3. Supabase (segundo maior custo recorrente)
4. Upstash + Asaas + Resend + AI tokens (lowest first, quando eu tiver tempo)

## Orçamento baseline (primeira linha do budget.md)

A primeira entrega do workflow será a criação de
`docs/operations/budget.md` na primeira execução do ritual. Template:

```md
# Platform budget

| Month   | Vercel | Supabase | Upstash | Sentry | Resend | AI  | DNS | Asaas | Total |
| ------- | ------ | -------- | ------- | ------ | ------ | --- | --- | ----- | ----- |
| 2026-04 |        |          |         |        |        |     |     |       |       |
```

## Anti-patterns

- **NÃO desabilite este workflow** mesmo em semanas tranquilas. O valor
  dele é o ritual, não o output. Se está indo bem, 3 min para confirmar.
- **NÃO deixe issues abertas acumularem** sem fechamento. Se você
  chegar a 2 abertas simultâneas, pause e faça as duas.
- **NÃO suba thresholds "pra parar de reclamar"**. Investigue a fonte
  primeiro; só suba threshold depois de entender por quê.

## Changelog

| Data       | Mudança                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 2026-04-19 | Workflow criado. Issue-based forcing function. Stubs de automação documentados para quando secrets forem provisionados. |
