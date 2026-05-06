// @vitest-environment node
/**
 * Pre-Launch Onda S1 / A5 — Trigger order regression test.
 *
 * Why this test exists
 * --------------------
 * PostgreSQL fires triggers of the same timing/event in **alphabetical
 * order of trigger name** (`pg_trigger.tgname` ascending). On
 * `public.order_items` BEFORE INSERT we have two triggers whose order
 * matters:
 *
 *   1. `trg_money_sync_order_items`     — derives `*_cents`
 *   2. `trg_order_items_freeze_price`   — applies coupon/tier, rewrites
 *                                          numeric+cents
 *
 * Migration 067 documents the historical bug where this exact ordering
 * was assumed implicitly. If anyone adds a trigger to `order_items` that
 * sorts between `trg_m*` and `trg_o*` (e.g. `trg_n_validate`), the
 * ledger snapshot of cents will lag the numeric write and the next
 * money-reconcile cron will scream — but only AFTER orders break in
 * production. This test prevents that.
 *
 * What we check
 * -------------
 *   1. Static parse of every `supabase/migrations/*.sql`, extract every
 *      `CREATE [OR REPLACE] TRIGGER ... ON public.X` block.
 *   2. For tables explicitly listed below, confirm:
 *      - the set of triggers expected in each (timing, event) bucket
 *        matches reality;
 *      - the EXPECTED order for hot-path tables is alphabetical and
 *        matches the documented order in
 *        `docs/database/trigger-order.md`.
 *   3. Soft check: every trigger in a hot-path bucket has a `trg_`
 *      prefix (project naming convention).
 *
 * What we do NOT check
 * --------------------
 *   - We do NOT connect to a live Postgres. CI does not have a managed
 *     Postgres; schema-drift workflow has its own ephemeral DB and
 *     could be extended later if needed (item A5b in the post-mortem
 *     follow-up list).
 *   - We do NOT enforce timing/event mismatch — that's caught by the
 *     migrations themselves at apply time.
 *
 * Updating this test
 * ------------------
 * If a PR legitimately adds/changes a trigger on a hot-path table:
 *   1. Update `docs/database/trigger-order.md` first (human-readable
 *      truth).
 *   2. Update `EXPECTED_TRIGGERS_HOT_PATH` below.
 *   3. Re-run `npx vitest run tests/unit/migrations/trigger-order.test.ts`.
 *   4. Inspect the diff — if the order in a critical bucket changed,
 *      think twice.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations')

interface TriggerDecl {
  name: string
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD_OF'
  events: ReadonlyArray<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>
  table: string
  migration: string
}

/**
 * Strip dollar-quoted bodies (`$$...$$`, `$body$...$body$`) from SQL so
 * that example DDL inside function bodies / comments inside
 * `RAISE NOTICE` strings doesn't trip the trigger parser.
 *
 * Conservative: matches `$tag$ ... $tag$` non-greedy; only the body
 * between matching tags is removed. Outer SQL (where DDL lives)
 * is preserved.
 */
function stripDollarQuotes(sql: string): string {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '$$$1$$/* stripped */ $$$1$$')
}

/**
 * Parse `CREATE [OR REPLACE] TRIGGER` declarations from one migration
 * file. Returns one entry per `(name, timing, event)` — multi-event
 * triggers (`INSERT OR UPDATE OR DELETE`) get expanded into multiple
 * entries so each (timing, event) bucket sees them.
 *
 * Returns ALL declarations (including `auth.*`, `extensions.*`); the
 * caller filters by schema. We scan all schemas because trigger
 * mistakes on `auth.users` matter too — but our hot-path inventory
 * focuses on `public.*`.
 */
