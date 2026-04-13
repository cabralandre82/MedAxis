-- 034 — Habilita Supabase Realtime nas tabelas de pedidos
--
-- REPLICA IDENTITY FULL garante que o payload de UPDATE/DELETE inclua
-- todos os campos (old + new), necessário para filtros por linha no cliente.
--
-- As tabelas são adicionadas à publicação supabase_realtime que o Supabase
-- cria por padrão e usa para entregar eventos aos clientes conectados via
-- Realtime JS SDK.

ALTER TABLE public.orders
  REPLICA IDENTITY FULL;

ALTER TABLE public.order_status_history
  REPLICA IDENTITY FULL;

ALTER TABLE public.order_operational_updates
  REPLICA IDENTITY FULL;

-- Adiciona as tabelas à publicação do Supabase Realtime
-- (IF NOT EXISTS evita erro se já estiverem adicionadas via dashboard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_status_history'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_operational_updates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_operational_updates;
  END IF;
END $$;
