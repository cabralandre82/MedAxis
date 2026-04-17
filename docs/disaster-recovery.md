# Clinipharma — Plano de Disaster Recovery (DR)

**Versão:** 1.0 | **Data:** 2026-04-08
**RTO Target:** < 4 horas | **RPO Target:** < 1 hora

---

## 1. Contatos de Emergência e Escalation

| Papel                                  | Nome         | Contato                                  |
| -------------------------------------- | ------------ | ---------------------------------------- |
| **Proprietário / Responsável técnico** | André Cabral | cabralandre@yahoo.com.br                 |
| **Supabase Support**                   | —            | https://supabase.com/dashboard → Support |
| **Vercel Support**                     | —            | https://vercel.com/help                  |
| **Cloudflare Support**                 | —            | https://dash.cloudflare.com → Support    |
| **Sentry (monitoramento)**             | —            | https://clinipharma.sentry.io            |

### Escalation

```
Incidente detectado
  → Verificar /api/health e Sentry (alertas automáticos)
  → Se DB: Contato Supabase Support
  → Se deploy: Contato Vercel Support
  → Se DNS/CDN: Contato Cloudflare Support
  → Comunicar usuários afetados por e-mail se downtime > 30min
```

---

## 2. Cenários de Desastre e Procedimentos

### 2.1 Falha de Banco de Dados (Supabase)

**Sintomas:** Erros 500 em todas as rotas, `/api/health` retorna `degraded`, logs Sentry com erros de conexão.

**Procedimento:**

```bash
# 1. Verificar status do Supabase
# https://status.supabase.com

# 2. Se Supabase está fora — aguardar restauração (SLA Supabase: 99.9%)
#    Não há ação manual necessária para incidentes na infraestrutura deles

# 3. Se corrupção de dados — restore de backup
# Supabase faz backup automático: Point-in-Time Recovery (PITR) no plano Pro
# https://supabase.com/dashboard → Project → Database → Backups

# 4. Para restaurar para um ponto específico:
# No painel Supabase: Settings → Backups → Restore to point in time
# Selecionar timestamp anterior ao incidente
# Confirmar restore (levará ~15-30 min para DBs < 10GB)

# 5. Após restore — verificar integridade:
cd /home/usuario/b2b-med-platform
npx supabase db push  # reaplicar migrations se necessário
```

**RTO estimado:** 30min–2h (depende do tamanho do backup)
**RPO:** até 1h (backup automático a cada 1h no plano Pro)

---

### 2.2 Falha de Deploy / Aplicação (Vercel)

**Sintomas:** Site fora do ar, 404 em todas as páginas, build com erro.

**Procedimento:**

```bash
# 1. Verificar status do Vercel
# https://www.vercel-status.com

# 2. Rollback para o último deploy bem-sucedido
# Opção A: Via painel Vercel (recomendado)
#   Vercel Dashboard → Deployments → Encontrar último "Ready" → Promote to Production

# Opção B: Via CLI (usar seu VERCEL_TOKEN pessoal — não commitar)
# Listar deployments:
#   curl -H "Authorization: Bearer <SEU_TOKEN>" \
#     "https://api.vercel.com/v6/deployments?projectId=prj_lCo2gBNmVk8ufDhtAROjQEp61wFB&limit=5"
#
# Promover deployment:
#   curl -X PATCH -H "Authorization: Bearer <SEU_TOKEN>" \
#     "https://api.vercel.com/v1/deployments/<DEPLOYMENT_ID>/promote"

# 3. Se o problema for no código — criar hotfix no branch main e fazer push
cd /home/usuario/b2b-med-platform
git checkout main
git pull
# ... corrigir ...
git add . && git commit -m "hotfix: <descrição>"
git push  # trigger deploy automático no Vercel
```

**RTO estimado:** 5–15 minutos (rollback) / 30–60 minutos (hotfix)

---

### 2.3 Comprometimento de Credenciais / Ataque

**Sintomas:** Atividade suspeita nos logs de auditoria, Sentry com acessos anormais.

**Procedimento imediato (< 15 minutos):**

```bash
# 1. REVOGAR TOKEN VERCEL COMPROMETIDO
# Vercel Dashboard → Settings → Tokens → Revogar token ativo
# Gerar novo token e atualizar nos serviços

# 2. REVOGAR CHAVES SUPABASE
# Supabase Dashboard → Settings → API → Rotate keys
# Atualizar SUPABASE_SERVICE_ROLE_KEY e SUPABASE_ANON_KEY no Vercel

# 3. REVOGAR SESSÕES DE TODOS OS USUÁRIOS (se vazamento de JWT)
# Executar via API:
curl -X POST https://clinipharma.com.br/api/admin/users/revoke-all \
  -H "Authorization: Bearer <super_admin_token>"

# 4. NOTIFICAR USUÁRIOS por e-mail explicando o incidente
# (obrigação LGPD Art. 48 — notificar ANPD e titulares em até 72h)

# 5. Preservar logs para investigação forense (não deletar nada)
```

