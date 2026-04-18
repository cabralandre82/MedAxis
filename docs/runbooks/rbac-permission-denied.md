# Runbook — RBAC: denies inesperados após ativação de `rbac.fine_grained`

**Gravidade:** P2 (degradação — usuário não consegue operar, workaround = toggle do flag).
**Escopo:** toda rota migrada para `requirePermission` / `requirePermissionPage` (pilot: `/server-logs`; expansão gradual nas próximas Waves).

---

## 1. Sintomas observados

Qualquer um dos abaixo configura incidente:

- Spike em `logger.warn('permission denied')` acima de `30/min` (métrica `audit-2026-04 / rbac / denied_total`).
- Spike em `logger.error('has_permission RPC failed — failing closed')` (`rbac / rpc_errors_total > 0`).
- Usuário `SUPER_ADMIN`/`PLATFORM_ADMIN` reportando `/unauthorized` ao abrir rota admin que antes funcionava.
- Aumento súbito de 403/redirect-to-unauthorized em `audit.logs` de server actions sensíveis (`services/users.ts`, `services/coupons.ts`, etc.).

## 2. Impacto no cliente

- Operadores internos perdem acesso a paineis administrativos.
- **Clientes externos não são afetados diretamente**: rotas B2B (ordenar, confirmar pagamento) não dependem de `requirePermission` nesta fase.
- LGPD: exports self-service (`lgpd.export_self`) podem ser negados para usuários com conta ativa — violando Art. 15 se persistir > 1 h.

## 3. Primeiros 5 minutos — containment

**Rollback instantâneo (sem deploy):** basta desligar a feature flag `rbac.fine_grained`.

```sql
-- Supabase SQL editor (staging + prod)
UPDATE public.feature_flags
   SET enabled = false,
       rollout_percent = 0,
       target_user_ids = NULL,
       target_roles = NULL
 WHERE key = 'rbac.fine_grained';

-- Invalidar cache do módulo lib/features (TTL 30s).
SELECT pg_notify('feature_flags_bump', 'rbac.fine_grained');
```

> Alternativa: `POST /api/admin/feature-flags/rbac.fine_grained` com `{ enabled: false }`
> via painel admin (após merge da Wave 5 UI). Enquanto a UI não existir, usar SQL.

Com o flag OFF, `lib/rbac/permissions.ts` passa a resolver via o mapa estático
`ROLE_FALLBACK`, reproduzindo o comportamento pré-Wave-4 de `requireRole`.
Observe em `/api/health/deep` que os contadores `rbac/denied_total` caem em ≤ 30 s
(TTL do cache de flags).

## 4. Diagnóstico

### 4.1 Quem está sendo negado

```sql
SELECT
  created_at,
  context ->> 'userId'     AS user_id,
  context -> 'roles'       AS roles,
  context -> 'required'    AS required_perms
FROM public.server_logs
WHERE message = 'permission denied'
   OR message = 'permission denied (page)'
ORDER BY created_at DESC
LIMIT 50;
```

### 4.2 RPC está falhando?

```sql
SELECT
  created_at,
  message,
  context ->> 'permission'   AS permission,
  context ->> 'errorMessage' AS error,
  context ->> 'errorCode'    AS error_code
FROM public.server_logs
WHERE message LIKE 'has_permission RPC%'
ORDER BY created_at DESC
LIMIT 20;
```

Causas conhecidas:

| `error_code` | Diagnóstico                                                          | Correção                                                                       |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `42883`      | `has_permission(uuid, text)` não existe (migration 047 não aplicada) | Rodar migration 047 no projeto em que falhou. Verificar em `pg_proc`.          |
| `42501`      | `service_role` não tem EXECUTE na função                             | `GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO service_role;` |
| `28000`      | Token `SUPABASE_SERVICE_ROLE_KEY` revogado / expirado                | Rotacionar chave no Vercel; restart envs.                                      |
| `PGRST…`     | Erro de transporte PostgREST (cold start, timeout)                   | Verificar `/api/health/ready`; escalar para Supabase.                          |

### 4.3 Dados de permissão estão íntegros?

