# Runbook — Legal hold recebido / ordem de preservação (Wave 13)

| Campo          | Valor                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Severidade** | P2 (recebimento) · P1 (suspeita de purge já executado)                                                                           |
| **SLA**        | Aplicar hold em **≤ 4 h** do recebimento da ordem formal                                                                         |
| **Owner**      | DPO (SUPER_ADMIN) + Jurídico                                                                                                     |
| **Origem**     | ANPD, PROCON/DPDC, Judiciário, MPF, auditoria interna, ANVISA                                                                    |
| **Artefatos**  | `public.legal_holds`, RPC `legal_hold_apply/release/is_active`, flags `legal_hold.block_purge` e `legal_hold.block_dsar_erasure` |

## 1. O que o alerta significa

Recebemos uma ordem formal que determina **preservação de dados** ligados a
um sujeito (usuário, pedido, documento, farmácia, pagamento). Ordens típicas:

- **ANPD** inquérito preliminar (LGPD Art. 52, §1º).
- **PROCON/DPDC** investigação de prática abusiva (CDC Art. 55).
- **Ofício judicial** (cível / criminal / trabalhista).
- **MPF / Polícia Federal** em apuração criminal.
- **ANVISA** em investigação de dispensação irregular.
- **Auditoria interna** antecipando requerimento regulatório.

Enquanto o hold está **ativo**, retention crons e o fluxo DSAR de
**ERASURE** precisam pular o sujeito. A partir da Wave 13 a plataforma
tem suporte nativo (`legal_hold_is_active()` + flags
`legal_hold.block_*`).

## 2. Impacto de negócio se a ordem for ignorada

- **LGPD Art. 48**: descumprimento sistemático → multa de até 2 % do faturamento,
  limitada a R$ 50 M **por infração**.
- Reputação junto à ANPD — fica registrado no histórico do controlador.
- Obstrução / desobediência judicial → responsabilização do DPO e do
  Diretor-Presidente.
- Destruição de evidência → inversão do ônus probatório em ação civil.

## 3. Triagem (T+0 a T+1 h)

1. **Confirme a autenticidade da ordem** junto ao Jurídico. Peça:
   - Número do processo / nº SEI / nº oficial.
   - Autoridade emissora + contato.
   - Escopo exato (qual sujeito, qual período, quais dados).
   - Prazo (sem prazo → open-ended até revogação formal).
2. **Identifique o `subject_type` e o `subject_id` na plataforma**:

   ```sql
   -- Por CPF (hash indexado desde Wave 9)
   SELECT id FROM public.profiles WHERE cpf_hash = encode(digest('<cpf sem máscara>', 'sha256'),'hex');
   -- Por pedido
   SELECT id FROM public.orders WHERE numero_pedido = '<N>';
   -- Por farmácia (CNPJ)
   SELECT id FROM public.pharmacies WHERE cnpj = '<cnpj>';
   ```

3. **Aplique o hold** chamando o endpoint admin (DPO logado):

   ```bash
   curl -X POST https://app.clinipharma.com.br/api/admin/legal-hold/apply \
     -H 'Authorization: Bearer <JWT do DPO>' \
     -H 'Content-Type: application/json' \
     -d '{
       "subject_type": "user",
       "subject_id": "<uuid>",
       "reason_code": "ANPD_INVESTIGATION",
       "reason": "Processo SEI-ANPD-00123456/2026 — inquérito preliminar",
       "expires_at": null,
       "document_refs": [
         {"ref": "SEI-ANPD-00123456/2026", "received_at": "2026-04-17"}
       ],
       "requestor": {
         "org": "ANPD",
         "name": "Fulano de Tal",
         "contact": "fulano@anpd.gov.br",
         "document_number": "Ofício 123/2026-ANPD"
       }
     }'
   ```

   O endpoint responde **201** na criação ou **200** (`idempotent:true`)
   se já existia hold ativo para o par (sujeito, `reason_code`).

4. **Confirme no banco** que o hold está visível:

   ```sql
   SELECT * FROM public.legal_holds_active_view WHERE subject_id = '<uuid>';
   ```

5. **Ative a aplicação**: se este é o primeiro hold da temporada, considere
   flipar as feature flags de enforcement (veja §5).

## 4. Verificação de "já deletamos algo?"

O risco crítico: a ordem chega **depois** que um DSAR ou cron já apagou
dados. Como checar:

1. **Audit chain** (Wave 3):

   ```sql
   SELECT id, action, entity_type, entity_id, created_at
     FROM public.audit_logs
    WHERE (entity_id = '<subject_id>' OR actor_user_id = '<subject_id>')
    ORDER BY created_at DESC
    LIMIT 200;
   ```

