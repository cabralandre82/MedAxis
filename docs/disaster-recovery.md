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

# Última simulação: ⬜ NÃO REALIZADA — fazer assim que staging estiver provisionado
```

| Data | RTO Medido | RPO Medido | Executado por | Resultado |
| ---- | ---------- | ---------- | ------------- | --------- |
| —    | —          | —          | —             | Pendente  |

---

## 5. Backups

| Dado                      | Onde                                | Frequência                  | Retenção                   |
| ------------------------- | ----------------------------------- | --------------------------- | -------------------------- |
| Banco de dados (Supabase) | Supabase managed                    | Automático a cada 1h        | 7 dias (free) / PITR (Pro) |
| Código-fonte              | GitHub (`clinipharma`)              | A cada push                 | Ilimitado                  |
| Variáveis de ambiente     | Documentado em go-live-checklist.md | Manual                      | —                          |
| Uploads (documentos)      | Supabase Storage                    | Não há backup automático ⚠️ | —                          |

**⚠️ Ação recomendada:** Configurar backup externo do Supabase Storage (via `rclone` para S3) para documentos de pedidos e contratos.

---

_Este plano deve ser revisado após cada incidente real e a cada 6 meses._