function parseTriggers(sql: string, file: string): TriggerDecl[] {
  const cleaned = stripDollarQuotes(sql)
  // Match the prologue. We allow the events blob to span multiple
  // lines (mig-050 declares column lists across newlines), but we
  // anchor the trailing context with `ON <table> FOR EACH ROW` so
  // the parser cannot greedily eat through multiple CREATE TRIGGER
  // statements. Every legitimate trigger in this project uses
  // FOR EACH ROW — statement-level triggers would need a separate
  // pass.
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]+?)\s+ON\s+((?:\w+\.)?\w+)\s+FOR\s+EACH\s+ROW/gi
  const out: TriggerDecl[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1]
    const timing = m[2].toUpperCase().replace(/\s+/g, '_') as TriggerDecl['timing']
    const eventBlob = m[3]
    const rawTable = m[4]
    // Normalize: keep only `public.*` (the only schema we govern in
    // the hot-path inventory). `auth.*` triggers exist and matter,
    // but they live in a Supabase-managed schema and aren't part of
    // this contract.
    if (!rawTable.startsWith('public.') && !/^[a-z_][a-z_0-9]*$/i.test(rawTable)) continue
    const table = rawTable.startsWith('public.') ? rawTable.slice('public.'.length) : null
    if (!table) continue
    const verbs: TriggerDecl['events'][number][] = []
    for (const token of eventBlob.split(/\s+OR\s+|\s*,\s*/i)) {
      const verb = token.trim().toUpperCase().split(/\s+/)[0]
      if (verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE' || verb === 'TRUNCATE') {
        if (!verbs.includes(verb)) verbs.push(verb)
      }
    }
    if (verbs.length === 0) continue
    out.push({ name, timing, events: verbs, table, migration: file })
  }
  return out
}

/**
 * Find every `DROP TRIGGER [IF EXISTS] name ON public.table` in the
 * migration. Each pair removes a previously-declared trigger from the
 * inventory — the migration timeline is replayed in lexical order, so
 * a later DROP wipes an earlier CREATE.
 */
function parseDropTriggers(sql: string): Array<{ name: string; table: string }> {
  const cleaned = stripDollarQuotes(sql)
  const re = /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+public\.(\w+)/gi
  const out: Array<{ name: string; table: string }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    out.push({ name: m[1], table: m[2] })
  }
  return out
}

/**
 * Scan every migration in lexical order (which is also chronological)
 * and build the LATEST declaration for each `(table, trigger name)`
 * pair, replaying CREATE / DROP statements in order.
 *
 *   - `CREATE OR REPLACE TRIGGER` overrides an earlier CREATE.
 *   - `DROP TRIGGER [IF EXISTS]` removes the entry entirely.
 *
 * The result reflects the live state assuming every migration has
 * been applied in numerical order, which is the contract for
 * production (migrations are append-only per AGENTS.md §2).
 */
function buildInventory(): Map<string, TriggerDecl> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const map = new Map<string, TriggerDecl>()
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
    // DDL statements within a single migration may DROP and re-CREATE
    // a trigger. We process them in source order so the local replay
    // mirrors what Postgres sees during the migration. We do this by
    // scanning the file once for a chronological list of statements.
    const stmts = chronologicalDdl(sql)
    for (const stmt of stmts) {
      if (stmt.kind === 'create') {
        for (const decl of parseTriggers(stmt.sql, file)) {
          map.set(`${decl.table}::${decl.name}`, decl)
        }
      } else {
        for (const drop of parseDropTriggers(stmt.sql)) {
          map.delete(`${drop.table}::${drop.name}`)
        }
      }
    }
  }
  return map
}

/**
 * Split a migration into a chronological list of CREATE-vs-DROP TRIGGER
 * statement chunks. Anything else passes through under the `create`
 * key (the parser ignores non-trigger statements anyway). Used so that
 * `DROP TRIGGER ...; CREATE TRIGGER ...;` in the same file replays in
 * the right order.
 */
function chronologicalDdl(sql: string): Array<{ kind: 'create' | 'drop'; sql: string }> {
  const cleaned = stripDollarQuotes(sql)
  const out: Array<{ kind: 'create' | 'drop'; sql: string }> = []
  // We split on every `CREATE [OR REPLACE] TRIGGER ... FOR EACH ROW
  // ...;` and `DROP TRIGGER ... ON ...;` boundary, preserving the
  // statement in the chunk. Bounding the CREATE non-greedy on
  // `EXECUTE FUNCTION ... ;` (every Postgres trigger ends that way)
  // prevents over-matching across siblings.
  const re =
    /(CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER[\s\S]+?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+[\w.()]+\s*;)|(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?\w+\s+ON\s+(?:\w+\.)?\w+\s*;)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1]) out.push({ kind: 'create', sql: m[1] })
    else if (m[2]) out.push({ kind: 'drop', sql: m[2] })
  }
  return out
}

