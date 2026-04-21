# Topologia dos projetos Vercel

> **Status:** Vivo. Última mudança: **2026-04-18** — rotação do
> `ZENVIA_API_TOKEN` em produção (SMS-only) e limpeza dos secrets Zenvia
> remanescentes no projeto em quarentena. Consolidação anterior em 2026-04-19
> (ver histórico abaixo).
> **Owner:** Plataforma + DPO.

## TL;DR (estado atual)

Existe **um único projeto Vercel ativo**: `clinipharma`. Ele serve:

- `clinipharma.com.br` ← branch `main` (produção, clientes reais)
- `staging.clinipharma.com.br` ← branch `staging` (Vercel Preview, Supabase de
  staging). DNS público desse subdomínio **não está configurado** ainda — o
  alias existe no Vercel, mas o registro CNAME no DNS público nunca foi criado.
  Acessível via `https://clinipharma-git-staging-cabralandre-3009s-projects.vercel.app`
  (com bypass de Deployment Protection).

```
                                 ┌─────────────────────────────────────────┐
   github.com/.../main           │ Vercel project: clinipharma             │
   ─────────────► branch main ──►│ Domain: clinipharma.com.br (clientes)   │
                                 │ Supabase prod (jomdntq…)                │
   ─────────────► branch staging ──► alias staging.clinipharma.com.br      │
                                 │ Supabase staging (ghjexiy…)             │
                                 └─────────────────────────────────────────┘

   Em quarentena (sem Git, congelado, mantido como backup até 2026-05-03):
                                 ┌─────────────────────────────────────────┐
                                 │ Vercel project: b2b-med-platform        │
                                 │ Domain: b2b-med-platform.vercel.app     │
                                 │ Git link: REMOVIDO                      │
                                 │ Secrets Zenvia: REMOVIDOS (2026-04-18)  │
                                 │ Crons: ainda agendados (mas dedup via   │
                                 │ Upstash lock — sem double execution)    │
                                 └─────────────────────────────────────────┘
```

## Como chegamos aqui (histórico)

1. **Origem (pré-2026-04-09):** projeto `clinipharma` foi criado primeiro,
   com o domínio `clinipharma.com.br` apontado pra ele. Era a única coisa
   servindo clientes.
2. **2026-04-17:** projeto `b2b-med-platform` foi criado (provavelmente
   resultado de um rename do repo). Vercel reconectou o repo a um nome novo,
   mas o domínio `clinipharma.com.br` permaneceu no projeto antigo.
3. **2026-04-17 → 2026-04-19:** waves de hardening (Sentry, Upstash, Zenvia
   substituindo Twilio/Evolution) foram aplicadas **só** em
   `b2b-med-platform`. O `clinipharma` (= produção real) ficou com:
   - Sentry desligado → erros não capturados.
   - Rate-limit em memória → sem proteção distribuída.
   - **SMS desabilitado** → clientes não recebiam confirmação de pedido,
     pagamento, despacho etc. O código (`lib/zenvia.ts`, `zenviaPost()`)
     só logava `warn` e seguia em frente.
   - OpenAI desligado → OCR e document-review silenciosamente desativados.
   - Cron jobs duplicados rodando sem coordenação (sem Redis lock).
4. **2026-04-19 (manhã):** drift detectado.
5. **2026-04-19 (tarde):** **reconciliação** — 10 envs de produção e 6 de
   staging copiadas pro `clinipharma`. Domain `staging.clinipharma.com.br`
   movido pro `clinipharma`. Projeto `b2b-med-platform` desconectado do Git
   (deploys automáticos parados). Documentado neste arquivo.
6. **2026-04-18 (noite, horário BRT):** **rotação Zenvia + kill-switch
   WhatsApp.** Onboarding Zenvia concluído (canal SMS aprovado com sender
   `Clinipharma`); WhatsApp fora de escopo no launch. Ações:
   - `clinipharma`: `ZENVIA_API_TOKEN` rotacionado (entrada recriada como
     `type=sensitive` para evitar o wrapper encrypted+`decrypt=true`
     retornar texto encapsulado em inspeções futuras). Nova env
     `WHATSAPP_ENABLED=false` criada nos três targets (production,
     preview, development). `ZENVIA_SMS_FROM` mantido em `Clinipharma`.
   - Código: `sendWhatsApp()` passa a ser no-op silencioso quando a
     flag está off (commit `eb6d028`). Produção verificada saudável após
     auto-deploy (200 em `/api/health`, DB OK).
   - `b2b-med-platform` (quarentena): removidas as 4 envs Zenvia
     remanescentes (2× `ZENVIA_API_TOKEN`, `ZENVIA_SMS_FROM`,
     `ZENVIA_WHATSAPP_FROM`) para não deixar credenciais antigas rotando
     em projeto dormente. Quarentena mantida até 2026-05-03 conforme
     plano — só as credenciais saíram, o projeto fica para forense.
