# Pós-mortem — [TÍTULO DO INCIDENTE/DRILL]

**Data do evento:** YYYY-MM-DD HH:MM BRT
**Duração total:** XhYm
**Severidade:** SEV-1 / SEV-2 / SEV-3 / SEV-4
**Tipo:** incidente real / drill programado
**Owner do post-mortem:** Nome (cargo)
**Participantes:** Nome 1, Nome 2, ...

---

## TL;DR

(2-3 frases sobre o que aconteceu, impacto, e o que foi feito.)

---

## TIMELINE

| Hora (BRT) | Quem        | Evento                                   |
| ---------- | ----------- | ---------------------------------------- |
| HH:MM      | Sistema     | Alerta X disparou                        |
| HH:MM      | SRE on-call | Detectou o alerta, abriu canal #incident |
| HH:MM      | SRE on-call | Iniciou runbook Y                        |
| HH:MM      | DPO         | Foi notificado                           |
| HH:MM      | SRE on-call | Aplicou mitigação A                      |
| HH:MM      | Sistema     | /api/health voltou a 200                 |
| HH:MM      | SRE Lead    | Encerrou o incidente                     |

---

## IMPACTO

| Métrica                      | Valor                       |
| ---------------------------- | --------------------------- |
| Usuários afetados            | N de M                      |
| Pedidos impactados           | N                           |
| Tempo de indisponibilidade   | XhYm                        |
| Receita perdida (estimada)   | R$ X                        |
| Dados pessoais comprometidos | sim/não — se sim, descrever |
| Notificação ANPD necessária  | sim/não                     |

---

## CAUSA RAIZ (5 Whys)

1. Por que ocorreu?
2. Por que isso?
3. Por que isso?
4. Por que isso?
5. Por que isso? **← causa raiz**

---

## O QUE FUNCIONOU BEM

- ...
- ...

---

## O QUE NÃO FUNCIONOU BEM

- ...
- ...

---

## ACTION ITEMS

| #   | Ação | Owner | Prazo      | Prioridade |
| --- | ---- | ----- | ---------- | ---------- |
| 1   | ...  | Nome  | YYYY-MM-DD | P1         |
| 2   | ...  | Nome  | YYYY-MM-DD | P2         |

---

## EVIDÊNCIAS ANEXAS

- Screenshots: `dr-evidence/YYYY-MM-DD/screenshots/`
- Logs: `dr-evidence/YYYY-MM-DD/logs/`
- Health snapshots: `dr-evidence/YYYY-MM-DD/health-*.json`
- Timings: `dr-evidence/YYYY-MM-DD/timings.csv`

---

## REVISÃO E APROVAÇÃO

| Função                 | Nome | Data |
| ---------------------- | ---- | ---- |
| SRE on-call (autor)    | ...  | ...  |
| SRE Lead               | ...  | ...  |
| Diretor de Engenharia  | ...  | ...  |
| DPO (se PII envolvida) | ...  | ...  |