interface Bucket {
  /** Triggers expected in this (table, timing, event) bucket, in execution order. */
  triggers: ReadonlyArray<string>
  /** Why this bucket is order-sensitive (free text for human review). */
  rationale: string
}

/**
 * Hot-path expected order. Buckets with >1 trigger live here.
 *
 * Updating this constant requires updating
 * `docs/database/trigger-order.md` in the same PR — the test below
 * verifies the documentation file references each trigger name.
 *
 * The order in `triggers` IS the alphabetical sort that PostgreSQL
 * follows. We hardcode it here so a regression (someone adds a
 * trigger that sorts between two existing ones) flips this test red.
 */
const EXPECTED_TRIGGERS_HOT_PATH: Record<string, Record<string, Bucket>> = {
  order_items: {
    'BEFORE INSERT': {
      triggers: ['trg_money_sync_order_items', 'trg_order_items_freeze_price'],
      rationale:
        'mig-067 cicatriz histórica: money_sync deriva *_cents PRIMEIRO; ' +
        'freeze APLICA cupom/tier e reescreve numeric+cents. Ambos triggers ' +
        'permanecem ativos. O fix da mig-067 foi tornar a função freeze ' +
        'auto-suficiente (escreve cents que ela mesma calcula), portanto ' +
        'a re-derivação de cents do money_sync no início é inerte para o ' +
        'caso comum, mas continua sendo a primeira linha de defesa para ' +
        'INSERTs sem cupom (onde freeze é idempotente).',
    },
  },
  orders: {
    'BEFORE INSERT': {
      // m < o alphabetically — money_sync derives cents first, then
      // generate_code stamps the human-friendly order.code. Generate-code
      // doesn't touch money columns, so the order is functionally OK
      // — but documenting it pins the invariant.
      triggers: ['trg_money_sync_orders', 'trg_orders_generate_code'],
      rationale:
        'money_sync derives *_cents from total_price; orders_generate_code ' +
        'stamps a human-readable code. Order is alphabetical by name. ' +
        'A new trigger between m and o would risk seeing partially-derived ' +
        'cents on read-back.',
    },
    'BEFORE UPDATE': {
      triggers: ['trg_money_sync_orders', 'trg_orders_updated_at'],
      rationale:
        'money_sync runs first to keep cents in lock-step with numeric on ' +
        'partial-column UPDATEs (mig-061 fix). updated_at touch fires after — ' +
        'if reversed, updated_at would still be the same row state but the ' +
        'cents column would lag a transaction.',
    },
  },
  payments: {
    'BEFORE UPDATE': {
      triggers: ['trg_money_sync_payments', 'trg_payments_updated_at'],
      rationale:
        'Same pattern as orders BEFORE UPDATE — sync cents first, ' + 'then touch updated_at.',
    },
  },
  consultant_transfers: {
    'BEFORE UPDATE': {
      triggers: ['handle_updated_at_consultant_transfers', 'trg_money_sync_consultant_transfers'],
      rationale:
        'Order here is `h*` < `t*`: updated_at touch FIRST, then money_sync. ' +
        'This deviates from the orders/payments pattern — flagged for follow-up. ' +
        'On consultant_transfers the handle_updated_at trigger does NOT touch ' +
        'money columns (only updated_at), so the order is functionally safe. ' +
        'A future refactor should rename handle_updated_at_* to align with the ' +
        'trg_*_updated_at convention used in orders/payments, which would also ' +
        'auto-fix the alphabetical order to money_sync first.',
    },
  },
  consultant_commissions: {
    'BEFORE UPDATE': {
      triggers: [
        'handle_updated_at_consultant_commissions',
        'trg_money_sync_consultant_commissions',
      ],
      rationale:
        'Same anomaly as consultant_transfers BEFORE UPDATE. ' +
        'Functionally safe — handle_updated_at only touches updated_at — ' +
        'but cosmetic refactor to rename triggers will auto-fix the ' +
        'order to money_sync first.',
    },
  },
}

