// @vitest-environment node
/**
 * Unit tests for `lib/observability/grafana-push`.
 *
 * Coverage targets:
 *   - resolveConfig: skipped_no_env when any env missing
 *   - snapshotToTimeseries: counters, gauges, histograms (5 series each),
 *     base labels merged, sanitization of bad label keys, value slicing
 *   - pushMetricsToGrafana: success path, HTTP 4xx/5xx, network throw,
 *     skipped_empty, skipped_no_env
 *
 * We mock `prometheus-remote-write` so no actual HTTP happens. We
 * also mock `lib/metrics.snapshotMetrics` to control the snapshot
 * deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const PROD_ENV = {
  GRAFANA_REMOTE_WRITE_URL: 'https://prom-test.grafana.net/api/prom/push',
  GRAFANA_REMOTE_WRITE_USERNAME: '999999',
  GRAFANA_REMOTE_WRITE_TOKEN: 'glc_fake_token',
  VERCEL_ENV: 'production',
  VERCEL_REGION: 'gru1',
}

const pushTimeseriesMock = vi.fn()
const snapshotMetricsMock = vi.fn()

vi.mock('prometheus-remote-write', () => ({
  pushTimeseries: (...args: unknown[]) => pushTimeseriesMock(...args),
}))

vi.mock('@/lib/metrics', () => ({
  snapshotMetrics: () => snapshotMetricsMock(),
}))

let originalEnv: typeof process.env

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
}

beforeEach(() => {
  originalEnv = { ...process.env }
  pushTimeseriesMock.mockReset()
  snapshotMetricsMock.mockReset()
  // Default: empty snapshot so each test must opt into samples.
  snapshotMetricsMock.mockReturnValue({ counters: [], gauges: [], histograms: [] })
  // Clear push-related envs so each test sets explicitly.
  delete process.env.GRAFANA_REMOTE_WRITE_URL
  delete process.env.GRAFANA_REMOTE_WRITE_USERNAME
  delete process.env.GRAFANA_REMOTE_WRITE_TOKEN
})

afterEach(() => {
  process.env = originalEnv
})

describe('snapshotToTimeseries', () => {
  it('emits one series per counter, with base + custom labels merged', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [
        {
          name: 'orders_created_total',
          labels: { tenant: 'clinic-1', method: 'PIX' },
          value: 12,
          updatedAt: 1_700_000_000_000,
        },
      ],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries(1_700_000_000_000)

    expect(ts).toHaveLength(1)
    expect(ts[0].labels.__name__).toBe('orders_created_total')
    expect(ts[0].labels.service).toBe('clinipharma')
    expect(ts[0].labels.env).toBe('production')
    expect(ts[0].labels.region).toBe('gru1')
    expect(ts[0].labels.tenant).toBe('clinic-1')
    expect(ts[0].labels.method).toBe('PIX')
    expect(ts[0].samples).toEqual([{ value: 12, timestamp: 1_700_000_000_000 }])
  })

  it('emits one series per gauge', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [],
      gauges: [
        {
          name: 'asaas_reconcile_last_run_ts',
          labels: {},
          value: 1_700_000_001,
          updatedAt: 1_700_000_001_000,
        },
      ],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()

    expect(ts).toHaveLength(1)
    expect(ts[0].labels.__name__).toBe('asaas_reconcile_last_run_ts')
    expect(ts[0].samples[0].value).toBe(1_700_000_001)
  })

  it('expands each histogram into 5 series (count, sum, p50, p95, p99)', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [],
      gauges: [],
      histograms: [
        {
          name: 'http_request_duration_ms',
          labels: { route: '/api/orders' },
          count: 100,
          sum: 12345,
          min: 10,
          max: 800,
          avg: 123.45,
          p50: 100,
          p95: 350,
          p99: 700,
          updatedAt: 1_700_000_000_000,
        },
      ],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries(1_700_000_000_000)

    expect(ts).toHaveLength(5)
    const names = ts.map((s) => s.labels.__name__)
    expect(names).toEqual([
      'http_request_duration_ms_count',
      'http_request_duration_ms_sum',
      'http_request_duration_ms_p50',
      'http_request_duration_ms_p95',
      'http_request_duration_ms_p99',
    ])
    // Every series carries the original route label.
    for (const s of ts) {
      expect(s.labels.route).toBe('/api/orders')
    }
    expect(ts[0].samples[0].value).toBe(100) // count
    expect(ts[1].samples[0].value).toBe(12345) // sum
    expect(ts[3].samples[0].value).toBe(350) // p95
  })

  it('sanitizes bad label keys to Prometheus regex', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [
        {
          name: 'weird_total',
          labels: { 'has-dash': 'a', '1starts-with-digit': 'b' },
          value: 1,
          updatedAt: 0,
        },
      ],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()

    expect(ts[0].labels['has_dash']).toBe('a')
    // Leading digit gets prefixed with `_`.
    expect(ts[0].labels['_1starts_with_digit']).toBe('b')
  })

  it('drops null/undefined label values', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [
        {
          name: 'with_nulls_total',
          labels: { a: 'value', b: null, c: undefined },
          value: 1,
          updatedAt: 0,
        },
      ],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()

    expect(ts[0].labels.a).toBe('value')
    expect(ts[0].labels.b).toBeUndefined()
    expect(ts[0].labels.c).toBeUndefined()
  })

  it('truncates label values longer than 200 chars', async () => {
    setEnv(PROD_ENV)
    const long = 'x'.repeat(500)
    snapshotMetricsMock.mockReturnValue({
      counters: [
        {
          name: 'long_label_total',
          labels: { huge: long },
          value: 1,
          updatedAt: 0,
        },
      ],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()
    expect(ts[0].labels.huge.length).toBe(200)
  })

  it('falls back to `unknown` when VERCEL_REGION absent', async () => {
    setEnv({ ...PROD_ENV, VERCEL_REGION: undefined })
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()
    expect(ts[0].labels.region).toBe('unknown')
  })

  it('coerces non-string label values to string', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [
        {
          name: 'x_total',
          labels: { count: 42, ok: true },
          value: 1,
          updatedAt: 0,
        },
      ],
      gauges: [],
      histograms: [],
    })

    const { snapshotToTimeseries } = await import('@/lib/observability/grafana-push')
    const ts = snapshotToTimeseries()
    expect(ts[0].labels.count).toBe('42')
    expect(ts[0].labels.ok).toBe('true')
  })
})

describe('pushMetricsToGrafana — env validation', () => {
  it('returns skipped_no_env when GRAFANA_REMOTE_WRITE_URL missing', async () => {
    setEnv({
      GRAFANA_REMOTE_WRITE_URL: undefined,
      GRAFANA_REMOTE_WRITE_USERNAME: '1',
      GRAFANA_REMOTE_WRITE_TOKEN: 't',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('skipped_no_env')
    expect(out.timeseriesCount).toBe(0)
    expect(pushTimeseriesMock).not.toHaveBeenCalled()
  })

  it('returns skipped_no_env when token missing', async () => {
    setEnv({
      GRAFANA_REMOTE_WRITE_URL: 'https://x.grafana.net/api/prom/push',
      GRAFANA_REMOTE_WRITE_USERNAME: '1',
      GRAFANA_REMOTE_WRITE_TOKEN: undefined,
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()
    expect(out.outcome).toBe('skipped_no_env')
  })

  it('returns skipped_no_env when username missing', async () => {
    setEnv({
      GRAFANA_REMOTE_WRITE_URL: 'https://x.grafana.net/api/prom/push',
      GRAFANA_REMOTE_WRITE_USERNAME: undefined,
      GRAFANA_REMOTE_WRITE_TOKEN: 't',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()
    expect(out.outcome).toBe('skipped_no_env')
  })
})

describe('pushMetricsToGrafana — push lifecycle', () => {
  it('returns skipped_empty when registry has zero samples', async () => {
    setEnv(PROD_ENV)
    // snapshotMetricsMock default already returns empty.

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('skipped_empty')
    expect(out.timeseriesCount).toBe(0)
    expect(pushTimeseriesMock).not.toHaveBeenCalled()
  })

  it('returns success when push returns HTTP 200', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      text: async () => '',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('success')
    expect(out.timeseriesCount).toBe(1)
    expect(out.httpStatus).toBe(200)
    expect(out.errorMessage).toBeUndefined()
    expect(pushTimeseriesMock).toHaveBeenCalledTimes(1)
  })

  it('returns success when push returns HTTP 204 (no content)', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('success')
    expect(out.httpStatus).toBe(204)
  })

  it('returns error when push returns HTTP 401 (auth)', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 401,
      statusText: 'Unauthorized',
      errorMessage: 'invalid credentials',
      text: async () => 'invalid credentials',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('error')
    expect(out.httpStatus).toBe(401)
    expect(out.errorMessage).toBe('invalid credentials')
  })

  it('returns error when push returns HTTP 429 (rate limit)', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => '',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('error')
    expect(out.httpStatus).toBe(429)
    expect(out.errorMessage).toContain('429')
  })

  it('returns error and does NOT throw when push rejects (network)', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockRejectedValueOnce(new Error('ECONNRESET'))

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('error')
    expect(out.errorMessage).toBe('ECONNRESET')
    expect(out.httpStatus).toBeUndefined()
  })

  it('handles non-Error rejection gracefully', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockRejectedValueOnce('weird-string-error')

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()

    expect(out.outcome).toBe('error')
    expect(out.errorMessage).toBe('weird-string-error')
  })

  it('passes Basic auth credentials in the push call', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      text: async () => '',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    await pushMetricsToGrafana()

    const call = pushTimeseriesMock.mock.calls[0]
    expect(call[1]).toMatchObject({
      url: PROD_ENV.GRAFANA_REMOTE_WRITE_URL,
      auth: {
        username: PROD_ENV.GRAFANA_REMOTE_WRITE_USERNAME,
        password: PROD_ENV.GRAFANA_REMOTE_WRITE_TOKEN,
      },
    })
    expect(call[1].fetch).toBeDefined()
  })

  it('records duration in result', async () => {
    setEnv(PROD_ENV)
    snapshotMetricsMock.mockReturnValue({
      counters: [{ name: 'x_total', labels: {}, value: 1, updatedAt: 0 }],
      gauges: [],
      histograms: [],
    })
    pushTimeseriesMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      text: async () => '',
    })

    const { pushMetricsToGrafana } = await import('@/lib/observability/grafana-push')
    const out = await pushMetricsToGrafana()
    expect(out.durationMs).toBeGreaterThanOrEqual(0)
    expect(out.durationMs).toBeLessThan(60_000)
  })
})
