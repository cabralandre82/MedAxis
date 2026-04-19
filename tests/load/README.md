# Clinipharma — Load tests (k6)

Suite de testes de carga para a plataforma Clinipharma B2B.
Todos os scripts seguem o mesmo contrato: variáveis de ambiente, limites
documentados, output JSON em `tests/load/results/`.

> **Regra de ouro.** Rode contra **preview/staging**, nunca contra
> produção. Para produção, use a `realistic-workload.js` em horário de
> baixa atividade e com aviso prévio à equipe (canal `#deploys`).

---

## Pré-requisitos

```bash
# Instalar k6 (Linux/Debian)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# macOS
brew install k6
```

Verifique a versão:

```bash
k6 version   # esperado >= 0.51
```

---

## Variáveis de ambiente compartilhadas

| Variável             | Obrigatória | Descrição                                                       |
| -------------------- | ----------- | --------------------------------------------------------------- |
| `BASE_URL`           | sim         | URL completa do alvo (ex: `https://staging.clinipharma.com.br`) |
| `SUPABASE_URL`       | sim\*       | URL do projeto Supabase (\* para autenticados)                  |
| `SUPABASE_ANON_KEY`  | sim\*       | Anon key do Supabase                                            |
| `LOAD_TEST_PASSWORD` | sim\*       | Senha do user de carga em STAGING                               |
| `LOAD_TEST_EMAIL`    | não         | Default: `admin@clinipharma.com.br`                             |
| `AUTH_TOKEN`         | não         | Token JWT pré-obtido (bypass do `setup()`)                      |

**Por que sem defaults para credenciais?** Para evitar que alguém rode um
teste de carga acidentalmente contra produção com credenciais hardcoded
em commit público.

---

## Cenários disponíveis

### 1. `smoke.js` — Sanity de 60s

5 VUs por 1 minuto, apenas endpoints públicos. **Rode antes de todo
deploy de produção.**

```bash
BASE_URL=https://staging.clinipharma.com.br k6 run tests/load/smoke.js
```

Critério de aprovação: `failure rate < 1%`, `p95 < 1000ms`.

### 2. `health.js` — Health endpoint sob carga

50→100 VUs, 2 minutos. Mede latência do endpoint `/api/health` e do
ping ao banco (Supabase).

```bash
BASE_URL=https://staging.clinipharma.com.br k6 run tests/load/health.js
```

### 3. `login.js` — Auth Supabase

25 VUs, 2 minutos. Bate diretamente em `auth/v1/token` para isolar a
performance do auth do middleware.

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... LOAD_TEST_PASSWORD=... \
  k6 run tests/load/login.js
```

### 4. `list-orders.js` — Endpoint listagem

50→200→0 VUs, ~5 minutos. Cenário escalonado para descobrir o joelho.

```bash
BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... LOAD_TEST_PASSWORD=... \
  k6 run tests/load/list-orders.js
```

### 5. `export-csv.js` — Endpoint pesado

10 VUs, 3 minutos. Endpoint pesado (consulta agregada). 429s são
respostas **esperadas e desejadas** do rate-limiter — não falha.

```bash
BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... LOAD_TEST_PASSWORD=... \
  k6 run tests/load/export-csv.js
```

### 6. `realistic-workload.js` — Workload composto

Mistura de endpoints nas proporções reais (60% list, 20% health, 10%
read, 5% list-reg, 5% export). 0→30→100→0 VUs em ~10 minutos. Este é o
cenário a usar para **estimar capacidade** em GA.

```bash
BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... LOAD_TEST_PASSWORD=... \
  k6 run tests/load/realistic-workload.js
```

---

## Workflow recomendado contra preview Vercel

```bash
# 1. Identifique a URL do preview da PR (do comentário do bot ou:
PREVIEW_URL=$(vercel ls clinipharma --token=$VERCEL_TOKEN | grep "Preview" | head -1 | awk '{print $2}')

# 2. Configure ambiente de staging
export BASE_URL="https://${PREVIEW_URL}"
export SUPABASE_URL="https://<staging-project>.supabase.co"
export SUPABASE_ANON_KEY="<staging-anon-key>"
export LOAD_TEST_PASSWORD="<staging-password>"

