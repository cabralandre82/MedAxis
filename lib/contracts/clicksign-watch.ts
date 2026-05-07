import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * Pre-Launch Onda S2 / T4 — Clicksign webhook watchdog.
 *
 * Tira foto da saúde do canal de webhook Clicksign e devolve gauges
 * crus para o cron transformar em métricas Prometheus. Read-only,
 * sem efeitos colaterais — quem decide se um número configura
 * incidente é o alerting layer (Grafana rules), não esta função.
 *
 * Por que existe
 * --------------
 * O Clicksign assina cada delivery com HMAC SHA-256 sobre o raw body
 * (header `Content-Hmac`). O handler atual em
 * `app/api/contracts/webhook/route.ts` retorna 401 quando a assinatura
 * falha — antes mesmo de gravar uma linha em `webhook_events`. Isso
 * significa que a tabela só vê deliveries QUE PASSARAM HMAC. Se o
 * `CLICKSIGN_WEBHOOK_SECRET` for rotacionado por engano (e nós
 * esquecermos de atualizar o portal Clicksign), TODOS os deliveries
 * voltarão silenciosamente como 401 e a plataforma não veria nada
 * diferente — um contrato em `PENDING_SIGNATURE` ficaria parado
 * indefinidamente.
 *
 * O T4 fecha esse buraco de 3 maneiras:
 *
 *   1. Visibilidade de volume: `received_count_24h` e
 *      `last_received_age_seconds` permitem alertas Grafana
 *      (`ClicksignWebhookSilent` → `last_received_age > 6h AND
 *      pending_contracts_aged > 0`).
 *
 *   2. Visibilidade de outcome: o handler é instrumentado em paralelo
 *      com `clicksign_webhook_total{outcome}` (não vem desta função;
 *      mora no próprio handler). Dispara `hmac_failed` se HMAC quebrar,
 *      `hmac_dev_bypass` quando o secret está vazio (deve ser zero em
 *      prod), `hmac_verified` no caminho feliz.
 *
 *   3. Sinal contra-baseline: contratos em `PENDING_SIGNATURE` há
 *      > 6h sem nenhum webhook recebido nas últimas 24h é um sinal
 *      forte de canal quebrado. É exatamente o que vai ao alerta.
 *
 * O que esta função decide:
 *   - como traduzir "última delivery clicksign" em segundos de
 *     idade (gauge),
 *   - como contar contratos esperando assinatura há > limiar (gauge),
 *   - como cuspir uma linha de log warn quando o cenário "0 webhooks
 *     em 24h E há contratos esperando" se manifesta (sinal P3 que o
 *     operador encontra direto em `/server-logs`, sem precisar abrir
 *     Grafana).
 *
 * O que esta função NÃO decide:
 *   - thresholds de alerta (vivem em
 *     `monitoring/prometheus/alerts.yml` ou diretamente em Grafana),
 *   - mitigation (runbook em `docs/runbooks/clicksign-webhook-silent.md`),
 *   - se a aplicação deve rejeitar novos contratos (não — o cron é
 *     read-only).
 */

/** Idade limite a partir da qual um contrato `awaiting_signature`
 * (status SENT ou VIEWED, isto é: enviado ao Clicksign mas ainda
 * sem evento `sign`/`auto_close`/`cancel`/`deadline`) conta como
 * "envelhecido" — esperando webhook há tempo suficiente para que a
 * ausência seja suspeita. Clicksign normalmente envia eventos de
 * progresso em minutos a horas; 6h sem nada é o limite empírico
 * para investigação.
 *
 * Status do schema (mig 042+) que indicam aguardando webhook:
 *   - SENT  : entregamos ao Clicksign, esperando primeiro evento
 *   - VIEWED: signatário abriu mas não assinou — esperando `sign`
 *
 * Status que NÃO contam:
 *   - PENDING  : rascunho local (ainda não foi pra Clicksign)
 *   - SIGNED, CANCELLED, EXPIRED : terminais
 */
