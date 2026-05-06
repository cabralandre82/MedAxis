# Trigger Order — fonte de verdade do "quem dispara antes de quem"

**Status**: documento normativo (referenciado por
`tests/unit/migrations/trigger-order.test.ts`).
**Owner**: solo operator + agentes de IA.
**Última auditoria**: 2026-05-06.

---

## Por que este documento existe (Pre-mortem A5 — blind spot 4)

PostgreSQL executa triggers do **mesmo timing/evento** em **ordem alfabética
do nome do trigger** ([`pg_trigger.tgname` ascendente](https://www.postgresql.org/docs/16/trigger-definition.html)).
Isso é determinístico, mas frágil: basta alguém adicionar um trigger novo
com nome alfabeticamente posicionado entre dois existentes para que a
cadeia de mutações da row mude, sem que nenhum teste explícito detecte.

Em uma plataforma B2B financeira com `_cents` ↔ `numeric` redundante e
`freeze_order_item_price` que aplica cupons/tiers em cima, a ordem
**existe pra evitar drift de centavos** que o `money_drift_view` não
consegue prevenir — só detectar **depois**.

A mig **067** documenta o exato bug que esta doc previne:

> BEFORE INSERT triggers on `public.order_items` fire alphabetically:
>
> 1. `trg_money_sync_order_items` (← runs FIRST)
>    → sees `NEW.total_price=190.00`, `total_price_cents=NULL`
>    → derives `total_price_cents=19000`. Both columns agree.
> 2. `trg_order_items_freeze_price` (← runs SECOND)
>    → applies coupon: `NEW.total_price := 180.50`
>    → ALSO writes the matching `total_price_cents = 18050`
>    (this fix landed in mig-067).
>
> **Se a ordem invertesse** ou um trigger novo entrasse entre os dois,
> o snapshot de cents ficaria 950 cent à frente do numeric, e o
> `money_drift_view` apontaria a fila de pedidos como drift logo no
> próximo cron de reconciliação financeira.

---

## Inventário canônico — tabelas com >1 trigger no mesmo timing

> Apenas as combinações `(tabela, timing, evento)` que têm **mais de um**
> trigger são listadas aqui. Pares isolados (1 trigger só) não correm
> risco de reordenação acidental.

### `public.order_items` BEFORE INSERT

Ordem de execução **mandatória** (alfabética + semântica):

| #   | Trigger                        | Função SQL                  | Migração origem                                     | Papel                                                                   |
| --- | ------------------------------ | --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `trg_money_sync_order_items`   | `_money_sync_order_items()` | 050                                                 | Deriva `*_cents` de `*_price` quando um lado falta                      |
| 2   | `trg_order_items_freeze_price` | `freeze_order_item_price()` | 008 → 027 → 028 → 067 → 072 → 080 (várias revisões) | Aplica cupom / tier; reescreve `unit_price`, `total_price`, e `*_cents` |

**Invariante**: `m` < `o` alfabeticamente, então `trg_m*` < `trg_o*`.
Qualquer trigger novo nesta tabela com prefix < `trg_m` ou entre `m` e
`o` (ex: `trg_n_*`) **quebra a ordem**.

> **Cicatriz histórica (mig-067)**: nesta janela ambos triggers
> sempre existiram. A correção da mig-067 não foi remover o
> money_sync — foi tornar o `freeze_order_item_price()` AUTO-SUFICIENTE
> em escrever cents que ele mesmo calcula. Isso fez a derivação
> inicial do money_sync ficar **inerte** para o caminho com cupom
> (porque o freeze sobrescreve), mas continua sendo a primeira linha
> de defesa para INSERTs sem cupom (onde freeze é idempotente para
> as colunas money). O bug original era cents 950 cents à frente do
> numeric em ordens com cupom — hoje, freeze fecha o ciclo escrevendo
> numéricos e cents juntos.

### `public.order_items` AFTER INSERT/UPDATE/DELETE

| #   | Trigger                        | Função                 | Migração | Papel                          |
| --- | ------------------------------ | ---------------------- | -------- | ------------------------------ |
| 1   | `trg_order_items_recalc_total` | `recalc_order_total()` | 008      | UPDATE em `orders.total_price` |

Único trigger, mas faz `UPDATE public.orders` que dispara
`trg_money_sync_orders` (BEFORE UPDATE) — cadeia inter-tabela
documentada em `docs/runbooks/money-drift.md` §"trigger chain".

### `public.orders` BEFORE INSERT

Ordem de execução (alfabética):

| #   | Trigger                    | Função SQL               | Migração | Papel                                             |
| --- | -------------------------- | ------------------------ | -------- | ------------------------------------------------- |
| 1   | `trg_money_sync_orders`    | `_money_sync_orders()`   | 050      | Deriva `total_price_cents` de `total_price`       |
| 2   | `trg_orders_generate_code` | `orders_generate_code()` | 002      | Gera `orders.code` legível (formato `ORD-YYMM-…`) |

`m` < `o` alfabeticamente. Trigger novo entre `m` e `o` (ex:
`trg_n_validate`) inseriria-se na cadeia DEPOIS do sync mas ANTES
do generate_code — não faz dano direto a money columns, mas preserve
o invariant: derive cents PRIMEIRO.

### `public.orders` BEFORE UPDATE

| #   | Trigger                 | Função SQL             | Migração | Papel                                            |
| --- | ----------------------- | ---------------------- | -------- | ------------------------------------------------ |
| 1   | `trg_money_sync_orders` | `_money_sync_orders()` | 050      | Sync cents↔numeric em UPDATEs parciais (mig-061) |
| 2   | `trg_orders_updated_at` | `set_updated_at()`     | 002      | Touch `orders.updated_at`                        |

**Invariante crítico**: `trg_money_sync_orders` ANTES de `trg_orders_updated_at`.
Se invertesse, `updated_at` veria a row em estado pré-sync e poderia
disparar caches/invalidações com leitura inconsistente entre cents e
numeric pelo curto período do trigger.

### `public.orders` AFTER UPDATE

Único trigger:

| #   | Trigger                     | Função SQL                  | Migração | Papel                            |
| --- | --------------------------- | --------------------------- | -------- | -------------------------------- |
| 1   | `trg_orders_status_history` | `log_order_status_change()` | 002      | Append em `order_status_history` |

### `public.payments` BEFORE INSERT

Único trigger:

| #   | Trigger                   | Função SQL               | Migração | Papel                                         |
| --- | ------------------------- | ------------------------ | -------- | --------------------------------------------- |
| 1   | `trg_money_sync_payments` | `_money_sync_payments()` | 050      | Deriva `gross_amount_cents` de `gross_amount` |

### `public.payments` BEFORE UPDATE

| #   | Trigger                   | Função SQL               | Migração | Papel                                  |
| --- | ------------------------- | ------------------------ | -------- | -------------------------------------- |
| 1   | `trg_money_sync_payments` | `_money_sync_payments()` | 050      | Sync cents↔numeric em UPDATEs parciais |
| 2   | `trg_payments_updated_at` | `set_updated_at()`       | 002      | Touch `payments.updated_at`            |

Mesmo invariant que `orders BEFORE UPDATE`: sync ANTES de updated_at.

### `public.consultant_transfers` BEFORE UPDATE

| #   | Trigger                                  | Função SQL                           | Migração | Papel              |
| --- | ---------------------------------------- | ------------------------------------ | -------- | ------------------ |
| 1   | `handle_updated_at_consultant_transfers` | `handle_updated_at()`                | 004      | Touch `updated_at` |
| 2   | `trg_money_sync_consultant_transfers`    | `_money_sync_consultant_transfers()` | 050      | Sync cents↔numeric |

### `public.consultant_commissions` BEFORE UPDATE

| #   | Trigger                                    | Função SQL                             | Migração | Papel              |
| --- | ------------------------------------------ | -------------------------------------- | -------- | ------------------ |
| 1   | `handle_updated_at_consultant_commissions` | `handle_updated_at()`                  | 004      | Touch `updated_at` |
| 2   | `trg_money_sync_consultant_commissions`    | `_money_sync_consultant_commissions()` | 050      | Sync cents↔numeric |

> ⚠️ **Anomalia documentada (consultant\_\*)**: estes são os únicos
> buckets onde o updated*at-touch roda ANTES do money_sync (`h*` <
> `t*` alfabeticamente). Funcionalmente safe — `handle_updated_at`
> não mexe em colunas money — mas é uma divergência da convenção
> aplicada em `orders` e `payments`. **Follow-up sugerido**: renomear
> `handle_updated_at*_`para`trg\__\_updated_at` (cosmético, alinha
> com o padrão e auto-corrige a ordem), próxima onda manutenção.
>
> Os triggers `handle_updated_at_*` estão grandfathered da convenção
> de prefix `trg_*` em `tests/unit/migrations/trigger-order.test.ts`
> via `PREFIX_CONVENTION_GRANDFATHERED`. Mesmo destino para os 3
> triggers `audit_logs_*` (mig-046) que usam suffix `_trg`.

---

## Inventário de triggers em hot-path tables (single-trigger)

Tabelas onde só há um trigger no bucket, mas que entram no contrato
de auditoria deste documento:

| Tabela                        | Timing+evento             | Trigger                               | Função                               | Migração |
| ----------------------------- | ------------------------- | ------------------------------------- | ------------------------------------ | -------- |
| `public.payments`             | BEFORE INSERT             | `trg_money_sync_payments`             | `_money_sync_payments()`             | 050      |
| `public.commissions`          | BEFORE INSERT/UPDATE OF $ | `trg_money_sync_commissions`          | `_money_sync_commissions()`          | 050      |
| `public.transfers`            | BEFORE UPDATE             | `trg_transfers_updated_at`            | `set_updated_at()`                   | 002      |
| `public.consultant_transfers` | BEFORE INSERT             | `trg_money_sync_consultant_transfers` | `_money_sync_consultant_transfers()` | 050      |
| `public.audit_logs`           | BEFORE INSERT             | `audit_logs_chain_trg`                | `audit_logs_chain_before_insert()`   | 046      |
| `public.audit_logs`           | BEFORE UPDATE             | `audit_logs_prevent_update_trg`       | `audit_logs_prevent_mutation()`      | 046      |
| `public.audit_logs`           | BEFORE DELETE             | `audit_logs_prevent_delete_trg`       | `audit_logs_prevent_mutation()`      | 046      |

> "OF $" = lista de colunas específicas, omitida por brevidade.
> Ver `supabase/migrations/050_money_cents.sql` para a lista exata
> por tabela.

---

## Convenção de naming — `trg_*` lexical

Para que ordens críticas continuem **alfabeticamente derivadas**:

1. **Sempre `trg_` prefix.** Funções que viram triggers começam com
   `_` (ex: `_money_sync_*`); o trigger correspondente vem com `trg_`.

2. **Nomeie por papel + tabela.** Não por número de migração — refactors
   movem o número, e o nome viraria mentira. Ex: `trg_money_sync_orders`,
   não `trg_050_orders`.

3. **Ordem desejada → prefixo alfabético cuidadoso.** Se a tabela já tem
   `trg_money_sync_X` (deriva cents) e você precisa adicionar um trigger
   que rode **depois** dele, escolha um prefixo > `trg_n*`. Os existentes
   `trg_o*` (`order_items_freeze_price`) e `trg_t*` (`transfers_*`) já
   reservam esse espaço — bom sinal.

4. **Ordem desejada → prefixo numérico explícito (último recurso).**
   Se a clareza alfabética não for óbvia (ex: dois triggers de
   propósito gêmeo, ambos começando com `trg_a*`), use `trg_NN_papel`:

   ```sql
   CREATE TRIGGER trg_10_audit_first ...
   CREATE TRIGGER trg_20_audit_second ...
   ```

   `01_` … `99_` é a janela usada na convenção do projeto. Nenhum trigger
   atual usa numeric prefix; documente aqui se for o primeiro.

---

## Como inspecionar a ordem real em produção

Query introspectiva, idempotente, read-only. Roda contra Supabase
SQL Editor (super-admin) ou via `psql`:

```sql
-- Lista todos os triggers de tabelas em `public`, ordenados como
-- o PostgreSQL os executa: BY (table, timing, action_time, name).
SELECT
  c.relname                AS table_name,
  CASE
    WHEN t.tgtype::int & 2  = 2  THEN 'BEFORE'
    WHEN t.tgtype::int & 64 = 64 THEN 'INSTEAD_OF'
    ELSE 'AFTER'
  END                       AS timing,
  CASE
    WHEN t.tgtype::int & 4  = 4  THEN 'INSERT'
    WHEN t.tgtype::int & 8  = 8  THEN 'DELETE'
    WHEN t.tgtype::int & 16 = 16 THEN 'UPDATE'
    WHEN t.tgtype::int & 32 = 32 THEN 'TRUNCATE'
    ELSE '?'
  END                       AS event,
  t.tgname                  AS trigger_name,
  p.proname                 AS function_name,
  t.tgenabled               AS enabled
FROM pg_trigger t
JOIN pg_class      c ON c.oid = t.tgrelid
JOIN pg_namespace  n ON n.oid = c.relnamespace
JOIN pg_proc       p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, timing, event, t.tgname;
```

Saída esperada para `order_items` (linhas relevantes):

```
table_name  | timing  | event  | trigger_name                   | function_name
------------+---------+--------+--------------------------------+---------------------------------
order_items | BEFORE  | INSERT | trg_money_sync_order_items     | _money_sync_order_items
order_items | BEFORE  | INSERT | trg_order_items_freeze_price   | freeze_order_item_price
order_items | AFTER   | INSERT | trg_order_items_recalc_total   | recalc_order_total
```

(`trg_money_sync_order_items` também aparece com `event=UPDATE`
para a lista filtrada de colunas — comportamento pretendido.)

---

## Como adicionar um novo trigger sem quebrar a cadeia

Checklist em PR que toque triggers de `order_items`, `orders` ou
`payments`:

1. ☐ Decidir **timing/evento** (BEFORE INSERT vs AFTER UPDATE etc).
2. ☐ Olhar §"Inventário canônico" e ver se a combinação já tem outros
   triggers.
3. ☐ Se tem outros: escolher o prefixo do nome para que a **ordem
   alfabética bata com a ordem desejada de execução**. Não adicione
   um trigger entre dois existentes em §"order_items BEFORE INSERT" —
   isso muda o estado da row e quebra o pipeline cents/freeze.
4. ☐ Atualizar §"Inventário canônico" deste arquivo.
5. ☐ Atualizar `tests/unit/migrations/trigger-order.test.ts` rodando
   `npx vitest run -u tests/unit/migrations/trigger-order.test.ts`
   para regerar o snapshot. Inspecionar o diff antes de commitar — se
   a ordem mudou em uma tabela já listada como crítica, **PARE** e
   reabra a discussão.
6. ☐ Adicionar comentário no `CREATE TRIGGER` referenciando este
   documento:
   ```sql
   -- Ordem alfabética: ver docs/database/trigger-order.md
   --   ordem em order_items BEFORE INSERT:
   --     1. trg_money_sync_order_items
   --     2. trg_order_items_freeze_price
   --     3. trg_NEW_AQUI  (← este)
   CREATE TRIGGER trg_NEW_AQUI ...
   ```

---

## Por que NÃO temos uma assertion de runtime ainda

Considerou-se uma migration `085_assert_trigger_order.sql` que faria
um `RAISE EXCEPTION` se a ordem real divergir da expected. Decisão
de **não implementar agora**:

- Plataforma ainda em fase de testes (não comercial). Bloquear deploy
  via SQL assertion é overkill antes do primeiro pedido real.
- Custo: cada migration nova rodaria a assertion → custo CI dobra
  para schema-drift.
- Benefício marginal: o teste estático em
  `tests/unit/migrations/trigger-order.test.ts` cobre o vetor de
  regressão (alguém edita uma migration e muda a ordem).

**Trigger para reabrir a decisão**: primeira venda real OU primeira
contratação de devs paralelos (perde-se o "1 humano = 1 cabeça").
Adicionar nesse momento como mig `0XX_assert_trigger_order.sql`.

---

## Links

- ADR pertinente: docs/decisions/ (não há ADR dedicado; documentação
  vive aqui)
- Runbook que depende dessa ordem:
  [`docs/runbooks/money-drift.md`](../runbooks/money-drift.md)
- Migrações canônicas:
  - 008 — primeira `freeze_order_item_price` + `recalc_order_total`
  - 027 — adiciona aplicação de cupom à freeze
  - 050 — instala todos os `trg_money_sync_*`
  - 061 — fix do branch UPDATE do `_money_sync_order_items`
  - 067 — fix do INSERT branch (caso histórico que motivou esta doc)
  - 072 — branch TIERED_PROFILE em freeze_order_item_price
  - 080 — defesa contra cupom de tipo novo em produto FIXED
- Skill relacionada:
  [`.cursor/skills/money-drift/SKILL.md`](../../.cursor/skills/money-drift/SKILL.md)

---

_Última auditoria: 2026-05-06 — Pre-mortem A5 (Wave Pre-Launch S1)._
