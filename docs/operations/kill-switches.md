# Kill-Switches — inventário operacional

> **Trilho D** do baseline `v1.0.0-launch-ready`. Documenta TODOS os
> kill-switches disponíveis para reverter comportamento sem deploy,
> identifica gaps e propõe plano de fechamento.

**Última auditoria:** 2026-05-02
**Owner:** solo operator

---

## 0. O que é um kill-switch nesta plataforma

Um kill-switch é um mecanismo que permite **desligar uma feature em
produção sem precisar de deploy** — útil quando:

- Uma regressão acaba de ser deployada e o `git revert` levaria 5+ min.
- Uma feature está causando carga acima do esperado (rate-limit, custo).
- Um requisito legal/regulatório obriga a parar o processamento de
  uma classe de dados imediatamente.

Esta plataforma usa três tipos:

| Tipo             | Onde mora                                         | Tempo para flipar             | Exemplo                                      |
| ---------------- | ------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| **Feature flag** | `public.feature_flags` (mig 044) + `lib/features` | < 60s (cache TTL 30s)         | `money.cents_read`                           |
| **Setting**      | `public.app_settings`                             | < 60s (depende do consumidor) | `consultant_commission_rate`                 |
| **Operacional**  | mutação direta no DB ou Vercel env                | minutos                       | `update products set pricing_mode='FIXED' …` |

A diferença prática: feature flag tem audit (`feature_flag_audit`) e
RBAC builtin; setting é mais rude; operacional é "última instância" e
não tem auto-reversibilidade — exige post-mortem para ser reverido.

---

## 1. Feature flags ativas (consultadas em runtime)

Listadas em ordem de **frequência de uso operacional** — quanto mais
acima, mais provável você precise flipar em incidente real.

### 1.1 — `money.cents_read`

| Campo             | Valor                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Propósito         | Lê valores monetários de `*_cents` (bigint) em vez de `numeric`. Quando OFF, lê de `numeric`.            |
| Default seed      | `false` (legado em `numeric`) — mas em prod, hoje, deveria estar `true`                                  |
| Quando flipar OFF | Drift detectado em `money_drift_view` em volume alto. Volta para o caminho `numeric` enquanto investiga. |
| Consumidores      | `lib/money-format.ts`                                                                                    |
| Skill             | `.cursor/skills/money-drift/SKILL.md`                                                                    |
| Como flipar       | `update public.feature_flags set enabled = false where key = 'money.cents_read';`                        |

### 1.2 — `observability.deep_health`

| Campo            | Valor                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Propósito        | Habilita `/api/health/deep` (caro, 3-5 queries DB).                                       |
| Default          | `false` (off por design, ligar só durante incidente)                                      |
| Quando flipar ON | Investigação de incidente — quer ver checks profundos. Lembre de flipar OFF depois.       |
| Consumidores     | `app/api/health/deep/route.ts`                                                            |
| Como flipar      | `update public.feature_flags set enabled = true where key = 'observability.deep_health';` |

### 1.3 — `rls_canary.page_on_violation`

| Campo             | Valor                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Propósito         | Quando ON, violação de canário RLS dispara P0 (paginação). Quando OFF, só log.                |
| Default           | `false` (Wave inicial, ON após validação)                                                     |
| Quando flipar OFF | Falso-positivo do canário enquanto refactora-se RLS (raro, requisita justificativa).          |
| Consumidores      | `app/api/cron/rls-canary/route.ts`                                                            |
| Skill             | `.cursor/skills/rls-violation-triage/SKILL.md`                                                |
| Como flipar       | `update public.feature_flags set enabled = false where key = 'rls_canary.page_on_violation';` |

### 1.4 — `legal_hold.block_purge` / `legal_hold.block_dsar_erasure`

| Campo             | Valor                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Propósito         | Garante que retenção automática (`enforce-retention`) e DSAR de erasure respeitam `legal_holds`.             |
| Default           | `true` esperado                                                                                              |
| Quando flipar OFF | **NUNCA voluntariamente** — flipar OFF descumpre LGPD Art. 16. Só sob ordem judicial específica documentada. |
| Consumidores      | `lib/retention-policy.ts`, `app/api/admin/lgpd/anonymize/[userId]/route.ts`                                  |
| Como flipar       | `update public.feature_flags set enabled = false where key = 'legal_hold.block_purge';`                      |

