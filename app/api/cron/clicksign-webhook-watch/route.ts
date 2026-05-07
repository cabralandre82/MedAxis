/**
 * GET /api/cron/clicksign-webhook-watch — Pre-Launch Onda S2 / T4.
 *
 * Watchdog do canal de webhook Clicksign. Roda a cada 15 minutos,
 * tira foto da saúde do canal e exporta gauges para o Grafana
 * (via push pipeline T6).
 *
 * Este cron é READ-ONLY — não muda estado nenhum. Sua função é
 * apenas EXPOR sinais para que regras Prometheus/Grafana decidam
 * acionar `ClicksignWebhookSilent` quando:
 *
 *   `clicksign_webhook_last_received_age_seconds > 21600 (6h)
 *    AND clicksign_pending_contracts_aged > 0`
 *
 * O canal de webhook silencioso por > 6h enquanto há contratos
 * aguardando assinatura há > 6h é o sinal forte de
 * `CLICKSIGN_WEBHOOK_SECRET` caído ou portal Clicksign desconfigurado.
 *
 * Schedule entry: `*\/15 * * * *` em `vercel.json`.
 *
 * Outcomes (label do counter `clicksign_watch_total{outcome}`):
 *   - `ok`                   : recebeu webhook nas últimas 24h
 *   - `silent_no_pending`    : 0 webhooks 24h, 0 contratos esperando — normal em pre-launch
 *   - `silent_with_pending`  : 0 webhooks 24h, > 0 contratos esperando há > 6h — investigar
 *   - `error`                : falha de query/conexão
 *
 * Runbook: `docs/runbooks/clicksign-webhook-silent.md`.
 */

import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, setGauge, Metrics } from '@/lib/metrics'
import { runClicksignWatch } from '@/lib/contracts/clicksign-watch'

export const GET = withCronGuard(
  'clicksign-webhook-watch',
  async () => {
    const snap = await runClicksignWatch()

    setGauge(Metrics.CLICKSIGN_WATCH_LAST_RUN_TS, Math.floor(Date.now() / 1000))
    setGauge(Metrics.CLICKSIGN_WEBHOOK_RECEIVED_COUNT_24H, snap.receivedCount24h)
    setGauge(Metrics.CLICKSIGN_WEBHOOK_RECEIVED_COUNT_7D, snap.receivedCount7d)
    setGauge(Metrics.CLICKSIGN_PENDING_CONTRACTS_AGED, snap.pendingContractsAged)
    setGauge(Metrics.CLICKSIGN_PENDING_CONTRACTS_TOTAL, snap.pendingContractsTotal)

    // Distinguir "nunca recebeu" (-1) de "acabou de receber" (0). Sem
    // sentinel, ambos virariam 0 e o alerta `last_received_age >
    // threshold` jamais dispararia em ambiente fresh — falso negativo
    // que mascararia o problema exato que o T4 tenta evitar.
    setGauge(Metrics.CLICKSIGN_WEBHOOK_LAST_RECEIVED_AGE_SECONDS, snap.lastReceivedAgeSeconds ?? -1)

    // O contador no cron é redundante com `clicksign_webhook_total{outcome}`
    // do handler — eles medem coisas diferentes. O do handler conta
    // delivery individual; este conta cada FOTO do canal. Ambos têm
    // valor: o do handler vê granularidade, este vê uptime.
    incCounter('clicksign_watch_total', { outcome: snap.outcome })

    if (snap.outcome === 'silent_with_pending') {
      // Já é warn no log via runClicksignWatch(). Aqui só evidenciamos
      // no return value para `/server-logs` mostrar o "result" no row.
      return { ok: false, snap }
    }
    if (snap.outcome === 'error') {
      logger.error('[clicksign-watch] cron failed snapshot', {
        detail: snap.detail,
      })
      return { ok: false, snap }
    }

    logger.info('[clicksign-watch] snapshot ok', {
      outcome: snap.outcome,
      receivedCount24h: snap.receivedCount24h,
      pendingContractsAged: snap.pendingContractsAged,
      lastReceivedAgeSeconds: snap.lastReceivedAgeSeconds,
    })
    return { ok: true, snap }
  },
  { ttlSeconds: 300 }
)

export const POST = GET