/**
 * Triggers grandfathered out of the `trg_` prefix convention.
 * These predate the convention (mig-004 family) and renaming them
 * would require a coordinated migration. Tracked as follow-up in
 * `docs/database/trigger-order.md`.
 */
const PREFIX_CONVENTION_GRANDFATHERED = new Set([
  'handle_updated_at_consultant_commissions',
  'handle_updated_at_consultant_transfers',
  'audit_logs_chain_trg',
  'audit_logs_prevent_update_trg',
  'audit_logs_prevent_delete_trg',
])

/**
 * Single-trigger hot-path tables. Each (table, timing, event) bucket
 * must contain EXACTLY this trigger; any addition flips this test red.
 */
const EXPECTED_TRIGGERS_HOT_PATH_SINGLE: Record<
  string,
  Record<string, { trigger: string; rationale: string }>
> = {
  payments: {
    'BEFORE INSERT': {
      trigger: 'trg_money_sync_payments',
      rationale: 'Money sync for payments.gross_amount{,_cents}.',
    },
  },
  consultant_transfers: {
    'BEFORE INSERT': {
      trigger: 'trg_money_sync_consultant_transfers',
      rationale: 'Money sync for consultant_transfers.gross_amount{,_cents}.',
    },
  },
  audit_logs: {
    'BEFORE INSERT': {
      trigger: 'audit_logs_chain_trg',
      rationale: 'Hash chain for tamper detection (mig-046).',
    },
    'BEFORE UPDATE': {
      trigger: 'audit_logs_prevent_update_trg',
      rationale: 'Append-only enforcement.',
    },
    'BEFORE DELETE': {
      trigger: 'audit_logs_prevent_delete_trg',
      rationale: 'Append-only enforcement.',
    },
  },
}

// ── tests ────────────────────────────────────────────────────────────────

describe('trigger-order: parser sanity', () => {
  const inv = buildInventory()

  it('parses at least the well-known hot-path triggers', () => {
    const names = new Set([...inv.values()].map((d) => d.name))
    // Spot-check a handful of triggers we know exist. If the parser
    // breaks (e.g. someone refactors migration formatting), these
    // assertions catch it before the structural tests run.
    expect(names.has('trg_money_sync_orders')).toBe(true)
    expect(names.has('trg_money_sync_order_items')).toBe(true)
    expect(names.has('trg_order_items_freeze_price')).toBe(true)
    expect(names.has('trg_order_items_recalc_total')).toBe(true)
    expect(names.has('trg_money_sync_payments')).toBe(true)
    expect(names.has('audit_logs_chain_trg')).toBe(true)
  })

  it('every parsed trigger has a non-empty events list', () => {
    for (const decl of inv.values()) {
      expect(decl.events.length, `${decl.name} on ${decl.table}`).toBeGreaterThan(0)
    }
  })
})

