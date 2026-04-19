# DR DRILL — RESTORE DRILL (LIVE) — 2026-04-19

**Tipo:** Cenário 3 do `dr-drill-2026-04.md` (Backup corrupto / restore necessário) — variante automatizada via workflow.
**Modo:** **LIVE** (não tabletop). Restore real do backup criptografado mais recente, em PostgreSQL efêmero do CI.
**Owner:** SRE on-call (Andre).
**Workflow run:** [`restore-drill #24631516271`](https://github.com/cabralandre82/clinipharma/actions/runs/24631516271)
**Commit:** `4112341`
**Duração total:** 51s

---

## OBJETIVO

Validar de ponta-a-ponta a cadeia de restore offsite, sem depender de provisão de staging Vercel + Supabase staging (que ainda não existe). Especificamente:

1. O backup mais recente do bucket R2 é **acessível** com as credenciais armazenadas.
2. O artefato é **decriptável** com a chave privada `age` que vive em `secrets.AGE_PRIVATE_KEY`.
3. Os checksums SHA-256 do manifesto **batem** após decrypt.
4. O dump do PostgreSQL é **restaurável** num cluster vanilla `postgres:18`, com 0 erros não-explicáveis.
5. O tarball de Storage é **estruturalmente válido** (header tar legível).
6. Tabelas críticas existem e contêm linhas após restore.

---

## CADEIA EXECUTADA

| Passo                                                                                             | Resultado                                                             | Tempo |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| Localizar prefixo do backup mais recente em R2                                                    | ✅ `weekly/20260419T080245Z` (gerado 6h antes pelo `offsite-backup`)  | < 1s  |
| `aws s3 sync` dos 4 artefatos `.age`                                                              | ✅ 4 arquivos baixados                                                | ~ 2s  |
| Decrypt de todos os `.age` com `age -d -i identity`                                               | ✅ 4 plaintexts gerados                                               | ~ 1s  |
| Verificação SHA-256 do `manifest-sha256.txt`                                                      | ✅ `db-20260419T080245Z.dump: OK`; `storage-20260419T080245Z.tgz: OK` | < 1s  |
| Bootstrap dos placeholders Supabase (schemas, roles, extensions, vault.secrets stub, publication) | ✅                                                                    | ~ 1s  |
| `pg_restore` paralelo (`--jobs=4`) do dump                                                        | ✅ exit 1 com **8 erros, todos toleráveis (0 reais)**                 | 1s    |
| `tar -tzf` do `storage-*.tgz`                                                                     | ✅ header OK                                                          | < 1s  |
| Sondas de integridade contra 14 alvos                                                             | ✅ 13/14 (1 nome de tabela ajustado em commit posterior)              | < 1s  |

**Métrica RTO observada:** 51s da invocação do workflow ao final, dos quais ~40s são overhead de CI (clonar repo, `apt install`, subir container postgres, instalar `age` + `postgresql-client-18`). O `pg_restore` em si rodou em **1s** porque o dataset hoje é pequeno (3 orders, 9 users, 37 audit logs).

---

## INTEGRIDADE PÓS-RESTORE

```
Tables present:
  ✓ public tables count: 65
  ✓ auth tables count: 23
Row counts:
  ✓ auth.users: 9
  ✓ public.orders: 3
  ✓ public.payments: 3
  ✓ public.audit_logs: 37
  ✓ public.audit_logs max: 2026-04-15 16:00:11.385003+00
  ✓ public.audit_chain_checkpoints: 1
  ✓ public.feature_flags: 17
  ✓ public.products: 5
  ✓ public.pharmacies: 2
  ✓ public.clinics: 2
  ✗ public.prescriptions: relation does not exist
```

A última linha foi um falso negativo do **smoke do drill, não do dump** — o probe estava com nome errado de tabela. Tabela correta é `public.order_item_prescriptions` (corrigida em commit `4112342`). O dump em si contém todas as 65 tabelas públicas que a produção tem.

**RPO efetivo medido:** o backup é de `2026-04-19T08:02:45Z`; o drill rodou em `2026-04-19T14:36:23Z`. Janela de perda potencial = ~6h30m. Política contratual é janela semanal (RPO declarado de 7 dias para offsite — Supabase PITR cobre o resto até 5 min). Ambos dentro do alvo.

---

## ERROS POSTOS, CLASSIFICADOS

`pg_restore` retornou exit 1 (esperado) com 8 mensagens de erro:

| #   | Mensagem                                                           | Categoria | Justificativa                                          |
| --- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------ |
| 1   | `cannot drop schema vault because other objects depend on it`      | tolerável | bootstrap pré-criou `vault.secrets` antes do `--clean` |
| 2   | `cannot drop schema extensions because other objects depend on it` | tolerável | extensions já instaladas em bootstrap                  |
| 3   | `schema "extensions" already exists`                               | tolerável | bootstrap                                              |
| 4   | `schema "vault" already exists`                                    | tolerável | bootstrap                                              |
| 5   | `extension "pg_graphql" is not available`                          | tolerável | extensão exclusiva do Supabase managed                 |
| 6   | `extension "pg_graphql" does not exist`                            | tolerável | consequência de (5)                                    |
| 7   | `extension "supabase_vault" is not available`                      | tolerável | extensão exclusiva do Supabase managed                 |
| 8   | `extension "supabase_vault" does not exist`                        | tolerável | consequência de (7)                                    |

**Reais (não-classificados): 0.** Threshold do gate é 25 — passamos com folga.

Stderr completo arquivado em `pg_restore.stderr.txt`.

---

## EVIDÊNCIA ADICIONAL

- `restore-drill-full.log` — log integral do GitHub Actions run, 941 linhas
- `pg_restore.stderr.txt` — stderr capturado (também disponível como artifact `pg_restore-stderr` por 30 dias na run)
- `manifest-sha256.txt.age` — original criptografado (R2 bucket), retido pela política de lifecycle (12 weeklies + 6 monthlies)

---

## GAPS IDENTIFICADOS DURANTE O DRILL

| #   | Gap                                                                                                     | Causa                                                                                                                                                                               | Resolução                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `restore-drill` falhava no decrypt com `unexpected intro: ***`                                          | loop `for f in *.age` incluía o próprio `identity.age` que acabara de ser escrito no mesmo dir                                                                                      | commit `392e9eb` — mover identity para `$RUNNER_TEMP`                                                                                    |
| G2  | `pg_restore: error: unsupported version (1.16) in file header`                                          | Supabase prod migrou para PostgreSQL 18; ambos os workflows ainda em `postgresql-client-17` (default `pg_wrapper` do `ubuntu-latest` pegava o 18 pro `pg_dump` mas não pro restore) | commit `4c7ccb9` — pinar `postgresql-client-18` em ambos workflows; service container `postgres:18` no restore-drill                     |
| G3  | Centenas de erros de role/extensão Supabase no restore                                                  | dump de Supabase managed tem dezenas de objetos que não existem em PG vanilla                                                                                                       | commit `825c244` — bootstrap de schemas/roles/extensions + grading que tolera apenas o set conhecido                                     |
| G4  | Probes com nomes de tabela errados (`audit_log` em vez de `audit_logs`, `organizations` que nem existe) | drift documental — workflow nunca tinha rodado contra o schema atual                                                                                                                | commits `4112341` e `4112342` — probes para `audit_logs`, `audit_chain_checkpoints`, `pharmacies`, `clinics`, `order_item_prescriptions` |

Todos resolvidos no mesmo dia. Próxima execução agendada: `0 8 1 * *` (mensal, 1º de cada mês 05h BRT).

---

## DECISÕES E RECOMENDAÇÕES

1. **Manter o `restore-drill` mensal automático.** Foi a primeira execução real e desencavou 4 bugs reais — o valor de drill recorrente é exatamente esse.
2. **Configurar `BACKUP_LEDGER_URL`/`BACKUP_LEDGER_SECRET`** para o ledger interno passar a contabilizar essas execuções junto com os backups (atualmente skipped silently).
3. **Quando staging Vercel + Supabase staging existirem** (Q3/2026), promover este drill para Cenário 3 LIVE completo conforme `dr-drill-2026-04.md`: incluir teardown/promote da DB restaurada para receber tráfego sintético.
4. **Considerar** rodar uma versão "weekly heavy" do drill que carrega o `storage-*.tgz` num bucket S3-compatível ephemeral e valida pelo menos um download por bucket — hoje só validamos a integridade do tarball, não dos arquivos individuais.

---

## ASSINATURAS

- SRE on-call: Andre Cabral — 2026-04-19
- DPO observador: pendente (sem DPO formal alocado nesta janela; tabletop anterior foi observado pelo founder)

---

## REFERÊNCIAS

- Workflow: `.github/workflows/restore-drill.yml`
- Runbook origem: `docs/runbooks/dr-drill-2026-04.md` (Cenário 3)
- Política de retenção: `docs/disaster-recovery.md`
- Política LGPD relacionada: art. 46 (medidas técnicas adequadas)