const PENDING_AGED_THRESHOLD_HOURS = 6
const AWAITING_SIGNATURE_STATUSES = ['SENT', 'VIEWED']

export type WatchOutcome = 'ok' | 'silent_with_pending' | 'silent_no_pending' | 'error'

export interface ClicksignWatchSnapshot {
  outcome: WatchOutcome
  /** Total de deliveries Clicksign na tabela `webhook_events`
   * (independente do status — incluímos `processed`, `failed`, `duplicate`). */
  receivedCount24h: number
  receivedCount7d: number
  /** Idade em segundos do último delivery Clicksign na tabela. `null`
   * se nunca houve delivery (ambiente novo) — neste caso o cron emite
   * gauge = -1 para distinguir de 0 (acabou de chegar). */
  lastReceivedAgeSeconds: number | null
  /** Contratos cujo `status` ∈ {SENT, VIEWED} e cujo `created_at`
   * está mais antigo que `PENDING_AGED_THRESHOLD_HOURS` (= esperando
   * webhook há > 6h). */
  pendingContractsAged: number
  /** Total de contratos em SENT/VIEWED (não apenas envelhecidos). */
  pendingContractsTotal: number
  /** Free-form, usado pelo cron para decidir log severity. */
  detail?: string
}

/** Função pura testável: aceita admin client, devolve snapshot.
 *
 * Não joga exceções — em qualquer falha SQL, retorna `outcome: 'error'`
 * com `detail` populado. O cron decide log severity (warn/error). */
