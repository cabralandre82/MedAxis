-- Migration 084 — System user (00000000-0000-0000-0000-000000000000)
--
-- Contexto / por quê
-- ------------------
-- Bug latente em prod descoberto em 2026-05-06: handlers automáticos
-- (`lib/orders/release-for-execution.ts:11`, `lib/jobs/asaas-webhook.ts`)
-- usam o UUID `00000000-0000-0000-0000-000000000000` como
-- `actor_user_id` / `changed_by_user_id` quando não há usuário logado
-- (caso típico: webhook do Asaas confirma pagamento sem sessão).
--
-- Tabelas como `order_status_history.changed_by_user_id` têm FK NOT NULL
-- para `profiles.id`. Como o user `00000000-...` NÃO existe em prod
-- (verificado 2026-05-06: `EXISTS auth.users WHERE id = '00000000-...'`
-- retornou FALSE), qualquer caminho automático que tente avançar status
-- vai falhar com FK violation:
--
--   ERROR: insert or update on table "order_status_history" violates foreign
--   key constraint "order_status_history_changed_by_user_id_fkey"
--   DETAIL: Key (changed_by_user_id)=(00000000-...) is not present in table "profiles".
--
-- O bug não foi exercitado porque os 4 pedidos confirmados em prod até
-- 2026-05-06 foram TODOS via caminho manual (super-admin clicando
-- "confirmar"), que passa `actorUserId: user.id`. Webhook Asaas nunca
-- confirmou pedido real. Quando o primeiro PIX/cartão real entrar pelo
-- gateway, vai estourar e o Inngest vai retentar 3× e abandonar.
--
-- Esta migração cria o user de sistema idempotentemente:
--   1) INSERT em auth.users (trigger handle_new_user cria profile auto).
--   2) UPDATE garante is_active=false (não aparece em listagens) +
--      full_name='Sistema'.
--   3) Sem atribuição de role (ver "Decisão de segurança" abaixo).
--
-- É também o pré-requisito do trilho F1 (webhook → confirm ledger
-- atomicamente) — chamamos esta mig PRIMEIRO para garantir que o user
-- existe antes de qualquer caminho automático ser ligado.
--
-- Decisão de segurança
-- --------------------
-- Senha = `extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))`
-- — bcrypt de UUID aleatório, nunca comunicado a ninguém.
-- Em Supabase moderno, `pgcrypto` vive no schema `extensions` (não
-- `public`), então qualificamos explicitamente para sobreviver a
-- mudanças futuras de `search_path`. Email único
-- `system@clinipharma.com.br` não tem caixa real. "Esqueci minha senha"
-- não pode ser exercitado (o e-mail não roteia para humano).
--
-- NÃO atribuímos role: caminhos automáticos chamam `createAdminClient()`
-- (service_role bypassa RLS) e não passam por `requireRole(...)`. Manter
-- o user sem role reduz superfície de ataque — se algum dia alguém
-- descobrir como logar como ele, não consegue fazer nada que
-- `requireRole` exija. Inclusive não consegue ler/escrever via
-- PostgREST (RLS profiles_select_own exige `id = auth.uid()` OR
-- `is_platform_admin()`; system user não é platform admin).
--
-- Idempotência
-- ------------
-- - INSERT em auth.users só dispara se ainda não existir (NOT EXISTS).
-- - Trigger `handle_new_user` cria profile com defaults (is_active=true);
--   UPDATE subsequente força is_active=false, idempotentemente.
-- - INSERT defensivo em profiles caso o trigger não tenha rodado por
--   algum motivo (não esperado, mas barato de defender).
-- - Rodar 2× produz exatamente o mesmo estado. Smoke embutido valida.
--
-- Compatibilidade
-- ---------------
-- - 0 mudanças de schema (pure DML).
-- - 0 mudanças em triggers, funções, policies.
-- - Linhas legadas (4 pedidos confirmados manualmente até hoje) não são
--   afetadas — `confirmed_by_user_id` continua apontando para o user
--   real `94cd5709-96ab-43a9-85ac-b0c3bb3fdc65`.
-- - Tabelas com FK para `profiles.id` em colunas NULLable (commissions,
--   transfers, payments) não mudam — quando F1 ligar webhook, vão usar
--   este user em alguns paths e NULL em outros, conforme o handler.
--
-- Rollback
-- --------
-- Como `profiles.id` é FK ON DELETE CASCADE para auth.users.id, basta
-- DELETE FROM auth.users WHERE id = '00000000-...' e o profile some
-- automaticamente. **MAS**: depois que F1 ligar e algum webhook real
-- confirmar pedido, este user vai estar referenciado em
-- `order_status_history`, `commissions`, etc. O DELETE vai falhar com
-- FK violation — esperado e correto: actor de auditoria não pode ser
-- apagado retroativamente. Para reverter pré-F1:
--   DELETE FROM public.user_roles WHERE user_id = '00000000-...';
--   DELETE FROM auth.users        WHERE id = '00000000-...';