---

### 2.4 Perda de Variáveis de Ambiente

**Procedimento:**

Todas as variáveis de ambiente críticas estão documentadas em `docs/go-live-checklist.md` (valores sensíveis NÃO commitados — recuperar de fonte segura).

```bash
# Reconfigurar variáveis no Vercel via API ou painel
# Ver: docs/go-live-checklist.md seção "Variáveis de Ambiente"
```

---

## 3. Checklist de Validação Pós-Restore

Executar após qualquer restore de banco ou redeploy de emergência:

```bash
# 1. Verificar health endpoint
curl https://clinipharma.com.br/api/health

# 2. Verificar autenticação (login manual)
# Entrar em https://clinipharma.com.br/login com conta admin

# 3. Verificar listagem de pedidos
# /admin/orders deve carregar sem erro

# 4. Verificar integrações externas
# /api/health deve mostrar todos os circuits CLOSED

# 5. Verificar envio de e-mail (teste de senha)
# Solicitar reset de senha para cabralandre@yahoo.com.br

# 6. Verificar Sentry (sem novos erros após restore)
# https://clinipharma.sentry.io

# 7. Fazer 1 pedido de teste de ponta a ponta em produção
# (cancelar imediatamente após confirmar funcionamento)
```

---

## 4. Simulação de DR

**Frequência recomendada:** Semestral

```bash
# Procedimento de simulação (CONTRA STAGING — nunca produção):
# 1. Restaurar backup de staging para um ponto 2h atrás
# 2. Medir tempo até plataforma voltar ao ar (RTO real)
# 3. Verificar dados mais recentes perdidos (RPO real)
# 4. Documentar resultados neste arquivo
```

### Simulação 1 — 2026-04-17 (André Cabral)

**Método:** Cronometragem de reaplicação de todas as 43 migrations contra o DB de produção
(simulação controlada — migrations são idempotentes com `IF NOT EXISTS`, sem perda de dados)

**Ambiente:** Production (`jomdntqlgrupvhrqoyai`) — região East US (North Virginia)

**Resultados medidos:**

| Fase                   | Descrição                                      | Tempo Medido        |
| ---------------------- | ---------------------------------------------- | ------------------- |
| Schema restore         | Reaplicar 43 migrations completas              | **141s (2min 21s)** |
| Data restore           | Estimativa Supabase para backup físico < 10 GB | ~15–20 min          |
| Vercel redeploy        | Deploy automático ao push (histórico)          | ~2–3 min            |
| Validação pós-restore  | `/api/health` + login + listagem pedidos       | ~5 min              |
| **RTO TOTAL ESTIMADO** | **Schema + dados + deploy + validação**        | **~25–30 min**      |

**RPO (dados máximos que podem ser perdidos):**

| Plano Supabase | Frequência de backup              | RPO máximo     |
| -------------- | --------------------------------- | -------------- |
| Pro (atual)    | Físico diário às 09:47 UTC        | **~24 horas**  |
| Pro + PITR     | Contínuo (Point-in-Time Recovery) | **~5 minutos** |

**Backups disponíveis em produção (verificado 2026-04-17):**

```
2026-04-17 09:49:04 UTC  PHYSICAL  COMPLETED
2026-04-16 09:49:03 UTC  PHYSICAL  COMPLETED
2026-04-15 09:47:32 UTC  PHYSICAL  COMPLETED
2026-04-14 09:47:31 UTC  PHYSICAL  COMPLETED
2026-04-13 09:46:56 UTC  PHYSICAL  COMPLETED
2026-04-12 09:48:26 UTC  PHYSICAL  COMPLETED
2026-04-11 09:44:02 UTC  PHYSICAL  COMPLETED
2026-04-10 09:48:53 UTC  PHYSICAL  COMPLETED
```

**Conclusão:**

- ✅ **RTO: ~25–30 min** — dentro do target de 4 horas
- ⚠️ **RPO: ~24h** — abaixo do target de 1 hora (requer PITR para atingir target)
- 📋 **Ação recomendada:** Ativar PITR no painel Supabase (Pro plan já inclui — requer habilitação manual em `Settings → Backups → Enable PITR`)

