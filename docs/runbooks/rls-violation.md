# Runbook — RLS canary violation (Wave 14)

| Campo          | Valor                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Severidade** | **P0 quando `rls_canary.page_on_violation` = ON** · P1 caso contrário                                               |
| **SLA**        | Mitigar em **≤ 30 min** (mata-mata: revert + freeze release).                                                       |
| **Owner**      | Security on-call + Data platform on-call                                                                            |
| **Origem**     | `/api/cron/rls-canary` (40 7 \* \* \* UTC) ou check `rlsCanary` em `/api/health/deep`                               |
| **Artefatos**  | `public.rls_canary_log`, RPC `rls_canary_assert/record`, `lib/rls-canary.ts`, métrica `rls_canary_violations_total` |

## 1. O que o alerta significa

O canário diário simulou um **usuário autenticado mas não-afiliado**
(UUID aleatório, sem linha em `clinic_members`, `pharmacy_members`,
`sales_consultants` nem `user_roles`) e **conseguiu enxergar pelo menos
uma linha** em uma tabela que deveria estar protegida por RLS — ou
recebeu erro do tipo `relation does not exist` que indica que a
matriz ficou desatualizada.

Em outras palavras: **a fronteira de tenants vazou**. O escopo
exato (quais tabelas, quantas linhas) está em
`rls_canary_log.details` da última execução.

## 2. Impacto de negócio

- **Quebra contratual B2B**: cada cliente espera isolamento absoluto.
  Vazamento entre clínicas → rescisão imediata + multa.
- **LGPD Art. 46**: incidente de segurança que exige notificação à
  ANPD em até 2 dias úteis quando há risco a titulares.
- **Possível incidente reportável** ao banco / adquirente se dados
  de pagamento ou contratos vazaram.
- **Disclosure pública** (LGPD Art. 48 §6º) se confirmado vazamento
  de PII de pacientes / médicos / farmacêuticos.

## 3. Triagem (T+0 a T+15 min)

1. **Confirme a violação** lendo o ledger:

   ```sql
   SELECT ran_at, subject_uuid, tables_checked, violations,
          jsonb_pretty(details) AS details
     FROM public.rls_canary_log
    WHERE violations > 0
    ORDER BY ran_at DESC
    LIMIT 5;
   ```

   Se a última execução foi um falso positivo (canário caiu por erro
   transitório de DB), confirme verificando que `runs_total` ainda
   incrementou em duas execuções seguintes sem violation.

2. **Inspecione o detalhamento** — o JSON `details.violating` lista as
   tabelas que vazaram. Para cada uma, identifique se é:
   - **`bucket=tenant`** → vazamento entre clínicas / farmácias.
     **MAIS GRAVE.** Vai para freeze + comunicação imediata.
   - **`bucket=self`** → notificações / DSAR de outro usuário visíveis.
     Grave (PII), mas escopo geralmente menor.
   - **`bucket=admin`** → ledger administrativo (audit_logs, legal_holds,
     backup_runs, etc.) acessível por usuário autenticado. Crítico
     porque expõe a postura defensiva da plataforma.

3. **Confronte com PRs recentes** — quase todo regression de RLS
   vem de uma migration ou hotfix. Liste:

   ```bash
   git log --since='3 days ago' --oneline -- 'supabase/migrations/'
   ```

   Procure mudanças em `CREATE POLICY`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
   ou queries com `USING (true)`.

4. **Reproduza o vazamento** localmente para confirmar e capturar a
   linha exata da policy:

   ```bash
   # forja um JWT canário e faz o count
   SUPABASE_JWT_SECRET=... node -e '
     import("./lib/rls-canary.js").then(async (m) => {
       const run = await m.runCanary();
       console.log(JSON.stringify(run, null, 2));
     });
   '
   ```

## 4. Mitigação (T+15 min a T+30 min)

### 4.1. Cenário A — vazamento por policy quebrada

1. **Identifique a tabela** vazada e leia a policy:

   ```sql
   SELECT policyname, cmd, qual
     FROM pg_policies
    WHERE schemaname='public' AND tablename='<tabela>';
   ```

2. **Restaure a policy correta**. Se foi um PR específico, faça
   `git revert <sha>` da migration ofensora.

3. **Aplique uma migration de hotfix** que recria a policy correta:

   ```sql
   -- Exemplo: rebuild policy on payments
   DROP POLICY IF EXISTS payments_select ON public.payments;
   CREATE POLICY payments_select ON public.payments FOR SELECT
     USING (
       public.is_platform_admin()
       OR payer_profile_id = auth.uid()
       OR EXISTS (...)
     );
   ```

