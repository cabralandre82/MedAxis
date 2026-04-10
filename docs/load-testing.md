# Clinipharma — Load Testing Plan (k6)

## Objetivo

Estabelecer um baseline de performance documentado e validar SLOs antes do go-live comercial.

## SLOs (Service Level Objectives)

| Métrica         | Target         |
| --------------- | -------------- |
| p95 latência    | < 800ms        |
| p99 latência    | < 2.000ms      |
| Taxa de erro    | < 0,1%         |
| Disponibilidade | ≥ 99,5% mensal |

## Scripts planejados (`tests/load/`)

### 1. `login.js` — Autenticação (100 VUs)

```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 100,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.001'],
  },
}

export default function () {
  const res = http.post(
    `${__ENV.BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: `user${Math.floor(Math.random() * 100)}@test.com`,
      password: 'test-password',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )

  check(res, { 'status is 200 or 401': (r) => [200, 401].includes(r.status) })
  sleep(1)
}
```

### 2. `create-order.js` — Criação de pedidos (50 VUs)

```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 50,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.001'],
  },
}

export default function () {
  // Requires valid session token in __ENV.AUTH_TOKEN
  const res = http.post(
    `${__ENV.BASE_URL}/api/orders`,
    JSON.stringify({
      clinic_id: __ENV.TEST_CLINIC_ID,
      items: [{ product_id: __ENV.TEST_PRODUCT_ID, quantity: 1 }],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${__ENV.AUTH_TOKEN}`,
      },
    }
  )

  check(res, { 'order created': (r) => r.status === 201 })
  sleep(2)
}
```

### 3. `list-orders.js` — Listagem com paginação (200 VUs)

```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.001'],
  },
}

export default function () {
  const cursor = Math.random() > 0.5 ? '&cursor=some_cursor' : ''
  const res = http.get(`${__ENV.BASE_URL}/api/orders?limit=20${cursor}`, {
    headers: { Authorization: `Bearer ${__ENV.AUTH_TOKEN}` },
  })

  check(res, { 'status 200': (r) => r.status === 200 })
  sleep(0.5)
}
```

### 4. `export-csv.js` — Export pesado (10 VUs)

```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: {
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/export?type=orders&format=csv`, {
    headers: { Authorization: `Bearer ${__ENV.AUTH_TOKEN}` },
    timeout: '15s',
  })

  check(res, { 'export successful': (r) => r.status === 200 })
  sleep(5)
}
```

## Como executar

```bash
# 1. Instalar k6
# Ubuntu: sudo apt-get install k6
# macOS: brew install k6

# 2. Rodar contra staging
BASE_URL=https://staging.clinipharma.com.br \
AUTH_TOKEN=<token> \
k6 run tests/load/list-orders.js

# 3. Resultados aparecem no terminal + opcional: Grafana k6 Cloud
```

## Ambiente recomendado

- Rodar **sempre contra staging**, nunca contra produção
- Garantir dados de teste (clínicas, produtos, pedidos) no banco de staging antes de rodar
- Repetir após cada deploy significativo

## Status

| Script            | Status      | Última execução | p95 obtido |
| ----------------- | ----------- | --------------- | ---------- |
| `login.js`        | ⬜ pendente | —               | —          |
| `create-order.js` | ⬜ pendente | —               | —          |
| `list-orders.js`  | ⬜ pendente | —               | —          |
| `export-csv.js`   | ⬜ pendente | —               | —          |

_Atualizar após primeira execução em staging._
