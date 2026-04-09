-- ============================================================
-- Clinipharma — Seed de Desenvolvimento
-- ============================================================
-- ATENÇÃO: Execute APENAS em ambiente de desenvolvimento!
-- Cria usuários via Supabase Auth Admin API — não diretamente aqui.
-- Este seed assume que os usuários já foram criados via script
-- ou manualmente no Supabase Auth.
--
-- Para criar os usuários auth, use o script em docs/seed-users.md
-- ou insira manualmente em Authentication > Users no Supabase.
--
-- Após criar os usuários, anote os UUIDs e substitua abaixo.
-- ============================================================

-- ========================
-- PRODUCT CATEGORIES
-- ========================
INSERT INTO public.product_categories (id, name, slug, description, is_active, sort_order)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Hormônios', 'hormonios', 'Produtos hormonais manipulados', true, 1),
  ('a1000000-0000-0000-0000-000000000002', 'Dermatologia', 'dermatologia', 'Cremes e géis dermatológicos', true, 2),
  ('a1000000-0000-0000-0000-000000000003', 'Oncologia de Suporte', 'oncologia-suporte', 'Medicamentos de suporte oncológico', true, 3)
ON CONFLICT (id) DO NOTHING;

-- ========================
-- PHARMACIES (estrutura sem usuários por ora)
-- ========================
INSERT INTO public.pharmacies (id, corporate_name, trade_name, cnpj, email, phone, address_line_1, city, state, zip_code, responsible_person, status)
VALUES
  (
    'b1000000-0000-0000-0000-000000000001',
    'Farmácia Forte Manipulação Ltda',
    'Farmácia Forte',
    '12.345.678/0001-01',
    'contato@farmaciaforte.com.br',
    '(11) 98765-4321',
    'Rua das Palmeiras, 100',
    'São Paulo', 'SP', '01310-000',
    'João Carlos Forte',
    'ACTIVE'
  ),
  (
    'b1000000-0000-0000-0000-000000000002',
    'Farmácia Verde Vida S/A',
    'Farmácia Verde',
    '98.765.432/0001-02',
    'contato@farmaciaverde.com.br',
    '(21) 98765-1234',
    'Av. Rio Branco, 200',
    'Rio de Janeiro', 'RJ', '20090-003',
    'Maria Clara Verde',
    'ACTIVE'
  )
ON CONFLICT (id) DO NOTHING;

-- ========================
-- CLINICS
-- ========================
INSERT INTO public.clinics (id, corporate_name, trade_name, cnpj, email, phone, address_line_1, city, state, zip_code, status)
VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    'Clínica Saúde Total S/S Ltda',
    'Saúde Total',
    '11.222.333/0001-44',
    'admin@clinicasaude.com.br',
    '(11) 3333-4444',
    'Av. Paulista, 1000, Sala 55',
    'São Paulo', 'SP', '01310-100',
    'ACTIVE'
  ),
  (
    'c1000000-0000-0000-0000-000000000002',
    'Clínica Vida Plena Medicina Especializada Ltda',
    'Vida Plena',
    '55.666.777/0001-88',
    'admin@clinicavida.com.br',
    '(21) 2222-3333',
    'Rua Visconde de Pirajá, 414',
    'Rio de Janeiro', 'RJ', '22410-003',
    'ACTIVE'
  )
ON CONFLICT (id) DO NOTHING;

-- ========================
-- DOCTORS
-- ========================
INSERT INTO public.doctors (id, full_name, crm, crm_state, specialty, email, phone, status)
VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    'Dr. Carlos Eduardo Silva',
    '123456',
    'SP',
    'Endocrinologia',
    'dr.silva@clinipharma.com.br',
    '(11) 99999-8888',
    'ACTIVE'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    'Dra. Ana Paula Santos',
    '654321',
    'RJ',
    'Dermatologia',
    'dra.santos@clinipharma.com.br',
    '(21) 99999-7777',
    'ACTIVE'
  )
ON CONFLICT (id) DO NOTHING;

-- ========================
-- DOCTOR CLINIC LINKS
-- ========================
INSERT INTO public.doctor_clinic_links (doctor_id, clinic_id, is_primary)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', true),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', true)
ON CONFLICT DO NOTHING;