### 1.5 — `backup.freshness_enforce`

| Campo             | Valor                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Propósito         | Quando ON, ausência de backup há > 8 dias dispara incidente.                                                |
| Default           | `true` esperado                                                                                             |
| Quando flipar OFF | Janela controlada de manutenção do offsite (ex: troca de chave age). Documentar em `docs/execution-log.md`. |
| Consumidores      | `app/api/cron/backup-freshness/route.ts`, `app/api/health/deep/route.ts`                                    |
| Skill             | `.cursor/skills/backup-verify/SKILL.md`                                                                     |

### 1.6 — `dsar.sla_enforce`

| Campo             | Valor                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Propósito         | Quando ON, DSAR ainda em RECEIVED após 12 dias dispara escalação P2. |
| Default           | `true` esperado                                                      |
| Quando flipar OFF | **NUNCA**. SLA de 15 dias é legal (LGPD Art. 19).                    |
| Consumidores      | `app/api/cron/dsar-sla-check/route.ts`                               |
| Skill             | `.cursor/skills/dsar-fulfill/SKILL.md`                               |

### 1.7 — `security.csrf_enforce` / `security.turnstile_enforce`

| Campo             | Valor                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Propósito         | Habilita CSRF double-submit / Turnstile em rotas mutating.       |
| Default           | `false` no seed inicial → flipou para `true` durante hardening   |
| Quando flipar OFF | **NUNCA** — vulnerabilidade aberta. Use apenas para debug local. |
| Consumidores      | `lib/security/csrf.ts`, `lib/turnstile.ts`                       |

### 1.8 — `secrets.rotation_enforce` / `secrets.auto_rotate_tier_a`

| Campo             | Valor                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Propósito         | Garante que cron de rotação de secrets dispara incidente quando overdue. Auto-rota Tier A quando ON. |
| Default           | `true` esperado                                                                                      |
| Quando flipar OFF | Janela de manutenção do vault de secrets. Reativar em < 24h.                                         |
| Consumidores      | `app/api/cron/rotate-secrets/route.ts`, `lib/secrets/rotate.ts`                                      |
| Skill             | `.cursor/skills/secret-rotate/SKILL.md`                                                              |

### 1.9 — `alerts.pagerduty_enabled` / `alerts.email_enabled`

| Campo         | Valor                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| Propósito     | Roteamento de alertas P0/P1.                                                  |
| Default       | `email_enabled=true`, `pagerduty_enabled=false` (solo operator não usa pager) |
| Quando flipar | OFF email durante teste de chaos para evitar inundar inbox.                   |
| Consumidores  | `lib/alerts.ts`                                                               |

### 1.10 — `rbac.fine_grained`

| Campo             | Valor                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Propósito         | Usa `rbac.has_permission(role, perm)` SQL em vez de fallback hard-coded.       |
| Default           | `false` no seed → ainda não totalmente migrado                                 |
| Quando flipar OFF | Se um permission check de RPC quebrou, volta ao hard-coded enquanto investiga. |
| Consumidores      | `lib/rbac/permissions.ts`                                                      |

### 1.11 — `orders.atomic_rpc` / `coupons.atomic_rpc` / `payments.atomic_confirm`

| Campo     | Valor                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Propósito | Roteia order/coupon/payment via RPC atômico em vez de fluxo multi-query.                                                                |
| Default   | `false` no seed                                                                                                                         |
| Status    | Atualmente **redundante** — o código usa o RPC direto, não consulta o flag. Deve ser revisado: ou remover o flag ou adicionar o branch. |

---

## 2. Settings (consultados em runtime)

| Setting                      | Tabela         | Propósito                                                  | Como flipar                                                                                           |
| ---------------------------- | -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `consultant_commission_rate` | `app_settings` | % global aplicada quando produto não define explicitamente | `update public.app_settings set value_json = '0.05'::jsonb where key = 'consultant_commission_rate';` |