| Data       | RTO Medido | RPO Medido           | Executado por | Resultado                                        |
| ---------- | ---------- | -------------------- | ------------- | ------------------------------------------------ |
| 2026-04-17 | ~25–30 min | ~24h (backup diário) | André Cabral  | ✅ RTO OK · ⚠️ RPO acima do target — ativar PITR |

---

## 5. Backups

| Dado                      | Onde                                                  | Frequência                    | Retenção                    |
| ------------------------- | ----------------------------------------------------- | ----------------------------- | --------------------------- |
| Banco de dados (Supabase) | Supabase managed                                      | Automático a cada 1h          | 7 dias (free) / PITR (Pro)  |
| **DB offsite**            | **Cloudflare R2 (bucket `clinipharma-offsite`)**      | **Semanal (domingo 04h BRT)** | **12 semanais + 6 mensais** |
| **Storage offsite**       | **R2 `clinipharma-offsite/weekly/.../storage-*.tgz`** | **Semanal**                   | **12 semanais + 6 mensais** |
| Código-fonte              | GitHub (`clinipharma`)                                | A cada push                   | Ilimitado                   |
| Variáveis de ambiente     | Documentado em go-live-checklist.md                   | Manual                        | —                           |

### Backup offsite (Cloudflare R2 + age cipher)

**Configurado na Wave 0.4 da auditoria 2026-04.**

- Workflow: `.github/workflows/offsite-backup.yml` — roda toda madrugada de domingo (04h BRT) ou por dispatch manual antes de mudanças de alto risco.
- Cipher: `age` com recipient guardado **offline** pelo fundador. Só com a identidade privada em `AGE_PRIVATE_KEY` o dump decripta.
- Buckets cobertos no Storage: `contracts`, `order-documents` (críticos para fiscalização e disputas; `product-images` é reconstrutível).
- Manifest com `sha256sum` incluso em cada snapshot.

**Restore drill:** `.github/workflows/restore-drill.yml` roda dia 1 de cada mês e:

1. Lista o snapshot mais recente em R2.
2. Decripta com `AGE_PRIVATE_KEY`.
3. Valida `sha256` de cada arquivo.
4. Restaura o `pg_dump` em Postgres 16 efêmero do runner.
5. Roda queries de integridade (counts em `auth.users`, `orders`, `payments`, `audit_logs`).
6. Valida header do tarball de Storage (restore completo é exercitado em staging trimestralmente).
7. Reporta duração do restore (RTO real) no `GITHUB_STEP_SUMMARY`.
8. Notifica Slack (`SLACK_WEBHOOK_OPS`) em sucesso e **alerta em falha**.

### Secrets necessários no repositório (uma vez)

| Secret                  | Finalidade                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `SUPABASE_DB_URL`       | Postgres URL com senha para `pg_dump`                               |
| `SUPABASE_ACCESS_TOKEN` | Personal access token para download do Storage                      |
| `SUPABASE_PROJECT_REF`  | `jomdntqlgrupvhrqoyai`                                              |
| `AGE_PUBLIC_KEY`        | Recipient `age1...` para cifrar backups                             |
| `AGE_PRIVATE_KEY`       | Identidade `AGE-SECRET-KEY-1...` — **usar apenas no restore drill** |
| `R2_ACCOUNT_ID`         | Cloudflare R2 account id                                            |
| `R2_ACCESS_KEY_ID`      | S3-compatível                                                       |
| `R2_SECRET_ACCESS_KEY`  | S3-compatível                                                       |
| `R2_BUCKET`             | `clinipharma-offsite`                                               |
| `SLACK_WEBHOOK_OPS`     | Webhook para canal `#ops-alerts` (opcional)                         |

### Lifecycle no bucket R2

Configurar no dashboard Cloudflare: regras de retenção por prefixo.

- `weekly/` → remover após 84 dias (12 semanas).
- `monthly/` → remover após 180 dias (6 meses).
- `manual/` → nunca remover automaticamente (operador decide).

### Ações recomendadas (além do offsite)

1. **⏳ Ativar PITR — adiar até ter clientes reais ativos**
   - Custo: $100/mês (7 dias) · $200/mês (14 dias) · $400/mês (28 dias)
   - Recomendação: **7 dias** é suficiente, assim que houver pedidos e pagamentos reais em produção
   - Como ativar: `Supabase Dashboard → Project clinipharma → Settings → Add-ons → Point in Time Recovery`

2. **Testar restore em staging manualmente** a cada trimestre — o drill automatizado garante decriptação e estrutura; o teste manual valida Storage completo em uma instância Supabase real.

---

_Este plano deve ser revisado após cada incidente real e a cada 6 meses._
