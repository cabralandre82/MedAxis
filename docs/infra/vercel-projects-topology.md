# Topologia dos projetos Vercel

> **Status:** Vivo (atualizado em 2026-04-19, após reconciliação de envs).
> **Owner:** Plataforma + DPO.

## TL;DR

O domínio público `clinipharma.com.br` (clientes reais) e o domínio interno
`b2b-med-platform.vercel.app` (uso operacional + base do staging) são servidos
por **dois projetos Vercel distintos**, ambos buildando o **mesmo branch
`main`** do mesmo repo Git. Não é uma relação prod ↔ stage; é **prod ↔ prod
paralela**. O staging real fica num **terceiro target**: o branch `staging` do
projeto `b2b-med-platform` (Vercel "Preview" + Supabase de staging).

```
                                 ┌─────────────────────────────────────────┐
   github.com/.../main           │ Vercel project: clinipharma             │
   ─────────────► branch main ──►│ Domain: clinipharma.com.br (clientes)   │
                                 │ Supabase prod (jomdntq…)                │
                                 └─────────────────────────────────────────┘
                       │
                       │ mesmo commit, dois builds
                       ▼
                                 ┌─────────────────────────────────────────┐
                                 │ Vercel project: b2b-med-platform        │
                                 │ Domain: b2b-med-platform.vercel.app     │
                                 │ Supabase prod (jomdntq…)                │
                                 │                                         │
                                 │ + branch staging ──► Preview deploy     │
                                 │   Domain: b2b-med-platform-git-staging… │
                                 │   Supabase staging (ghjexiy…)           │
                                 └─────────────────────────────────────────┘
```

## Por que dois projetos servindo o mesmo `main`?

Histórico: o domínio `clinipharma.com.br` foi conectado ao projeto `clinipharma`
antes do projeto `b2b-med-platform` existir. Quando o repo migrou de nome, o
projeto novo foi criado pra refletir o novo nome do repo, mas o domínio nunca
foi reapontado. Os dois projetos seguiram em paralelo, e as envs novas (Sentry,
Upstash, Zenvia) foram adicionadas só no novo, gerando drift silencioso.

## Drift detectado em 2026-04-19

Antes da reconciliação, o projeto `clinipharma` (= produção real do
`clinipharma.com.br`) **não tinha** as seguintes envs, que existem no projeto
`b2b-med-platform`:

| Env                            | Impacto da ausência em prod real                                            |
| ------------------------------ | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN`       | Sentry desativado (client + server). Erros não capturados.                  |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Source maps não associados a release no Sentry.                             |
| `UPSTASH_REDIS_REST_URL`       | Rate-limit cai pra in-memory (`lib/rate-limit.ts:201`). Sem persistência    |
| `UPSTASH_REDIS_REST_TOKEN`     | entre lambdas e sem proteção real contra abuso distribuído.                 |
| `ZENVIA_API_TOKEN`             | **Crítico**: SMS/WhatsApp silenciosamente desabilitados                     |
| `ZENVIA_SMS_FROM`              | (`lib/zenvia.ts:40` apenas loga `warn` e pula). Clientes reais não recebiam |
| `ZENVIA_WHATSAPP_FROM`         | nada. Twilio/Evolution não voltam — foram removidos do código.              |
| `OPENAI_API_KEY`               | Funcionalidades de IA (OCR, classificação, document review) silenciosas.    |
| `CLINIPHARMA_REP_EMAIL`        | E-mails de contato/representante saíam vazios ou com fallback.              |

`SENTRY_AUTH_TOKEN` ficou de fora porque está vazia também em
`b2b-med-platform` (token foi rotacionado e removido por engano; rotação está
no backlog do runbook `secret-rotation.md`).

## Reconciliação executada em 2026-04-19

```
POST /v10/projects/clinipharma/env  (10 envs, target=production+preview)
- Tipos preservados (encrypted/plain) iguais aos do projeto fonte.
- Após upsert: redeploy production forçado (forceNew=1).
- Build OK; CSP report-only correta; connect-src passou a incluir
  o endpoint do Sentry automaticamente; /api/health=200.
```

Ferramenta usada: Vercel REST API (`v10/projects/{id}/env` + `v13/deployments`),
não a CLI, por causa do prompt interativo de branch que `vercel env add`
exige em targets `preview`.

## Recomendações futuras

1. **Médio prazo (recomendado):** mover o domínio `clinipharma.com.br` para o
   projeto `b2b-med-platform` e arquivar o projeto `clinipharma`. Isso elimina
   a possibilidade de drift voltar a aparecer. Janela: ~5 min de potencial
   propagação DNS; passo a passo no Vercel: `Settings → Domains → Transfer to
another project`.
2. **Curto prazo (até a migração):** qualquer env nova adicionada ao projeto
   `b2b-med-platform` precisa ser replicada manualmente para `clinipharma`. O
   PR template tem checklist; o processo ainda não é automático.
3. **Idealmente:** adicionar workflow de CI que faça `vercel env ls` em ambos
   os projetos e quebre se a interseção das chaves divergir. Issue tracker
   referenciar `docs/infra/vercel-projects-topology.md`.

## Comandos úteis

```bash
# Listar envs (chaves apenas, sem decryptar) de cada projeto
curl -sS "https://api.vercel.com/v10/projects/clinipharma/env?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | jq -r '.envs[] | "\(.key) \(.target | join(",")) \(.gitBranch // "")"' | sort

curl -sS "https://api.vercel.com/v10/projects/b2b-med-platform/env?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | jq -r '.envs[] | "\(.key) \(.target | join(",")) \(.gitBranch // "")"' | sort

# Diff rápido das chaves (deve sair vazio em prod target):
diff \
  <(curl ... clinipharma | jq -r '.envs[] | select(.target | contains(["production"])) | .key' | sort -u) \
  <(curl ... b2b-med-platform | jq -r '.envs[] | select(.target | contains(["production"])) | .key' | sort -u)

# Pull decryptado pra debug local (cuidado: gera arquivo em claro)
cd /tmp && mkdir vercel-pull && cd vercel-pull
vercel link --yes --project clinipharma --scope cabralandre-3009s-projects --token "$VERCEL_TOKEN"
vercel env pull .env.prod --environment production --token "$VERCEL_TOKEN"
# … inspecionar …
rm -rf /tmp/vercel-pull   # IMPORTANTE: não deixar valores claros em disco
```

## Referências

- Token e workflow do agente: [`AGENTS.md`](../../AGENTS.md)
- CSP report-only ativo: [`docs/security/csp.md`](../security/csp.md)
- Runbook de rotação: [`docs/runbooks/secret-rotation.md`](../runbooks/secret-rotation.md)
- Manifest de segredos: [`docs/security/secrets-manifest.json`](../security/secrets-manifest.json)
