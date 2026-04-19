# Status page — arquitetura e operação (Wave Hardening II #7)

> Documento técnico para SREs / on-call.
> A página pública vive em `/status`. Esta nota explica **como** ela é
> construída, **onde** os dados nascem, e **como conectar Grafana Cloud**
> quando estiver disponível.

---

## 1. Arquitetura

```
┌────────────────────────────┐
│  Browser (qualquer pessoa) │
│  GET /status               │
└──────────────┬─────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│ app/status/page.tsx                                           │
│  └─ <StatusBoard /> (client component)                        │
│       ├─ POLL  GET /api/health             (a cada 30 s)     │
│       └─ POLL  GET /api/status/summary     (a cada 60 s)     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ /api/health           — Wave 6                                │
│   - Snapshot AGORA: db, env, circuit breakers                 │
│   - Não tem histórico                                         │
│   - Auth: público                                             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ /api/status/summary   — Wave Hardening II #7                  │
│   - Cache: in-process 60 s + Edge s-maxage=60                 │
│   - Sempre 200 (degrada graciosamente)                        │
│   - Auth: público                                             │
│                                                               │
│   getStatusSummary()                                          │
│     │                                                         │
│     ▼                                                         │
│   pickSource()  ─── env GRAFANA_CLOUD_* set? ───┐            │
│     │              não                            │           │
│     │                                          sim│           │
│     ▼                                             ▼           │
│   InternalStatusSource                  GrafanaCloudStatus    │
│   (cron_runs + server_logs)             Source (Mimir + Inc.) │
└──────────────────────────────────────────────────────────────┘
```

Os dois polls são **independentes**: a página continua útil mesmo
quando uma das fontes degrada.

---

## 2. Fontes de dados

### 2.1 InternalStatusSource (default)

Implementação em `lib/status/internal-source.ts`. Calcula uptime e
incidentes a partir de tabelas que já existem:

| Componente público | Tabela        | Filtro                                      |
| ------------------ | ------------- | ------------------------------------------- | --------- | --------- | -------- |
| `app`              | `server_logs` | `level='error'`                             |
| `database`         | `cron_runs`   | `status='failed'` (qualquer cron toca DB)   |
| `auth`             | `server_logs` | `level='error' AND route LIKE '/api/auth%'` |
| `payments`         | `cron_runs`   | `status='failed' AND job_name ~ 'asaas      | reconcile | payment'` |
| `integrations`     | `cron_runs`   | `status='failed' AND job_name ~ 'webhook    | inngest   | zenvia    | resend'` |
| `cron`             | `cron_runs`   | `status='failed'` (qualquer)                |

Algoritmo (resumido):

1. Bucket horário em janela de 90 dias.
2. Slot é "ruim" quando `count > badThresholdPerHour`.
3. Uptime = `good / total`.
4. Incidente = sequência maximal de slots ruins.
5. Severidade = `<3h: minor`, `3–6h: major`, `≥6h: critical`.

### 2.2 GrafanaCloudStatusSource (opcional)

Implementação em `lib/status/grafana-cloud-source.ts`. Ativa
**automaticamente** quando estes envs estão presentes:

| Env                          | Obrigatório | Descrição                                                                                                     |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `GRAFANA_CLOUD_PROM_URL`     | sim         | URL do endpoint Mimir/Prom, ex `https://prometheus-prod-xx.grafana.net`                                       |
| `GRAFANA_CLOUD_PROM_USER`    | sim         | Tenant id numérico (mostrado no portal Grafana → Connections → Prometheus)                                    |
| `GRAFANA_CLOUD_TOKEN`        | sim         | Service account token com `metrics:read` e `incident:read`                                                    |
| `GRAFANA_CLOUD_INCIDENT_URL` | recomendado | URL base do plugin Incident (`https://<stack>.grafana.net/api/plugins/grafana-incident-app/resources/api/v1`) |
| `GRAFANA_CLOUD_PROBE_LABEL`  | opt         | Label do probe (default `service`)                                                                            |

#### Convenção de métricas

A fonte espera uma série Prometheus chamada
`clinipharma_probe_success{<probeLabel>="<componente>"}` com valor
**1 quando ok** e **0 quando indisponível**. Pode vir de:

- Grafana Synthetic Monitoring (Probe HTTP);
- Blackbox exporter rodando em qualquer região;
- Jobs internos que pushgateway-zem o resultado.

Componentes esperados: `app`, `database`, `auth`, `payments`,
`integrations`, `cron` (mesmo conjunto exibido publicamente).

#### Convenção de incidentes

A fonte chama `IncidentsService.QueryIncidents` filtrando por label
`public=true`. Apenas incidentes que o operador marcar explicitamente
como públicos vão para a página. Labels reconhecidas:

- `component=<id>` → vincula o incidente a um componente listado
  (`app`, `database`, …). Ausente = incidente "transversal".
