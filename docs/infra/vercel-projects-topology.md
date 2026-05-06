# Topologia dos projetos Vercel

> **Status:** Vivo. Última mudança: **2026-05-06** — projeto Vercel
> `b2b-med-platform` (em quarentena desde 2026-04-19) **DELETADO** após
> 17 dias de janela de espera sem regressão. Quarentena planejada para
> 2026-05-03; deleção atrasou 3 dias sem impacto. Backup pre-delete
> salvo em `~/.config/agent/backups/b2b-med-platform_pre-delete_20260506.json`.
> Histórico completo abaixo (incluindo o incidente de 2026-05-02 dos
> crons fantasmas, motivo direto da decisão de deletar).
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

   Histórico (deletado 2026-05-06):
                                 ┌─────────────────────────────────────────┐
                                 │ Vercel project: b2b-med-platform        │
                                 │ Status: DELETED via API                 │
                                 │ HTTP 204 / GET subsequente → 404        │
                                 │ Backup pre-delete: ~/.config/agent/...  │
                                 └─────────────────────────────────────────┘
```

> **Aviso histórico — premissa errada (corrigida em 2026-05-02):** este
> diagrama afirmava por semanas que "Crons: ainda agendados (mas dedup via
> Upstash lock — sem double execution)". **Falso.** O `cron_try_lock` da
> migração 045 só protege contra execuções OVERLAPPING — duas invocações
> sequenciais separadas por 30-40s (que era o padrão real entre os dois
> projetos) acquire/release sem conflito, ambas como `status=success`. O
> bug ficou invisível porque os dois projetos usam o mesmo banco e o mesmo
> `cron_runs` ledger; ler "2 success" parecia normal. Diagnóstico final
> em 2026-05-02 mostrou que `b2b-med-platform` rodou 22 crons em paralelo
> ao `clinipharma` por ~13 dias, incluindo `verify-audit-chain`,
> `enforce-retention`, `money-reconcile` e `dsar-sla-check` — todos contra
> o mesmo banco de produção. Nenhuma corrupção observada (a chain está
> íntegra), mas era questão de tempo. Veja item 9 do histórico.

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
8. **2026-04-18 (madrugada, BRT):** **sender SMS corrigido — de
   `Clinipharma` para `cabralandre` (provisório).** Segundo e terceiro
   smoke tests de SMS com `from=Clinipharma` chegaram no webhook com
   `MESSAGE_STATUS=REJECTED` e `description="The message was rejected by
Zenvia"`. Causa diagnosticada via ticket Zenvia: o plano contratado
   (`Starter + Channel 1` / contrato `ZS_7XXGRYB`, aderência
   2026-04-17) **não tem sender alfanumérico customizado** — o `from`
   da API `/v2/channels/sms/messages` precisa ser o username da conta
   (`cabralandre`). O painel Zenvia (Customer Cloud) não expõe menu de
   senders pra esse plano, o que explica o porquê de não existir
   `Clinipharma` registrado mesmo com o canal SMS `ACTIVE`. Ações:
   - Vercel `clinipharma`: `ZENVIA_SMS_FROM` PATCHED de `Clinipharma`
     → `cabralandre` em `production` + `preview` (env id
     `v5LYzIuiIE0eNZfX`, permanece `type=plain` — sender não é secret).
     Redeploy disparado pelo push seguinte (commit deste doc + `.env.example`).
   - Código: **nenhuma mudança.** `lib/zenvia.ts` já lê
     `process.env.ZENVIA_SMS_FROM` em runtime — a troca é só de env.
   - Impacto no usuário final: SMS chegam identificados como
     `cabralandre` no campo "De". O **corpo** da mensagem continua
     assinado "Clinipharma" via templates de `SMS.*` — a marca ainda
     aparece pro cliente. É imperfeito (branding), não quebrado.
   - Follow-up pra quando fizer sentido (crescimento de volume ou
     feedback negativo de clientes): upgrade do plano Zenvia para tier
     com Messaging API + registro de sender alfanumérico "Clinipharma".
     Operação é: (1) ligar pra comercial Zenvia pedir o upgrade;
     (2) registrar "Clinipharma" como sender alfanumérico no portal;
     (3) PATCH de volta `ZENVIA_SMS_FROM=Clinipharma`. Sem mudança
     de código. Custo estimado: ~R$ 200–500/mês acima do Starter
     (confirmar com Zenvia na hora).
   - Custo de **não** fazer o upgrade agora: cliente ve `cabralandre`
     no "De" do SMS e pode achar estranho ou marcar como spam.
     Mitigação: primeira linha de todo template SMS começa com
     "[Clinipharma]" para ancorar a identidade da marca.