7. **2026-04-18 (fim da noite, BRT):** **webhook de delivery-status
   Zenvia.** Primeiro smoke test de SMS (21 99885-1851) não chegou; a
   investigação revelou que a Zenvia v2 é webhook-only para status (não
   há `GET` de status por messageId) e nenhuma subscription estava
   configurada — produção ficava cega a qualquer falha de entrega.
   Ações:
   - Código: criado `app/api/notifications/zenvia/route.ts` com auth
     por `X-Clinipharma-Zenvia-Secret`, dedup via `webhook_events`
     (source=`zenvia`, key=`messageId:code:timestamp`), contador
     Prometheus `sms_status_event_total{channel,status}` e log
     estruturado em `module:webhooks/zenvia`. Rota adicionada às
     exceções de CSRF e `PUBLIC_ROUTES` do middleware — mesmas
     razões já aplicadas ao Asaas/Clicksign (commits `7991d52`,
     `b630376`, `1554cee`).
   - Vercel: gerado `ZENVIA_WEBHOOK_SECRET` (64 chars hex,
     `openssl rand -hex 32`), setado como `type=sensitive` em
     production + preview. `development` ignorado (Vercel não
     permite sensitive em dev — aceitável pois webhook é público).
   - Zenvia portal: subscription criada via API
     (`POST /v2/subscriptions`) com `eventType=MESSAGE_STATUS`,
     `channel=sms`, status `ACTIVE`. ID da subscription:
     `c2a89116-9c2c-424d-81fd-8e94664924d9`. Se precisar deletar ou
     rotacionar o secret, é esse ID que vai no
     `DELETE /v2/subscriptions/{id}` ou
     `PATCH /v2/subscriptions/{id}`.
   - Validação: 6 chamadas sintéticas ao webhook em produção —
     401 sem header, 401 com header errado (constant-time),
     200 com header certo, 200+`duplicate:true` no replay, 200
     em nova transição (NOT_DELIVERED) do mesmo messageId.
     `webhook_events` ganhou 4 linhas (última id=4).
   - Follow-up não feito neste passo: tracking do
     `ZENVIA_WEBHOOK_SECRET` no manifest de rotação
     (migration 056 + `lib/secrets/manifest.ts`) — adiado para PR
     dedicado de rotação para não misturar diff de migração aqui.

## Por que `b2b-med-platform` ficou em quarentena (não deletado)

- Histórico de deploys e logs preservados para forense em caso de regressão.
- Reverter a inversão é trivial: re-linkar o repo, re-mover o subdomínio
  de staging, atualizar `.vercel/project.json`. ~2 minutos.
- **Crons ainda estão agendados** lá. Como o `clinipharma` agora também tem
  Upstash, o `lib/cron/guarded.ts` faz lock distribuído via Redis e cada
  job roda no máximo uma vez (independente de quantos projetos disparam).
  Risco de double execution = ~0.
- **Plano de remoção:** após 2 semanas de operação estável (= 2026-05-03),
  deletar o projeto `b2b-med-platform`. Update este doc.

## Inversão executada — registro técnico

| Passo                                                                    | Ferramenta                                                                                    | Resultado                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Copiar 10 envs production (Sentry, Upstash, Zenvia, OpenAI, repEmail) | `vercel env pull` + `POST /v10/projects/clinipharma/env`                                      | 10/10 OK; `ZENVIA_WHATSAPP_FROM` removida depois (WhatsApp não configurado ainda)                            |
| 2. Redeploy production do `clinipharma`                                  | `POST /v13/deployments?forceNew=1`                                                            | `dpl_EEZoxiesedo4wbb2G1rSvjzbSfHf` READY; CSP `connect-src` passou a incluir endpoint Sentry automaticamente |
| 3. Copiar 6 envs staging (Supabase staging + Asaas URL + bypass)         | mesmo método, com `gitBranch=staging`                                                         | 6/6 OK                                                                                                       |
| 4. Setar `buildCommand` e `installCommand` explícitos no `clinipharma`   | `PATCH /v9/projects/clinipharma`                                                              | OK                                                                                                           |
| 5. Mover `staging.clinipharma.com.br` entre projetos                     | `DELETE /v9/projects/b2b-med-platform/domains/...` + `POST /v10/projects/clinipharma/domains` | OK, `verified=true` imediato (Vercel não reverifica subdomínio dentro da mesma org)                          |
| 6. Deploy do branch `staging` no `clinipharma`                           | `POST /v13/deployments` com `gitSource.ref=staging`                                           | `dpl_8fBLAVGs9Gz3XzgbCgnnPoNJuUC9` READY; alias `staging.clinipharma.com.br` vinculado                       |
| 7. Desconectar Git do `b2b-med-platform`                                 | `DELETE /v9/projects/b2b-med-platform/link`                                                   | OK; deploys automáticos pausados                                                                             |