> Settings não têm cache TTL nem audit-trail builtin. Mude com cuidado.
> Para mudanças críticas, prefira criar uma migration de seed e
> documentar o motivo.

---

## 3. Kill-switches operacionais (sem flag, mutação direta)

São **procedimentos** — não há um boolean que liga/desliga. Mas são
o fallback definitivo quando nada mais funciona.

### 3.1 — Pausar produto inteiro do catálogo

```sql
update public.products set active = false where id = '<product_id>';
```

Efeito: some do catálogo, não pode ser pedido. Pedidos abertos para
ele continuam vivos. Reversível em 1 update.

### 3.2 — Reverter produto TIERED para FIXED

```sql
update public.products set pricing_mode = 'FIXED' where id = '<product_id>';
```

Efeito: a UI volta a mostrar `price_current` legacy em vez do simulator
tiered. Pedidos novos pagam `price_current`. Pedidos abertos com tier
congelado continuam com o preço congelado. Reversível em 1 update,
mas se o `price_current` estiver desatualizado em relação ao tier 1,
o buyer vai pagar o valor antigo. Veja mig 082 (sync legacy fields)
antes de fazer.

### 3.3 — Desativar cupom emergencialmente

```sql
update public.coupons set active = false where id = '<coupon_id>';
```

Use quando descobrir que um cupom está com desconto errado ou foi
distribuído fora do alvo. **Não delete** — preserva o histórico para
auditoria.

### 3.4 — Pausar projeto Vercel (parada total)

```bash
# Pausar deploys (não afeta o deploy ativo)
vercel projects pause clinipharma --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# Para realmente DERRUBAR o site, é preciso deletar o deploy ativo
# (Vercel promove o anterior em segundos):
vercel ls clinipharma --prod | head -5
vercel remove <dpl_id_ativo> --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

Use somente em emergência absoluta (ex: vazamento ativo de PII
em massa). Documentar em `docs/runbooks/data-breach-72h.md`.

### 3.5 — Bloquear IP/range no Cloudflare

Manual via dashboard. Cobre casos de DDoS, credential-stuffing
massivo, scraping abusivo. Skill: `.cursor/skills/rate-limit-abuse/SKILL.md`.

### 3.6 — Pausar webhook Asaas (manter pagamentos OFF temporariamente)

Asaas dashboard → webhooks → toggle disabled. Ou:

```bash
# Vercel — flipar a env para forçar erro de URL parsing
echo -n "https://example.invalid/api/v3" | vercel env add ASAAS_API_URL production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" --force
vercel --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

> ⚠️ Consequência: TODA tentativa de criar charge falha com 500.
> Use só se houver fraude detectada. Reverter requer redeploy + env update.

---

## 4. Gaps reconhecidos (sem kill-switch dedicado)

A análise do baseline `v1.0.0-launch-ready` identificou estas features
**sem flag flippable** — qualquer reversão exige `git revert` + deploy
(~5 min) ou mutação direta no DB (procedimento operacional).

| Gap                                                                           | Severidade | Fallback atual                                                                          | Recomendação                                                                        |
| ----------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Tiered pricing engine (ADR-001)                                               | Média      | Reverter produto via §3.2                                                               | Adicionar flag `pricing.tiered_enabled` global                                      |
| Novos coupon types FIRST_UNIT_DISCOUNT/TIER_UPGRADE/MIN_QTY_PERCENT (ADR-002) | Baixa      | Desativar cupom via §3.3                                                                | Adicionar flag `coupons.new_types_enabled`                                          |
| Auto-replace atômico de cupom (ADR-003)                                       | Baixa      | A operação é manual — para pausar, basta não criar cupom novo. Sem fallback necessário. | Não precisa de flag — comportamento opt-in pelo admin.                              |
| Asaas (pagamento)                                                             | Alta       | §3.6 (procedimento ruim)                                                                | Adicionar flag `payments.asaas_enabled` que faz checkout retornar `503 maintenance` |
| Clicksign (assinatura)                                                        | Alta       | Sem fallback — assinatura simplesmente falha                                            | Adicionar flag `contracts.clicksign_enabled`                                        |

