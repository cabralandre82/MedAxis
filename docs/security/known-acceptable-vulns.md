# Known Acceptable Vulnerabilities

Vulnerabilidades conhecidas que foram **avaliadas e aceitas** após análise
de exploitability no contexto da plataforma. Cada entrada deve documentar:
data, alerta, contexto, justificativa, mitigações compensatórias, gatilhos
de revisão, dono e próxima revisão.

> Esta lista **não é** um waiver permanente. Toda entrada precisa ter
> data de re-revisão (≤ 90 dias) e ser revisitada quando o upstream
> publicar versão corrigida ou quando o contexto mudar (ex.: passamos a
> usar `AbortSignal` numa chamada que antes não usava).

---

## VULN-001 · `@tootallnate/once` < 3.0.1 (CVE-2026-3449)

| Campo                      | Valor                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| **Data da avaliação**      | 2026-04-18                                                               |
| **Avaliador**              | @cabralandre82                                                           |
| **Dependabot alert**       | [#7](https://github.com/cabralandre82/clinipharma/security/dependabot/7) |
| **Pacote**                 | `@tootallnate/once`                                                      |
| **Versão usada**           | 2.0.0                                                                    |
| **Versão corrigida**       | 3.0.1                                                                    |
| **CVE**                    | CVE-2026-3449                                                            |
| **GHSA**                   | [GHSA-vpq2-c234-7xj6](https://github.com/advisories/GHSA-vpq2-c234-7xj6) |
| **Severidade (CVSS v3.1)** | **3.3 — Low**                                                            |
| **Vetor**                  | `AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`                                    |
| **CWE**                    | CWE-670 (Always-Incorrect Control Flow Implementation)                   |
| **Próxima revisão**        | **2026-07-17** (90 dias) ou release nova de `firebase-admin`             |
| **Status**                 | Dismissed — `tolerable_risk` no Dependabot                               |

### O bug

Promise fica em pending state permanente quando `AbortSignal` é abortado.
Qualquer `await` ou `.then()` na promise trava indefinidamente.

### Caminho da dependência

```
firebase-admin@13.8.0          ← LATEST publicado, sem upgrade disponível
└─ @google-cloud/storage@7.19.0
   └─ teeny-request@9.0.0      ← legado, descontinuado pelo Google
      └─ http-proxy-agent@5.0.0 ← legado (atual upstream: 9.x)
         └─ @tootallnate/once@2.0.0
```

### Por que não há fix automático

- Estamos na **última versão publicada** do `firebase-admin` (13.8.0).
- O Firebase Admin SDK ainda fixa `@google-cloud/storage@7.x`, que ainda
  depende de `teeny-request@9` + `http-proxy-agent@5` (chain legada).
- O upstream Google ainda não atualizou essa chain. Aguardando publicação.

### Análise de exploitability no nosso contexto

| Critério                   | No nosso código                                           |
| -------------------------- | --------------------------------------------------------- |
| **AV:L** (acesso local)    | Sim — não exposto a tráfego externo                       |
| **PR:L** (privilege baixo) | Atacante precisa estar dentro do processo Node            |
| **C:N I:N**                | Zero impacto em confidencialidade/integridade             |
| **A:L** (availability)     | Apenas se `AbortSignal` for usado em chamadas FCM         |
| **Onde usamos**            | `lib/firebase-admin.ts`, `lib/push.ts`                    |
| **Passamos AbortSignal?**  | **Não** — verificado em ambos arquivos em 2026-04-18      |
| **Worst case real**        | Um envio FCM travar até timeout interno do firebase-admin |

### Decisão

**Aceitar e aguardar upstream.** Justificativas:

1. Severity Low (3.3) e **não-explorável** no código atual.
2. Forçar fix via `npm overrides` para `^3.0.1` tem **risco real de quebrar
   push notifications silenciosamente** — `@tootallnate/once@3` mudou a API
   e `http-proxy-agent@5` foi escrito contra a v2.
3. Reescrever push para FCM REST v1 API (eliminando firebase-admin) é uma
   wave separada com escopo próprio.

### Mitigações compensatórias

- ✅ `lib/push.ts` faz envio fire-and-forget com try/catch — uma promise
  travada não derruba a request HTTP que originou o push.
- ✅ Vercel Functions têm timeout máximo de 10s no plano atual; uma
  promise travada num handler é descartada após o timeout.
- ✅ Sentry captura quando push falha (cobertura observability).

### Gatilhos de re-revisão

Re-avaliar imediatamente se **qualquer** condição abaixo for atendida:

- `firebase-admin` publicar versão que upgrade `@google-cloud/storage` para
  uma chain sem `@tootallnate/once@2`.
- Adicionarmos `AbortSignal` em qualquer chamada via `firebase-admin`.
- Severity for reclassificada para High/Critical pelo NVD.
- Aparecer prova de exploit pública para o CVE.

Caso contrário, revisão de rotina em **2026-07-17**.

---

## VULN-002 · `uuid` < 14.0.0 (GHSA-w5hq-g745-h8pq)

| Campo                      | Valor                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| **Data da avaliação**      | 2026-04-28                                                                 |
| **Avaliador**              | @cabralandre82                                                             |
| **Dependabot alert**       | [#11](https://github.com/cabralandre82/clinipharma/security/dependabot/11) |
| **Pacote**                 | `uuid` (transitivo)                                                        |
| **Versões instaladas**     | 8.3.2, 9.0.1, 10.0.0, 11.1.0 (todas vulneráveis)                           |
| **Versão corrigida**       | 14.0.0                                                                     |
| **CVE**                    | (sem CVE atribuído ainda)                                                  |
| **GHSA**                   | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)   |
| **Severidade (CVSS v4.0)** | **6.3 — Medium**                                                           |
| **Vetor**                  | `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N`          |
| **CWE**                    | CWE-787 (Out-of-bounds Write), CWE-1285 (Improper Validation of Index)     |
| **Próxima revisão**        | **2026-07-28** (90 dias) ou quando uuid publicar patched CJS-compatible    |
| **Status**                 | Dismissed — `tolerable_risk` no Dependabot                                 |

### O bug

`uuid.v3()`, `uuid.v5()` e `uuid.v6()` em versões < 14 aceitam um buffer
de saída externo (`buf`) com `offset` mas **não rejeitam writes
out-of-range** (buffer pequeno demais ou offset alto demais). Em vez de
lançar `RangeError`, fazem write parcial silencioso. Resultado: o caller
recebe um buffer parcialmente sobrescrito sem erro.

`v4`, `v1` e `v7` já lançam `RangeError` corretamente — **não estão
afetados**.

### Por que não há fix automático

Existe versão patched (14.0.0, lançada 2026-04-19), mas:

- **uuid@12+ é ESM-only** (CommonJS removido — quebra explícita anunciada
  no changelog: <https://github.com/uuidjs/uuid/issues/881>).
- Forçar `uuid@14` via `npm overrides` quebraria **todos** os deps
  transitivos que ainda usam CJS:
  ```
  exceljs@4.4.0           → uuid@8.3.2  (CJS)
  firebase-admin@13.8.0   → uuid@11.1.0 (CJS)  + transitivamente uuid@8/9 via @google-cloud/*
  svix@1.90.0             → uuid@10.0.0 (CJS)
  google-gax@4.6.1        → uuid@9.0.1  (CJS)
  gaxios@6.7.1            → uuid@9.0.1  (CJS)
  teeny-request@9.0.0     → uuid@9.0.1  (CJS)
  ```
- Não existe **backport de patch** para 8.x / 9.x / 10.x / 11.x. O fix só
  está disponível em 14.x.
- `npm audit fix --force` propõe **downgrade** do `firebase-admin` para
  10.1.0 (semver-major), o que regride muito mais do que ganha.

### Análise de exploitability no nosso contexto

| Critério                                             | No nosso código                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **AT:P** (attack requirements: present)              | Sim — atacante precisa controlar o argumento `offset` ou `buf` da chamada                       |
| **AV:N**                                             | Network-attackable apenas SE o caller passar input do usuário como `buf`/`offset`               |
| **VI:L**                                             | Apenas integridade do buffer chamador (não confidencialidade, não disponibilidade)              |
| **Importamos `uuid` direto?**                        | **Não** — zero matches em `from 'uuid'` / `require('uuid')` em todo `app/`, `lib/`, `services/` |
| **Algum dep transitivo chama `v3/v5/v6` com `buf`?** | **Não** — auditado em 2026-04-28 (ver evidência abaixo)                                         |
| **Worst case real no nosso runtime**                 | Inexistente — nenhum caminho de execução chega no código vulnerável                             |

#### Evidência da auditoria de 2026-04-28

Auditados todos os call sites de `uuid` em deps transitivos via grep:

```
node_modules/firebase-admin/lib/eventarc/eventarc-utils.js:51:        'id': ce.id ?? (0, uuid_1.v4)(),
node_modules/svix/dist/request.js:104:                this.headerParams["idempotency-key"] = `auto_${(0, uuid_1.v4)()}`;
node_modules/@google-cloud/storage/build/cjs/src/resumable-upload.js:94-96:    checkUploadStatus: uuid.v4(), chunk: uuid.v4(), uri: uuid.v4(),
node_modules/@google-cloud/storage/build/cjs/src/resumable-upload.js:463:    this.currentInvocationId.uri = uuid.v4();
node_modules/@google-cloud/storage/build/cjs/src/resumable-upload.js:659:    this.currentInvocationId.chunk = uuid.v4();
node_modules/@google-cloud/storage/build/cjs/src/nodejs-common/util.js:684:    ... uuid.v4()
node_modules/@google-cloud/storage/build/cjs/src/nodejs-common/service.js:185: ... uuid.v4()
node_modules/google-gax/build/src/util.js:108:    return (0, uuid_1.v4)();
node_modules/gaxios/build/src/gaxios.js:417:        const boundary = (0, uuid_1.v4)();
node_modules/teeny-request/build/src/index.js:135:        const boundary = uuid.v4();
```

**Todos os 11 call sites usam `v4()` — nenhum chama `v3/v5/v6` com `buf`+`offset`.**
`v4` não é vulnerável (a própria advisory confirma).

### Decisão

**Aceitar e aguardar upstream.** Justificativas:

1. Severity Medium (6.3) com vetor CVSS 4.0 que exige `AT:P` (caller-controlled offset). Não há trajetória até o sumidouro vulnerável no nosso runtime.
2. **Forçar `uuid@14` via overrides quebra CJS** — `firebase-admin`, `exceljs`, `svix`, `@google-cloud/storage`, `google-gax`, `gaxios` e `teeny-request` falhariam no `require('uuid')`.
3. Adicionamos um verifier (`scripts/claims/check-uuid-vulnerable-call.mjs`) que **trava o build** se algum PR futuro adicionar uma chamada vulnerável. É a defesa em profundidade — caso alguém um dia importe `uuid` direto e use `v3/v5/v6`, o claims-audit pega antes do merge.

### Mitigações compensatórias

- ✅ `scripts/claims/check-uuid-vulnerable-call.mjs` no `run-all.sh` — falha se qualquer arquivo em `app/`, `components/`, `lib/`, `services/` ou `scripts/` chamar `uuid.v3/v5/v6` com 3+ argumentos.
- ✅ Auditoria comprovando `v4`-only nos deps transitivos (ver evidência acima).
- ✅ Vercel Functions são short-lived; o pior caso (silent partial write) seria descartado no fim da request.

### Gatilhos de re-revisão

Re-avaliar imediatamente se **qualquer** condição abaixo for atendida:

- uuid publicar release com **patched CJS-compatible** range (improvável — declararam ESM-only desde v12).
- `firebase-admin` / `@google-cloud/*` / `exceljs` / `svix` migrarem para uuid@14 (ESM) ou abandonarem o uuid.
- O verifier `check-uuid-vulnerable-call` reportar fail (qualquer call site novo no nosso código).
- Severity for reclassificada para High/Critical, ou aparecer CVE com CVSS 4.0 ≥ 8.0.
- Aparecer prova de exploit pública.

Caso contrário, revisão de rotina em **2026-07-28**.