## O que **NÃO** foi feito (intencional ou pendente)

- **DNS público de `staging.clinipharma.com.br`** — não criado. Esse
  subdomínio nunca foi resolvível externamente (é uma config histórica
  fantasma). Quem quer abrir staging pra mais usuários precisa criar o
  CNAME apontando pro Vercel.
- **Bypass token de staging** — copiei a env `VERCEL_AUTOMATION_BYPASS_SECRET`
  do projeto antigo, mas o token bypass é configurado **por projeto** em
  Settings → Deployment Protection. Pra liberar acesso programático ao
  staging novo, ativar o bypass no projeto `clinipharma` (gera novo secret)
  e atualizar a env.
- **WhatsApp** — desligado por design no launch. Existe um kill-switch
  explícito: `WHATSAPP_ENABLED` (default `false`). O `sendWhatsApp()` em
  `lib/zenvia.ts` retorna silenciosamente sem log enquanto a flag estiver
  desligada (decisão registrada em 2026-04-18, após onboarding Zenvia
  concluído com canal SMS aprovado mas WhatsApp fora do escopo de
  lançamento). Para ligar depois: (1) verificar o número de WhatsApp
  Business na Meta Business Manager; (2) registrar o sender no portal
  Zenvia; (3) setar `WHATSAPP_ENABLED=true` + `ZENVIA_WHATSAPP_FROM` nos
  targets `production` e `preview`. Sem mudança de código.

## Conta de comandos para próximas vezes

```bash
# Vincular CLI ao projeto correto (clinipharma)
cd <repo>
vercel link --yes --project clinipharma --scope cabralandre-3009s-projects \
  --token "$VERCEL_TOKEN"

# Listar envs (chaves apenas)
curl -sS "https://api.vercel.com/v10/projects/clinipharma/env?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | jq -r '.envs[] | "\(.key)\t\(.target | join(","))\t\(.gitBranch // "")"' | sort

# Pull decryptado (CUIDADO: arquivo em claro em disco)
mkdir -p /tmp/vp && cd /tmp/vp
vercel link --yes --project clinipharma --scope cabralandre-3009s-projects --token "$VERCEL_TOKEN"
vercel env pull .env.prod    --environment production --token "$VERCEL_TOKEN"
vercel env pull .env.staging --environment preview --git-branch staging --token "$VERCEL_TOKEN"
# … inspecionar …
cd - && rm -rf /tmp/vp

# Forçar redeploy production
DEPLOY_ID=$(curl -sS "https://api.vercel.com/v6/deployments?teamId=$VERCEL_ORG_ID&projectId=clinipharma&target=production&limit=1&state=READY" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '.deployments[0].uid')
curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$VERCEL_ORG_ID&forceNew=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"clinipharma\",\"deploymentId\":\"$DEPLOY_ID\",\"target\":\"production\"}"

# Disparar build de uma branch específica (preview)
curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$VERCEL_ORG_ID&forceNew=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"clinipharma","gitSource":{"type":"github","ref":"staging","repoId":1205329895}}'
```

## Reverter a inversão (caso de emergência)

Se algo quebrar e precisar voltar ao estado pré-inversão:

```bash
# 1. Re-conectar Git ao b2b-med-platform
curl -sS -X POST "https://api.vercel.com/v13/projects/b2b-med-platform/link?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"github","repo":"cabralandre82/clinipharma","productionBranch":"main"}'

# 2. Mover staging subdomínio de volta
curl -sS -X DELETE "https://api.vercel.com/v9/projects/clinipharma/domains/staging.clinipharma.com.br?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN"
curl -sS -X POST "https://api.vercel.com/v10/projects/b2b-med-platform/domains?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"staging.clinipharma.com.br","gitBranch":"staging"}'

# 3. Atualizar local .vercel/project.json para apontar de volta
vercel link --yes --project b2b-med-platform --scope cabralandre-3009s-projects --token "$VERCEL_TOKEN"
```

Tempo total estimado: ~2min. Não toca nada em código nem DNS.

## Referências

- Token e workflow do agente: [`AGENTS.md`](../../AGENTS.md)
- CSP report-only ativo: [`docs/security/csp.md`](../security/csp.md)
- Runbook de rotação: [`docs/runbooks/secret-rotation.md`](../runbooks/secret-rotation.md)
- Manifest de segredos: [`docs/security/secrets-manifest.json`](../security/secrets-manifest.json)
- Cron lock distribuído: [`lib/cron/guarded.ts`](../../lib/cron/guarded.ts)
