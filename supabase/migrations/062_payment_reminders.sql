-- Migration 062 — payment reminder ledger for the boleto/PIX SLA cron.
--
-- Why
-- ---
-- The 2026-04-29 incident chain ended with us silencing every Asaas-side
-- e-mail (`notificationDisabled = true` per migration N/A — code-only
-- change in lib/asaas.ts). That was correct: the Asaas messages were
-- branded "Asaas", carried no Clinipharma context, and were producing
-- bounce alerts when clinics had stale e-mails on the customer record.
--
-- Removing those e-mails leaves a gap, though. Before, the merchant
-- was getting D-3 / D-1 / D-day / overdue nudges from Asaas; now the
-- buyer (clinic admin) only gets the one-shot "pagamento disponível"
-- notification fired by `generateAsaasChargeForOrder`. We need our own
-- Clinipharma-branded reminder cadence, with a tracking table so we
-- never double-send.
--
-- Design
-- ------
--   1. `payment_reminder_kind` enum lists the four cadences we send:
--      D-3 / D-1 / D-day / overdue. Adding a new cadence later is a
--      `ALTER TYPE … ADD VALUE` in a follow-up migration.
--
--   2. `payment_reminders_sent` is the audit + idempotency ledger.
--      `(payment_id, kind)` is unique → the cron can be retried, the
--      lock can be lost, the operator can run it manually, and the
--      buyer still gets exactly one reminder per cadence.
--
--   3. RLS: SUPER_ADMIN / PLATFORM_ADMIN can read for debugging.
--      The cron writes via the service-role client (RLS bypass), and
--      we never expose this table to clinics or pharmacies — it would
--      leak engagement metadata.
--
-- Idempotency note
-- ----------------
-- The companion cron (`app/api/cron/payment-reminders/route.ts`) does
-- the read+write inside a single transaction-less but
-- `ON CONFLICT DO NOTHING` insert. If two crons race somehow, the
-- second insert is a no-op and the e-mail send is gated by checking
-- `result.rowCount === 1` afterwards.

create type public.payment_reminder_kind as enum (
  'D_MINUS_3',
  'D_MINUS_1',
  'D_DAY',
  'OVERDUE'
);

create table public.payment_reminders_sent (
  id           bigserial primary key,
  payment_id   uuid not null references public.payments(id) on delete cascade,
  order_id     uuid not null references public.orders(id) on delete cascade,
  kind         public.payment_reminder_kind not null,
  due_date     date not null,
  sent_at      timestamptz not null default now(),
  channel      text not null default 'email+inapp'
    check (channel in ('email+inapp', 'inapp', 'email')),
  recipient_user_id uuid references auth.users(id) on delete set null,
  unique (payment_id, kind)
);

create index payment_reminders_sent_payment_idx
  on public.payment_reminders_sent (payment_id);
create index payment_reminders_sent_due_idx
  on public.payment_reminders_sent (due_date desc);

alter table public.payment_reminders_sent enable row level security;

-- Admins can read for diagnosis. No clinic/pharmacy/doctor visibility:
-- the dunning cadence is operator-side metadata, not buyer-facing.
create policy "select_admin_payment_reminders_sent"
  on public.payment_reminders_sent
  for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role in ('SUPER_ADMIN', 'PLATFORM_ADMIN')
    )
  );

-- No INSERT/UPDATE/DELETE policy → effectively service-role only
-- (admin client bypasses RLS for writes; everyone else is denied).

comment on table public.payment_reminders_sent is
  'Idempotency ledger for the Clinipharma-branded payment reminder cron. '
  'Replaces Asaas-side notifications (disabled 2026-04-29).';
comment on column public.payment_reminders_sent.kind is
  'D-3 / D-1 / D-day / overdue. New cadences added via ALTER TYPE.';
comment on column public.payment_reminders_sent.due_date is
  'Snapshot of payments.payment_due_date at send time. Lets us debug '
  'whether the cron picked the right cadence even if due_date is later moved.';