describe('trigger-order: hot-path multi-trigger buckets (where order matters)', () => {
  const inv = buildInventory()

  // Group by (table, timing+event) for downstream assertions. We expand
  // multi-event triggers so a `BEFORE INSERT OR UPDATE` shows up in
  // both `BEFORE INSERT` and `BEFORE UPDATE` buckets.
  type BucketKey = string // `${table}|${timing} ${event}`
  const buckets = new Map<BucketKey, string[]>()
  for (const decl of inv.values()) {
    for (const event of decl.events) {
      const key = `${decl.table}|${decl.timing} ${event}`
      const arr = buckets.get(key) ?? []
      // Sorted insertion = same alphabetical order Postgres uses.
      const idx = arr.findIndex((n) => n.localeCompare(decl.name) > 0)
      if (idx === -1) arr.push(decl.name)
      else arr.splice(idx, 0, decl.name)
      buckets.set(key, arr)
    }
  }

  for (const [tableKey, perBucket] of Object.entries(EXPECTED_TRIGGERS_HOT_PATH)) {
    for (const [timingEventKey, expected] of Object.entries(perBucket)) {
      it(`${tableKey} ${timingEventKey} — exact order: ${expected.triggers.join(' → ')}`, () => {
        const actual = buckets.get(`${tableKey}|${timingEventKey}`) ?? []
        expect(
          actual,
          `Expected exactly the documented triggers in this bucket. ` +
            `Reason this bucket is order-sensitive: ${expected.rationale}. ` +
            `If this assertion fails because you added a new trigger, ` +
            `update both EXPECTED_TRIGGERS_HOT_PATH in this file AND ` +
            `docs/database/trigger-order.md.`
        ).toEqual([...expected.triggers])
      })

      it(`${tableKey} ${timingEventKey} — every trigger uses trg_ prefix convention`, () => {
        const actual = buckets.get(`${tableKey}|${timingEventKey}`) ?? []
        for (const name of actual) {
          if (PREFIX_CONVENTION_GRANDFATHERED.has(name)) continue
          expect(
            name.startsWith('trg_'),
            `Trigger "${name}" on ${tableKey} ${timingEventKey} must use trg_ prefix ` +
              `(see docs/database/trigger-order.md §"Convenção de naming"). ` +
              `If this is a legacy trigger that pre-dates the convention, add it to ` +
              `PREFIX_CONVENTION_GRANDFATHERED in this test and document the debt.`
          ).toBe(true)
        }
      })
    }
  }
})

describe('trigger-order: hot-path single-trigger buckets', () => {
  const inv = buildInventory()
  type BucketKey = string
  const buckets = new Map<BucketKey, string[]>()
  for (const decl of inv.values()) {
    for (const event of decl.events) {
      const key = `${decl.table}|${decl.timing} ${event}`
      const arr = buckets.get(key) ?? []
      const idx = arr.findIndex((n) => n.localeCompare(decl.name) > 0)
      if (idx === -1) arr.push(decl.name)
      else arr.splice(idx, 0, decl.name)
      buckets.set(key, arr)
    }
  }

  for (const [tableKey, perBucket] of Object.entries(EXPECTED_TRIGGERS_HOT_PATH_SINGLE)) {
    for (const [timingEventKey, expected] of Object.entries(perBucket)) {
      it(`${tableKey} ${timingEventKey} — exactly one trigger: ${expected.trigger}`, () => {
        const actual = buckets.get(`${tableKey}|${timingEventKey}`) ?? []
        expect(
          actual.length,
          `Expected exactly one trigger here. Rationale: ${expected.rationale}. ` +
            `If you intentionally added a sibling trigger, move this entry into ` +
            `EXPECTED_TRIGGERS_HOT_PATH (multi-trigger bucket) and document the ` +
            `order in docs/database/trigger-order.md.`
        ).toBe(1)
        expect(actual[0]).toBe(expected.trigger)
      })
    }
  }
})

describe('trigger-order: documentation cross-check', () => {
  const docPath = resolve(__dirname, '../../../docs/database/trigger-order.md')
  const doc = readFileSync(docPath, 'utf8')

  for (const [table, perBucket] of Object.entries(EXPECTED_TRIGGERS_HOT_PATH)) {
    for (const [, expected] of Object.entries(perBucket)) {
      for (const trg of expected.triggers) {
        it(`docs/database/trigger-order.md mentions ${trg} (table ${table})`, () => {
          expect(
            doc.includes(trg),
            `${trg} is in EXPECTED_TRIGGERS_HOT_PATH for ${table} but not in ` +
              `docs/database/trigger-order.md. The doc must be the human-readable ` +
              `truth — update it before the test.`
          ).toBe(true)
        })
      }
    }
  }

  for (const [table, perBucket] of Object.entries(EXPECTED_TRIGGERS_HOT_PATH_SINGLE)) {
    for (const [, expected] of Object.entries(perBucket)) {
      it(`docs/database/trigger-order.md mentions ${expected.trigger} (table ${table})`, () => {
        expect(doc.includes(expected.trigger)).toBe(true)
      })
    }
  }
})