SET search_path TO public, pg_temp;

DO $migrate$
DECLARE
  v_system_uuid  uuid := '00000000-0000-0000-0000-000000000000';
  v_system_email text := 'system@clinipharma.com.br';
BEGIN
  -- 1) Criar o user no auth.users se ainda não existe.
  --    Trigger handle_new_user (AFTER INSERT em auth.users) dispara e
  --    cria o profile automaticamente com defaults razoáveis
  --    (is_active=true, registration_status='APPROVED', etc).
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_system_uuid) THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_user_meta_data,
      raw_app_meta_data,
      is_super_admin,
      is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_system_uuid,
      'authenticated',
      'authenticated',
      v_system_email,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(),
      now(),
      now(),
      jsonb_build_object('full_name', 'Sistema'),
      jsonb_build_object('provider', 'system', 'providers', ARRAY['system']),
      false,
      false
    );
    RAISE NOTICE 'Migration 084: auth.users system actor criado (id=%)', v_system_uuid;
  ELSE
    RAISE NOTICE 'Migration 084: auth.users system actor já existe — pulando INSERT';
  END IF;

  -- 2) Garantir profile existe (defensivo). Se trigger handle_new_user
  --    rodou, já existe; se por algum motivo não rodou (ex: trigger
  --    desabilitado em algum hotfix futuro), criamos aqui.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_system_uuid) THEN
    INSERT INTO public.profiles (id, full_name, email, is_active, registration_status)
    VALUES (v_system_uuid, 'Sistema', v_system_email, false, 'APPROVED');
    RAISE NOTICE 'Migration 084: profile criado defensivamente (trigger não rodou)';
  END IF;

  -- 3) Garantir estado final do profile, idempotente.
  --    handle_new_user cria com is_active=true (default da coluna);
  --    forçamos false aqui. Se a row já está no estado desejado, o
  --    UPDATE não toca (WHERE filtra).
  UPDATE public.profiles
     SET is_active  = false,
         full_name  = 'Sistema',
         email      = v_system_email,
         updated_at = now()
   WHERE id = v_system_uuid
     AND (is_active = true OR full_name <> 'Sistema' OR email <> v_system_email);

  -- 4) Sem atribuição de role (decisão consciente — ver header).
END
$migrate$;

-- ── Smoke ──────────────────────────────────────────────────────────────
-- Validações end-state. RAISE EXCEPTION aborta a transação se algo
-- não está como esperado — segurança extra para o caso de a migração
-- ser aplicada num ambiente onde o trigger handle_new_user ou alguma
-- policy mudou de comportamento.

DO $smoke$
DECLARE
  v_uuid       uuid := '00000000-0000-0000-0000-000000000000';
  v_role_count int;
  v_is_active  boolean;
BEGIN
  -- auth.users existe
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uuid) THEN
    RAISE EXCEPTION 'Migration 084 smoke: auth.users system actor missing';
  END IF;

  -- public.profiles existe E está inativo
  SELECT is_active INTO v_is_active FROM public.profiles WHERE id = v_uuid;
  IF v_is_active IS NULL THEN
    RAISE EXCEPTION 'Migration 084 smoke: public.profiles system actor missing';
  END IF;
  IF v_is_active = true THEN
    RAISE EXCEPTION 'Migration 084 smoke: public.profiles system actor is active (expected inactive)';
  END IF;

  -- Não tem role (decisão consciente — ver header)
  SELECT count(*) INTO v_role_count FROM public.user_roles WHERE user_id = v_uuid;
  IF v_role_count > 0 THEN
    RAISE WARNING 'Migration 084 smoke: system actor has % role(s) — expected 0 (see header rationale)', v_role_count;
  END IF;

  RAISE NOTICE 'Migration 084 smoke passed (system_actor=%)', v_uuid;
END
$smoke$;