export async function snapshotClicksignWatch(opts?: {
  /** Permite injetar admin client em tests. Usa createAdminClient() por padrão. */
  adminClient?: ReturnType<typeof createAdminClient>
  /** Override do threshold de "envelhecido" para tests. */
  pendingAgedThresholdHours?: number
}): Promise<ClicksignWatchSnapshot> {
  const admin = opts?.adminClient ?? createAdminClient()
  const agedThresholdHours = opts?.pendingAgedThresholdHours ?? PENDING_AGED_THRESHOLD_HOURS

  // ── Webhook deliveries ────────────────────────────────────────────
  // Conta agregada nos últimos 24h e 7d. PostgREST não expõe SQL livre,
  // então lemos a tabela e contamos no client (volume é baixo, < 100/mês
  // em pre-launch). Para reduzir bytes, pegamos só `received_at`.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  let receivedCount24h = 0
  let receivedCount7d = 0
  let lastReceivedAgeSeconds: number | null = null
  let detail: string | undefined

  try {
    const { data: events, error } = await admin
      .from('webhook_events')
      .select('received_at')
      .eq('source', 'clicksign')
      .gte('received_at', sevenDaysAgo)
      .order('received_at', { ascending: false })
      .limit(1000)

    if (error) {
      return {
        outcome: 'error',
        receivedCount24h: 0,
        receivedCount7d: 0,
        lastReceivedAgeSeconds: null,
        pendingContractsAged: 0,
        pendingContractsTotal: 0,
        detail: `webhook_events query failed: ${error.message}`,
      }
    }

    const now = Date.now()
    const oneDayMs = 24 * 3600 * 1000
    for (const ev of events ?? []) {
      const ts = new Date(ev.received_at).getTime()
      if (now - ts <= oneDayMs) receivedCount24h++
      receivedCount7d++
      if (lastReceivedAgeSeconds === null) {
        lastReceivedAgeSeconds = Math.floor((now - ts) / 1000)
      }
    }

    // Se a tabela jamais teve delivery clicksign, tentamos uma query
    // sem `gte` para distinguir "nunca houve" de "houve mas mais que
    // 7 dias atrás".
    if (receivedCount7d === 0) {
      const { data: ever, error: everErr } = await admin
        .from('webhook_events')
        .select('received_at')
        .eq('source', 'clicksign')
        .order('received_at', { ascending: false })
        .limit(1)

      if (!everErr && ever && ever.length > 0) {
        lastReceivedAgeSeconds = Math.floor(
          (Date.now() - new Date(ever[0].received_at).getTime()) / 1000
        )
      }
    }
  } catch (err) {
    return {
      outcome: 'error',
      receivedCount24h: 0,
      receivedCount7d: 0,
      lastReceivedAgeSeconds: null,
      pendingContractsAged: 0,
      pendingContractsTotal: 0,
      detail: `webhook_events read threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // ── Contratos esperando assinatura ────────────────────────────────
  let pendingContractsTotal = 0
  let pendingContractsAged = 0
  const agedCutoff = new Date(Date.now() - agedThresholdHours * 3600 * 1000).toISOString()

  try {
    const { count: totalCount, error: totalErr } = await admin
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .in('status', AWAITING_SIGNATURE_STATUSES)

    if (totalErr) {
      return {
        outcome: 'error',
        receivedCount24h,
        receivedCount7d,
        lastReceivedAgeSeconds,
        pendingContractsAged: 0,
        pendingContractsTotal: 0,
        detail: `contracts total query failed: ${totalErr.message}`,
      }
    }
    pendingContractsTotal = totalCount ?? 0

    const { count: agedCount, error: agedErr } = await admin
      .from('contracts')
      .select('id', { count: 'exact', head: true })
      .in('status', AWAITING_SIGNATURE_STATUSES)
      .lte('created_at', agedCutoff)

    if (agedErr) {
      return {
        outcome: 'error',
        receivedCount24h,
        receivedCount7d,
        lastReceivedAgeSeconds,
        pendingContractsAged: 0,
        pendingContractsTotal,
        detail: `contracts aged query failed: ${agedErr.message}`,
      }
    }
    pendingContractsAged = agedCount ?? 0
  } catch (err) {
    return {
      outcome: 'error',
      receivedCount24h,
      receivedCount7d,
      lastReceivedAgeSeconds,
      pendingContractsAged: 0,
      pendingContractsTotal: 0,
      detail: `contracts read threw: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // ── Outcome decision ─────────────────────────────────────────────
  // "silent_with_pending" é o sinal forte que vai pra warn no log.
  // "silent_no_pending" é normal em pre-launch — sem contratos não há
  // webhooks; o operador pode silenciar mentalmente.
  let outcome: WatchOutcome
  if (receivedCount24h === 0 && pendingContractsAged > 0) {
    outcome = 'silent_with_pending'
    detail = `${pendingContractsAged} contrato(s) aguardando assinatura há > ${agedThresholdHours}h, 0 webhooks em 24h`
  } else if (receivedCount24h === 0 && pendingContractsTotal === 0) {
    outcome = 'silent_no_pending'
  } else {
    outcome = 'ok'
  }

  return {
    outcome,
    receivedCount24h,
    receivedCount7d,
    lastReceivedAgeSeconds,
    pendingContractsAged,
    pendingContractsTotal,
    detail,
  }
}

/** Convenience helper: snapshot + log apropriado para o cron consumir. */
export async function runClicksignWatch(): Promise<ClicksignWatchSnapshot> {
  const snap = await snapshotClicksignWatch()

  if (snap.outcome === 'silent_with_pending') {
    logger.warn('[clicksign-watch] webhook channel may be silent', {
      receivedCount24h: snap.receivedCount24h,
      receivedCount7d: snap.receivedCount7d,
      lastReceivedAgeSeconds: snap.lastReceivedAgeSeconds,
      pendingContractsAged: snap.pendingContractsAged,
      pendingContractsTotal: snap.pendingContractsTotal,
      detail: snap.detail,
    })
  } else if (snap.outcome === 'error') {
    logger.error('[clicksign-watch] snapshot failed', {
      detail: snap.detail,
    })
  }

  return snap
}