-- ========================
-- PRODUCTS
-- ========================
INSERT INTO public.products (
  id, category_id, pharmacy_id, sku, name, slug,
  concentration, presentation, short_description, long_description,
  characteristics_json, price_current, estimated_deadline_days, active, featured
)
VALUES
  (
    'p1000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'FARM001-TEST01',
    'Testosterona Cipionato 200mg/mL',
    'testosterona-cipionato-200mg-ml',
    '200mg/mL',
    'Ampola 10mL',
    'Testosterona cipionato manipulada de alta pureza para uso clínico.',
    'Produto manipulado por farmácia especializada com controle rigoroso de qualidade. Indicado para terapia de reposição hormonal sob prescrição médica obrigatória.',
    '{"forma": "Injetável", "via": "Intramuscular", "conservação": "Temperatura ambiente", "validade": "6 meses"}',
    485.00, 7, true, true
  ),
  (
    'p1000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'FARM001-PROG01',
    'Progesterona Micronizada 200mg',
    'progesterona-micronizada-200mg',
    '200mg',
    'Cápsulas — Frasco com 30 unidades',
    'Progesterona micronizada manipulada para terapia hormonal feminina.',
    'Progesterona micronizada de alta biodisonibilidade. Manipulada com excipientes de alta qualidade para melhor absorção.',
    '{"forma": "Cápsula oral", "via": "Oral ou vaginal", "conservação": "Geladeira", "validade": "3 meses"}',
    320.00, 5, true, false
  ),
  (
    'p1000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002',
    'FARM002-TRET01',
    'Tretinoína 0,05% + Hidroquinona 4%',
    'tretinoinina-005-hidroquinona-4',
    'Tretinoína 0,05% / Hidroquinona 4%',
    'Creme — Bisnaga 30g',
    'Creme despigmentante e antiaging de alta eficácia.',
    'Formulação magistral com tretinoína e hidroquinona para tratamento de manchas, melasma e fotoenvelhecimento. Uso noturno conforme prescrição.',
    '{"forma": "Creme tópico", "via": "Tópica", "conservação": "Temperatura ambiente, longe da luz", "validade": "3 meses"}',
    195.00, 5, true, true
  ),
  (
    'p1000000-0000-0000-0000-000000000004',
    'a1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002',
    'FARM002-MINO01',
    'Minoxidil 5% Solução Capilar',
    'minoxidil-5-solucao-capilar',
    '5%',
    'Frasco 60mL',
    'Minoxidil solução capilar manipulada para tratamento de alopecia.',
    'Solução capilar com minoxidil para tratamento de alopecia androgenética masculina e feminina. Manipulada com base não oleosa para melhor absorção.',
    '{"forma": "Solução", "via": "Tópica capilar", "conservação": "Temperatura ambiente", "validade": "6 meses"}',
    145.00, 4, true, false
  ),
  (
    'p1000000-0000-0000-0000-000000000005',
    'a1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'FARM001-DHEA01',
    'DHEA 25mg',
    'dhea-25mg',
    '25mg',
    'Cápsulas — Frasco com 60 unidades',
    'DHEA manipulado para suporte hormonal e bem-estar geral.',
    'Dehidroepiandrosterona (DHEA) de alta pureza para terapia de reposição hormonal. Manipulado em farmácia com controle de qualidade.',
    '{"forma": "Cápsula", "via": "Oral", "conservação": "Local fresco e seco", "validade": "6 meses"}',
    260.00, 6, true, false
  ),
  (
    'p1000000-0000-0000-0000-000000000006',
    'a1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000001',
    'FARM001-METR01',
    'Metotrexato 2,5mg',
    'metotrexato-25mg',
    '2,5mg',
    'Comprimidos — Frasco com 20 unidades',
    'Metotrexato manipulado para uso em oncologia e doenças autoimunes.',
    'Metotrexato manipulado sob rigoroso controle de qualidade e biossegurança. Exclusivo para uso hospitalar e clínico especializado com prescrição obrigatória.',
    '{"forma": "Comprimido", "via": "Oral", "conservação": "Temperatura ambiente, longe da umidade", "validade": "12 meses", "requer_receita": "Sim - Controle Especial"}',
    380.00, 10, true, false
  )
ON CONFLICT (id) DO NOTHING;

-- ========================
-- APP SETTINGS (já inserido em 002, mas garantindo valores corretos)
-- ========================
INSERT INTO public.app_settings (key, value_json, description)
VALUES
  ('default_commission_percentage', '15', 'Percentual de comissão padrão da plataforma (%)'),
  ('platform_name', '"Clinipharma"', 'Nome da plataforma'),
  ('platform_support_email', '"suporte@clinipharma.com.br"', 'Email de suporte')
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json;

-- ============================================================
-- NOTA: Para criar os pedidos de seed, os usuários de auth
-- precisam estar criados primeiro. Use o painel do Supabase
-- Authentication > Users para criar:
--   - superadmin@clinipharma.com.br (senha: Clinipharma@2026)
--   - admin@clinipharma.com.br
--   - admin@clinicasaude.com.br
--   - admin@clinicavida.com.br
--   - dr.silva@clinipharma.com.br
--   - dra.santos@clinipharma.com.br
--   - admin@farmaciaforte.com.br
--   - admin@farmaciaverde.com.br
--
-- Após criar os usuários, você pode associar os papéis em
-- user_roles e clinic_members / pharmacy_members usando os
-- UUIDs gerados pelo Supabase Auth.
-- ============================================================