4. **Re-rode o canário** para confirmar:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://app.clinipharma.com.br/api/cron/rls-canary
   ```

### 4.2. Cenário B — recursão infinita em policy

Sintoma: `error_message: 'infinite recursion detected in policy for relation "X"'`

Foi exatamente o que a Wave 14 detectou em `clinic_members_select`
e `doctors_select`/`doctor_clinic_links_select`. Padrão: a policy
referencia a própria tabela em `EXISTS (...)`.

**Fix**: extraia o lookup para uma função `SECURITY DEFINER` que
faça bypass da própria policy. Veja
`migration 055` para os exemplos `is_clinic_member()`,
`doctor_visible_to_clinic_member()`.

### 4.3. Cenário C — `permission denied` virou erro real

A função do canário trata `permission denied for table X` como
**enforcement válido** (visible_rows=0). Se virou um erro
diferente, a tabela mudou de schema (rename/drop) ou a matriz em
`rls_canary_assert()` ficou desalinhada.

**Fix**: atualize a matriz dentro da função (migration nova) e
sincronize `docs/rls-matrix.md`.

### 4.4. Freeze de release

Enquanto a violação não for resolvida, **bloqueie merges** em
`main` adicionando um label `do-not-merge:rls` na PR aberta e
postando no canal `#sec-incidents`:

> **RLS canary RED em prod desde {timestamp}**. Freeze de release
> até patch confirmado. Owner: @<você>.

## 5. Comunicação

- **DPO + Jurídico**: notificar imediatamente se `bucket=tenant`
  ou `bucket=self` envolveu PII.
- **CEO + CTO**: em qualquer P0.
- **ANPD**: avaliar notificação em 2 dias úteis (LGPD Art. 48).
  O DPO decide com base em escopo + duração + tipo de dado vazado.
- **Clientes B2B afetados**: e-mail formal com root cause + ação
  corretiva, em até 5 dias úteis.

## 6. Verificações pós-mitigação (T+1 h)

- [ ] Canário roda 3 ciclos seguidos com `violations=0`.
- [ ] `audit_logs` não tem evidência de exfiltração no janela
      do incidente:

  ```sql
  SELECT actor_user_id, action, entity_type, count(*)
    FROM public.audit_logs
   WHERE created_at >= NOW() - INTERVAL '24 hours'
     AND entity_type = ANY (ARRAY['order','payment','contract'])
   GROUP BY 1,2,3
   ORDER BY count(*) DESC
   LIMIT 50;
  ```

- [ ] `rate_limit_violations` (Wave 10) não mostra spike de leituras
      anômalas (mesmo IP varrendo IDs).
- [ ] Snapshot R2 do dia anterior preservado (Wave 12) — restore
      drill manual se houver suspeita de exfiltração massiva.
- [ ] PR de hotfix mergeada com migration + teste unitário que
      exercita a policy corrigida.

## 7. Pós-mortem (T+24 h)

Documento em `docs/postmortems/<YYYY-MM-DD>-rls-leak.md` com:

- Timeline (PR ofensor → merge → deploy → canário → page → fix).
- Root cause (policy mal escrita? trigger removido? migration revertida?).
- Por que escapou da review (faltou teste? matriz desatualizada?).
- Action items:
  - [ ] Adicionar pgTAP-style test específico para a policy quebrada.
  - [ ] Adicionar a tabela à matriz do canário se ainda não estiver.
  - [ ] Bloqueador de PR no CI: rejeitar `USING (true)` ou EXISTS
        recursivo via lint.

## 8. Como ligar/desligar enforcement

- **Observação (default — primeiros 30 dias)**:

  ```sql
  UPDATE public.feature_flags
     SET enabled = false
   WHERE key = 'rls_canary.page_on_violation';
  ```

  Cron continua rodando, métrica `rls_canary_violations_total`
  continua incrementando, alerta sai como **warning** (e-mail).

- **Enforcement (depois da observação)**:

  ```sql
  UPDATE public.feature_flags
     SET enabled = true
   WHERE key = 'rls_canary.page_on_violation';
  ```

  Qualquer violação dispara **PagerDuty critical** imediatamente.

## 9. Métricas + dashboards

- `rls_canary_runs_total{outcome=ok|violation|error}` — taxa de execução.
- `rls_canary_violations_total` — **deve sempre ser 0** (SLO-11).
- `rls_canary_age_seconds` — idade do último run (esperado < 36 h).
- `rls_canary_duration_ms` — latência do RPC (p50/p95).
- Painel Grafana: `monitoring/grafana/security.json` (Wave 14).

## 10. Pré-requisitos da plataforma

- `SUPABASE_JWT_SECRET` configurado em Production no Vercel
  (`vercel env add SUPABASE_JWT_SECRET production`).
- Migration 055 aplicada (verificar com `SELECT count(*) FROM public.rls_canary_log;`).
- Cron registrado em `vercel.json` (`/api/cron/rls-canary`).
- Flag `rls_canary.page_on_violation` decidida (default OFF).