### 4.1 — Por que isso importa

Hoje, se Asaas der problema (sandbox down, key revogada por engano,
mudança de API contract), a única forma de pausar é mudar env e
redeploy. Em incidente real, isso pode ser 10-15 min — durante os
quais clientes vêem erro 500 na hora de pagar.

Com `payments.asaas_enabled=false`, o backend devolve `503 Em manutenção`
e o frontend pode mostrar UX decente. Reverter é 1 update SQL, < 60s.

### 4.2 — Plano de fechamento dos gaps (próxima iteração, NÃO no baseline)

1. Criar migration `084_kill_switches_pre_launch.sql` que faz seed de:
   - `pricing.tiered_enabled` (default ON, descrição clara)
   - `coupons.new_types_enabled` (default ON)
   - `payments.asaas_enabled` (default ON)
   - `contracts.clicksign_enabled` (default ON)

2. Adicionar `isFeatureEnabled()` nos call-sites:
   - `lib/services/pricing-engine.server.ts::computeUnitPrice` →
     se OFF, retorna `{ ok: false, reason: 'feature_disabled' }`.
     UI cai no fallback FIXED.
   - `services/coupons.ts::createCoupon` → se OFF e tipo novo,
     rejeita com mensagem clara.
   - `app/api/payments/asaas/create/route.ts` → se OFF, retorna 503.
   - `app/api/contracts/create/route.ts` → idem.

3. Adicionar testes unitários cobrindo o branch OFF de cada um
   (similar a `tests/unit/lib/turnstile.test.ts`).

4. Atualizar este doc movendo cada gap para §1.

5. Atualizar `docs/runbooks/post-deploy-smoke-failed.md` §5.H com os
   novos kill-switches.

---

## 5. Procedimento padrão para flipar uma flag

### Via SQL direto (operador, < 60s)

```sql
-- Audit deve ser populado automaticamente via trigger (mig 044).
update public.feature_flags
   set enabled = false,
       updated_by = '<seu-uuid-em-auth.users>'
 where key = '<flag-key>';

-- Confirmar que entrou na audit table
select changed_at, action, old_value->>'enabled', new_value->>'enabled', changed_by
  from public.feature_flag_audit
 where key = '<flag-key>'
 order by changed_at desc
 limit 5;
```

### Via UI (super-admin)

Página `/admin/feature-flags` (se existir — checar). Senão, próxima
iteração.

### Via API (raro)

Endpoint POST não existe por design — flag-changes têm que passar
pela trigger de audit. Se um dia houver demanda, criar via RPC com
`SECURITY DEFINER` que insere via UPDATE explicit, garantindo audit.

---

## 6. Testes

A suite `tests/unit/lib/features.test.ts` cobre:

- Cache TTL e invalidação.
- Targeting por user_id, clinic_id, role.
- Rollout percent.
- Fail-closed quando DB indisponível.

Cada call-site que CONSULTA uma flag deve ter teste cobrindo:

- Branch ON
- Branch OFF
- Branch quando DB indisponível (deve fail-close, ou seja, comportamento
  default seguro)

Exemplos de boa cobertura: `tests/unit/lib/turnstile.test.ts`,
`tests/unit/lib/retention-policy.test.ts`.

---

## 7. Auditoria — quando esta doc deve ser revisada

- A cada nova feature crítica adicionada (pricing, payment, contracts,
  RLS).
- A cada incidente que precisou ser mitigado por mutação direta (§3) —
  isso é um sinal de gap.
- Pelo menos 1× por trimestre, comparar contra `lib/features/index.ts`
  (lista de FeatureFlagKey) e `public.feature_flags` (rows reais).

---

## Links

- Migration: `supabase/migrations/044_feature_flags.sql`
- Library: `lib/features/index.ts`
- Runbook geral: `docs/runbooks/incident-response.md`
- Baseline: `docs/launch-baseline-2026-05-02.md`

---

_Versão: 2026-05 · Owner: solo operator_