9. **2026-05-02 (manhã, BRT):** **neutralização dos crons fantasmas do
   quarentenado.** Operador notou no dashboard de logs (`/server-logs`)
   o par recorrente `[cron/rls-canary] canary failed to start` (error,
   `SUPABASE_JWT_SECRET is required`) + `RLS canary did not run` (warn,
   crítico) toda madrugada às 07:40 UTC. Investigação revelou padrão
   100% determinístico há ≥13 dias: para CADA cron rodando, o
   `cron_runs` ledger gravava 2 execuções `status=success` separadas
   por ~30-40s, com `locked_by` apontando para deployments distintos:
   `dpl_Df5n9H...` (clinipharma) e `dpl_5LvB7Ch...` (b2b-med-platform
   quarentenado). Diagnóstico final: o `vercel.json` do último deploy
   READY do projeto em quarentena lista os mesmos 22 crons, e o
   scheduler do Vercel respeita esse manifest mesmo sem Git conectado
   e sem `clinipharma.com.br` apontado. `cron_try_lock` (migração 045)
   NÃO previne isso porque execuções sequenciais com gap de 30s
   acquire/release sem se sobrepor. Plano executado:
   - **Verificação inicial**: confirmado via Vercel API que ambos
     projetos têm 22 crons no manifest, e ambos disparam o handler
     com `CRON_SECRET` válido. `rls_canary_log` íntegro (40 tabelas,
     0 violações no run mais recente — sistema RLS em si está OK).
   - **Mitigação 1 — `CRON_SECRET` removido do quarentenado**
     (`DELETE /v10/projects/.../env/Npem6Gd9JYzLmW5P`). Backup do
     valor salvo em `~/.config/agent/backups/`. Efeito esperado:
     próxima execução cold-start lê `process.env.CRON_SECRET=undefined`
     → `withCronGuard` retorna 401 antes de qualquer trabalho. Mas
     observou-se 12:14→12:20 UTC que `synthetic-probe` (5min cycle)
     CONTINUOU disparando duplo — o lambda warm tinha o secret
     cacheado em memória do boot original, e nunca esfriou.
   - **Mitigação 2 — deployment warm deletado**
     (`DELETE /v13/deployments/dpl_5LvB7ChCyFNJUb2sJt1ptKYRG4sY`).
     Vercel auto-promoveu `dpl_BKF9w5...` (de 19/04) como nova
     production do quarentenado — lambda **cold**. Próxima invocação
     do `synthetic-probe` (12:25:40 UTC) e a seguinte (12:30:40)
     mostraram apenas o clinipharma rodando, com Δ=300s (= 5min
     limpos, sem duplicata). Zero novos `server_logs` desde o fix.
   - **Sanity check**: `clinipharma` 100% intocado durante toda a
     operação. `CRON_SECRET` do projeto ativo continua presente
     (id=`Q3FfvlacuwQfRJUc`, target=production+preview+development).
     Os 36 outros deploys READY do quarentenado permanecem como
     backup forense até 2026-05-03 (data de expiração da quarentena).
   - **Lição estrutural**: nunca confiar em "dois projetos não dão
     problema porque o lock dedupa" — o lock só protege overlaps.
     Quarentena de projeto Vercel só é segura se: (a) sem Git,
     (b) sem `CRON_SECRET`, (c) sem deployments READY com
     `vercel.json` listando crons. As duas primeiras condições
     foram aplicadas; a terceira é resolvida pela quarentena
     expirar em 24h (deletar o projeto).