- Severidade do Grafana Incident é mapeada assim:
  - `critical | sev1` → `critical`
  - `major | sev2 | high` → `major`
  - resto → `minor`
- Status:
  - `resolved | closed` → `resolved`
  - `monitoring` → `monitoring`
  - `identified | mitigating` → `identified`
  - resto → `investigating`

---

## 3. Cache e budget de chamadas

| Camada                                | TTL                    | Notas                                              |
| ------------------------------------- | ---------------------- | -------------------------------------------------- |
| Browser (`Cache-Control` na resposta) | `s-maxage=60, swr=120` | Edge serve até 120 s pós-expiração com revalidação |
| Vercel Edge                           | 60 s                   | Aplicado pelo `Cache-Control`                      |
| In-process (`lib/status/data-source`) | 60 s                   | Por instância warm; isola a backend                |

Pior caso: **1 fan-out a cada 60 s por região warm**. Com Grafana Cloud
ativo isso é 18 queries Mimir + 1 incidents = 19 chamadas por minuto
por região → folga confortável dentro de qualquer plano pago.

A função `getStatusSummary()` implementa **stale-on-error**: se o
backend falha mas existe summary anterior em cache, ela é re-emitida
com `degraded=true` e `degradedReason` anexado.

---

## 4. Operação

### 4.1 Verificação local

```bash
curl -s http://localhost:3000/api/status/summary | jq '.source, .degraded, .components|length, .incidents|length'
```

Saída esperada em dev (sem Grafana Cloud configurado):

```
"internal"
false
6
0
```

### 4.2 Forçar refresh

A rota é cacheada — para invalidar, basta esperar 60 s ou redeploy.
Em emergência, atualizar `lib/status/data-source.ts` (ex: trocar
`CACHE_TTL_MS`) e fazer push.

### 4.3 Ativar Grafana Cloud em produção

1. Criar service account no portal Grafana Cloud com role
   `Editor` (mínimo necessário para `metrics:read` + `incident:read`).
2. Gerar token + copiar.
3. No Vercel:

   ```sh
   vercel env add GRAFANA_CLOUD_PROM_URL  production
   vercel env add GRAFANA_CLOUD_PROM_USER production
   vercel env add GRAFANA_CLOUD_TOKEN     production
   vercel env add GRAFANA_CLOUD_INCIDENT_URL production
   ```

4. Redeploy. Sem necessidade de tocar código.
5. Verificar no /status que o footer agora exibe `fonte: grafana-cloud`.
6. Se quiser desligar temporariamente: remover `GRAFANA_CLOUD_TOKEN`
   e redeploy → cai automaticamente para `internal`.

### 4.4 Dashboards e alertas relacionados

- Dashboard Platform Health já mostra cron success/failure (mesma fonte
  que alimenta o componente "cron" na página pública).
- Alertas em `monitoring/prometheus/alerts.yml` cobrem os mesmos
  sintomas que viram incidente público — mantenha as duas pontas em
  sintonia.

---

## 5. Limites conhecidos

| Limite                                                                                       | Mitigação                                                                                                       |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sem Grafana Cloud, "uptime" é proxy (taxa de falha de cron / surto de erro), não probe real. | Aceitar como honesto. A documentação acima é explícita; `source: internal` é exibido publicamente.              |
| Incidentes derivados de cron_runs **não** têm narrativa humana automaticamente.              | Para incidentes graves, criar manualmente um post-mortem em `docs/security/dr-evidence/<data>/` e linkar daqui. |
| Janela máxima = 90 dias (limite da retenção de `cron_runs` e `server_logs`).                 | Ok — Resolução CD/ANPD nº 2/2022 não exige histórico maior.                                                     |
| Cron `purge-server-logs` reduz histórico se algum dia mudarmos retenção < 90 d.              | Catálogo de retenção em `lib/retention/policies.ts` documenta o trade-off.                                      |

---

## 6. Artefatos relacionados

- **Tipos**: `lib/status/types.ts`
- **Source default**: `lib/status/internal-source.ts`
- **Source Grafana Cloud**: `lib/status/grafana-cloud-source.ts`
- **Factory + cache**: `lib/status/data-source.ts`
- **Endpoint público**: `app/api/status/summary/route.ts`
- **UI**: `components/status/status-board.tsx`
- **Página**: `app/status/page.tsx`
- **Testes**: `tests/unit/lib/status/*.test.ts`
- **Métricas**: `docs/observability/metrics.md` (§ Cron, § HTTP)
- **Trust Center**: `app/trust/page.tsx` (controle CC-10)
- **Política de retenção (cron_runs / server_logs)**: `docs/legal/retention-policy.md`

---

## 7. Changelog

| Data       | Quem                 | O quê                                                     |
| ---------- | -------------------- | --------------------------------------------------------- |
| 2026-04-18 | Wave Hardening II #7 | Versão inicial — fonte interna + slot Grafana Cloud + UI. |