2. **Checkpoints de retenção** (indicam purges por cron):

   ```sql
   SELECT created_at, purged_count, notes
     FROM public.audit_chain_checkpoints
    ORDER BY created_at DESC
    LIMIT 20;
   ```

3. **DSAR histórico**:

   ```sql
   SELECT id, kind, status, requested_at, updated_at
     FROM public.dsar_requests WHERE subject_user_id = '<subject_id>';
   ```

4. **Backups offsite** (Wave 12) — se precisar resgatar:

   ```sql
   SELECT kind, label, recorded_at, r2_prefix, outcome
     FROM public.backup_latest_view WHERE kind='BACKUP' AND outcome='ok';
   ```

   Bucket R2 `clinipharma-offsite/<r2_prefix>/` — use a chave AGE offline
   para restaurar em sandbox (ver `restore-drill.yml`).

Se houve purge: **escale para P1 imediatamente** e documente no processo.
Notifique ANPD/Jurídico no mesmo dia útil.

## 5. Flags de enforcement

Ambas default OFF no launch:

| Flag                            | Efeito quando ON                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `legal_hold.block_purge`        | `enforce-retention` pula profiles/notifications sob hold; audit_logs já pula via RPC (hardcoded) |
| `legal_hold.block_dsar_erasure` | `/api/admin/lgpd/anonymize/:userId` responde **409 LEGAL_HOLD_ACTIVE** ao invés de anonimizar    |

Para flipar ON:

```sql
UPDATE public.feature_flags
   SET enabled = true, updated_at = now(), updated_by = '<super_admin uuid>'
 WHERE key IN ('legal_hold.block_purge', 'legal_hold.block_dsar_erasure');
```

**Recomendação**: ativar `legal_hold.block_dsar_erasure` sempre que houver
pelo menos 1 hold ativo. Deixar `legal_hold.block_purge` OFF por 30 dias
após o primeiro hold ser aplicado (métrica `legal_hold_blocked_purge_total`
sinaliza quantas linhas seriam bloqueadas — se o volume bater com o
esperado, ligar).

## 6. Liberação (release)

Ordens expiram, são arquivadas ou revogadas. Para liberar:

```bash
curl -X POST https://app.clinipharma.com.br/api/admin/legal-hold/release \
  -H 'Authorization: Bearer <JWT DPO>' \
  -H 'Content-Type: application/json' \
  -d '{
    "hold_id": "<uuid>",
    "release_reason": "Processo SEI-ANPD-00123456/2026 arquivado em 2026-10-15"
  }'
```

**Nunca delete rows** de `legal_holds` — o trigger
`_legal_holds_guard` rejeita e a linha permanece para auditoria.

## 7. Métricas & dashboards

Exportadas em `/api/metrics`:

- `legal_hold_active_count{}` — gauge (quantos holds ativos agora).
- `legal_hold_apply_total{reason_code,outcome}` — counter.
- `legal_hold_release_total{outcome}` — counter.
- `legal_hold_blocked_purge_total{job}` — counter (retention cron).
- `legal_hold_blocked_dsar_total{subject_type}` — counter (DSAR anonymize).
- `legal_hold_expired_total` — counter (auto-expiries no mensal).

Alertas sugeridos (Grafana):

- `legal_hold_active_count > 0` por > 7 dias sem mudança → informativo P3
  (para confirmar que alguém ainda está olhando).
- `increase(legal_hold_blocked_dsar_total[1h]) > 0` E flag OFF → P2
  (DSAR sendo aprovado contra sujeito sob hold).
- Deep health → `legalHolds.overdueExpiries > 0` → P3 (cron atrasado).

## 8. Pós-incidente

1. Anexe ao processo interno: ID do hold, timestamp de aplicação,
   DPO responsável, flags ativas na época.
2. Registre no changelog semanal do Jurídico.
3. Se foi a primeira ativação, rode o **teste de restore** (Wave 12) no
   próximo ciclo mensal para garantir que o backup com os dados
   preservados é recuperável.

## 9. Quick reference

```sql
-- Conferir holds ativos
SELECT * FROM public.legal_holds_active_view;

-- Ver histórico completo de um sujeito
SELECT * FROM public.legal_holds WHERE subject_id='<uuid>' ORDER BY placed_at;

-- Checar ativo sem ler reason (para cron/RLS)
SELECT public.legal_hold_is_active('user', '<uuid>');

-- Varrer expiries pendentes
SELECT * FROM public.legal_hold_expire_stale();
```