10. **2026-05-06 (tarde, BRT):** **deleção definitiva do projeto
    `b2b-med-platform`** após 17 dias de janela de espera (planejada
    para 2026-05-03, atrasou 3 dias sem impacto). Sequência:
    - **Auditoria pré-delete**: confirmado via API que o projeto não
      tinha (a) Git connect (`gitRepo: null`), (b) production deploy
      marcado (`productionDeployId: null`), (c) domínios custom (só
      o default `b2b-med-platform.vercel.app`). 53 envs presentes
      mas todas duplicatas das do `clinipharma` ATIVO **exceto uma**:
      `SENTRY_AUTH_TOKEN` que existia só no quarentenado. Investigação
      revelou que **o valor estava vazio** (`""` no `vercel env pull`)
      — bug pré-existente do script de update que salvava string
      vazia em vez do token real. Não havia o que recuperar; segue
      como follow-up provisionar novo token no Sentry dashboard e
      criar entrada no `clinipharma`.
    - **Snapshot de auditoria** salvo em
      `~/.config/agent/backups/b2b-med-platform_pre-delete_20260506.json`
      (chmod 600) — contém project metadata, lista de keys das envs
      (sem values), domains, últimos 10 deployments. Trilha forense
      para qualquer investigação futura.
    - **`DELETE /v9/projects/prj_AselTmZTlBpnArr0M7zP6GTmNJ16`** via
      Vercel API. HTTP 204. GET subsequente retorna 404 com
      `error.code=not_found`. Listagem da org agora mostra 4 projetos
      (clinipharma, instituto-nova-medida, omni-runner-portal,
      project-running) — `b2b-med-platform` desaparecido.
    - **`clinipharma` (ativo) intocado** durante toda a operação.
      `productionDeployId` = `dpl_H2zoGjuQdp6WkNQcPdSYSSqgF1W3` READY.
      Domínio `clinipharma.com.br` continua resolvendo. Os 22 crons
      continuam disparando exatamente uma vez por ciclo.
    - **Lição encerrada**: a quarentena cumpriu seu propósito (janela
      de espera para rollback de emergência) e foi liberada quando a
      janela passou sem necessidade. O follow-up dos crons fantasmas
      agora está fechado por completo — não existe mais um manifest
      `vercel.json` paralelo que possa ressuscitar invocações duplas.
    - **Follow-up gerado**: provisionar novo `SENTRY_AUTH_TOKEN` no
      `clinipharma` quando humano puder gerar um token org-scoped no
      Sentry dashboard. Sem isso, source maps não são uploaded em
      builds de prod desde 2026-04-19 (quando o projeto migrou). Não
      bloqueante — Sentry continua capturando erros, só que com
      stack traces minificados em vez de source-map-resolved.

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

> **Custo subiu de ~2min para ~30min depois de 2026-05-06.** O projeto
> `b2b-med-platform` foi deletado em 2026-05-06 (passo 10 do histórico).
> Reverter agora exige **recriar o projeto do zero** (incluindo as 38
> envs de production), porque os 17 dias da janela de espera passaram
> sem regressão e a Vercel API não restaura projetos deletados.

Se algo quebrar e precisar voltar ao estado "pré-inversão":

```bash
# 1. Recriar o projeto Vercel
curl -sS -X POST "https://api.vercel.com/v9/projects?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"b2b-med-platform","framework":"nextjs"}'

# 2. Re-conectar Git
curl -sS -X POST "https://api.vercel.com/v13/projects/b2b-med-platform/link?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"github","repo":"cabralandre82/clinipharma","productionBranch":"main"}'

# 3. Recriar 38 envs production (lista completa em
#    ~/.config/agent/backups/b2b-med-platform_pre-delete_20260506.json,
#    chave envs_keys[]). VALUES não estão no backup — extrair do
#    `clinipharma` (vercel env pull) e re-postar.

# 4. Mover staging subdomínio de volta (mesmo comando antigo)
# 5. vercel link local
```

Não foi tomado o caminho "manter o projeto e desabilitar via flag"
porque a quarentena já era essa configuração: 17 dias com Git off
e CRON_SECRET removido — única coisa que o projeto fazia era
ocupar slot e potencialmente disparar crons fantasmas (incidente
de 2026-05-02). Não havia caminho intermediário entre "vivo de
verdade" e "deletado".

## Referências

- Token e workflow do agente: [`AGENTS.md`](../../AGENTS.md)
- CSP report-only ativo: [`docs/security/csp.md`](../security/csp.md)
- Runbook de rotação: [`docs/runbooks/secret-rotation.md`](../runbooks/secret-rotation.md)
- Manifest de segredos: [`docs/security/secrets-manifest.json`](../security/secrets-manifest.json)
- Cron lock distribuído: [`lib/cron/guarded.ts`](../../lib/cron/guarded.ts)