```sql
SELECT
  (SELECT count(*) FROM public.permissions)                                  AS catalog_size,
  (SELECT count(*) FROM public.role_permissions)                             AS mappings_total,
  (SELECT count(*) FROM public.user_permission_grants WHERE revoked_at IS NULL
                                                         AND (expires_at IS NULL OR expires_at > now())) AS active_grants;
```

Valores esperados **pós-migration 047** (sem manutenção):

- `catalog_size >= 38`
- `mappings_total >= 55` (PLATFORM_ADMIN 35 + CLINIC_ADMIN 7 + PHARMACY_ADMIN 8 + DOCTOR 2 + SALES_CONSULTANT 4)
- `active_grants` ≥ 0

Se `catalog_size < 38`, re-aplicar a seed do migration:

```bash
# Como service-role (via Management API):
scripts/apply-migration.sh 047_fine_grained_permissions.sql
```

### 4.4 Testar a RPC manualmente

```sql
-- Substitua pelo user_id do usuário afetado.
SELECT public.has_permission('<user-uuid>', 'audit.read');
SELECT public.has_permission('<user-uuid>', 'platform.admin');

-- Ver roles atuais:
SELECT role FROM public.user_roles WHERE user_id = '<user-uuid>';

-- Ver grants ativos:
SELECT permission, expires_at, revoked_at
  FROM public.user_permission_grants
 WHERE user_id = '<user-uuid>'
   AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > now());
```

## 5. Mitigação

1. **Flag OFF** (passo 3) é o rollback canônico — resolve 95% dos casos de denies em massa.
2. Caso a RPC esteja saudável mas um **usuário específico** esteja sem acesso legítimo:
   - Emita um grant individual de curto prazo:

     ```sql
     INSERT INTO public.user_permission_grants (user_id, permission, granted_by_user_id, reason, expires_at)
     VALUES (
       '<user-uuid>',
       'audit.read',
       '<platform-admin-uuid>',
       'incident #<issue-id> — grant temporário',
       now() + interval '24 hours'
     );
     ```

   - Documente na issue de incidente. A RLS da tabela exige `is_platform_admin()`.

3. Se a RPC estiver falhando **amplamente** mas a flag estiver ON propositalmente (ex.: ramp-up):
   - Reduza `rollout_percent` da flag para `0`.
   - Remova `target_user_ids` / `target_roles`.
   - Mantenha a flag `enabled = true` para manter a telemetria funcionando, mas sem efeito prático.

## 6. Correção definitiva

- Rever `ROLE_FALLBACK` em `lib/rbac/permissions.ts` e `role_permissions` (seed 047) — eles devem ser **espelho um do outro**. Divergência é bug.
- Se necessário, emitir migration `04x_role_permissions_fix.sql` com `ON CONFLICT DO NOTHING` para adicionar linhas faltantes, e atualizar `ROLE_FALLBACK` no mesmo commit.
- Rodar `tests/unit/lib/rbac-permissions.test.ts` → pacote `ROLE_FALLBACK catalog invariants` (cobre completude).

## 7. Falso-positivo: usuário legitimamente sem permissão

Se o denial estiver correto:

1. Redirecionar para `/unauthorized` é esperado.
2. Documentar a decisão de não conceder grant.
3. Se o usuário deveria ter o direito mas nunca teve, reavaliar o **mapeamento de role** (seed 047) ou promover a role.

## 8. Post-incident

- [ ] Issue com label `incident` e `area/rbac`.
- [ ] Post-mortem em ≤72h se P1 (nunca esperado por design — rollback via flag é O(1)).
- [ ] Se RPC indisponível >5 min: abrir ticket junto ao Supabase com trace-id, horário, e payload de erro.
- [ ] Acrescentar caso-teste em `tests/unit/lib/rbac-permissions.test.ts` reproduzindo o bug.

## 9. Links úteis

- Migration que introduziu o modelo: `supabase/migrations/047_fine_grained_permissions.sql`
- Módulo de checagem: `lib/rbac/permissions.ts`
- Feature flag: `rbac.fine_grained` (migration 044)
- Catálogo de permissões (`SELECT * FROM public.permissions ORDER BY domain, key`): exibido no painel admin após Wave 5.
- Sentry tag: `rbac.permission_denied`
- Log aggregator busca: `logger.warn message:"permission denied"`