# 3. Smoke test (60s, sem credenciais necessárias)
k6 run tests/load/smoke.js

# 4. Cenário realista (10 min)
k6 run tests/load/realistic-workload.js

# 5. Inspecione resultados
ls -la tests/load/results/
jq '.metrics.http_req_duration.values' tests/load/results/realistic.json
```

---

## Critérios de aprovação para release

Estes thresholds estão codificados nos próprios scripts via `options.thresholds`
— k6 retorna **exit code 99** se algum for violado.

| Cenário              | p95 alvo       | p99 alvo  | Failure rate | Comentário               |
| -------------------- | -------------- | --------- | ------------ | ------------------------ |
| `smoke`              | < 1000 ms      | —         | < 1%         | Bloqueia deploy          |
| `health`             | < 800 ms       | < 2000 ms | < 0.1%       | Bloqueia deploy          |
| `login`              | < 500 ms       | < 1000 ms | < 5%         | Bloqueia deploy          |
| `list-orders`        | < 800 ms       | < 2000 ms | < 0.1%       | Bloqueia deploy          |
| `export-csv`         | < 10 s         | —         | < 5%         | 429 não conta como falha |
| `realistic-workload` | conforme grupo | —         | < 1%         | Bloqueia GA              |

---

## Output e arquivamento

Todos os scripts gravam um JSON completo em `tests/load/results/<scenario>.json`
via `handleSummary()`. Esse diretório está no `.gitignore`.

**Antes de releases relevantes**, exporte os JSONs para o storage de evidência:

```bash
# Convenção: docs/evidence/load/<YYYY-MM-DD>/<commit-sha>/
mkdir -p docs/evidence/load/$(date +%Y-%m-%d)/$(git rev-parse --short HEAD)
cp tests/load/results/*.json docs/evidence/load/$(date +%Y-%m-%d)/$(git rev-parse --short HEAD)/
```

Esse material alimenta a evidência SOC 2 (CC7.1 — System Performance Monitoring)
e o relatório executivo trimestral.

---

## Integração CI/CD

A suíte completa **não** roda no CI por default — é cara em tempo (10+
min) e custosa em cota Vercel. Sugestão de pipeline:

- **Pre-merge (todo PR):** apenas `smoke.js` em GitHub Actions, ~60s.
- **Pre-deploy de staging:** suíte completa em job manual `gh workflow run load-test.yml`.
- **Pre-deploy de produção:** suíte completa + assinatura de aprovação humana.
- **Trimestral:** `realistic-workload.js` com 5x VUs (capacity planning).

Exemplo de step para adicionar a `.github/workflows/`:

```yaml
- name: Smoke load test
  uses: grafana/k6-action@v0.3.1
  with:
    filename: tests/load/smoke.js
  env:
    BASE_URL: ${{ steps.deploy.outputs.preview-url }}
```

---

## Troubleshooting

| Sintoma                            | Causa provável                         | Ação                                         |
| ---------------------------------- | -------------------------------------- | -------------------------------------------- |
| `getAuthToken failed: HTTP 400`    | `LOAD_TEST_PASSWORD` errada            | Verifique no 1Password "Clinipharma Staging" |
| `getAuthToken failed: HTTP 429`    | Rate-limit do Supabase atingido        | Aguarde 60s e re-rode                        |
| Picos de p99 erráticos no preview  | Cold-start do Vercel Edge              | Faça 1 warm-up de 30s antes do teste         |
| `errors: rate=1.00`                | URL ou token incorretos                | Confira `BASE_URL` e auth manualmente        |
| `429` predominando em `export-csv` | Rate-limiter funcionando como esperado | OK — não é falha                             |

---

## Histórico

| Data       | Versão | Mudança                                                        |
| ---------- | ------ | -------------------------------------------------------------- |
| 2026-04-08 | 1.0    | Suíte inicial: health, login, list-orders, export-csv          |
| 2026-04-17 | 1.1    | Helpers compartilhados, smoke, realistic-workload, JSON output |
