# Clinipharma — Checklist de Go-Live

---

## Infraestrutura

- [x] Migrations aplicadas no Supabase de produção (`jomdntqlgrupvhrqoyai`)
- [x] RLS habilitada em todas as tabelas
- [x] Buckets de Storage criados (`product-images` público, `order-documents` privado)
- [x] Seed de categorias e produtos rodado
- [x] Usuários iniciais criados via `scripts/setup-production.ts`

## Autenticação

- [x] Email/senha funcionando
- [x] Site URL configurada no Supabase Auth (`https://clinipharma-three.vercel.app`)
- [x] Redirect URLs configuradas no Supabase Auth
- [ ] SMTP personalizado configurado (Sendgrid, Resend, etc.) — _pendente para produção real_
- [ ] Email de recuperação de senha testado em produção

## Variáveis de Ambiente (Vercel)

- [x] `NEXT_PUBLIC_SUPABASE_URL` configurada
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configurada
- [x] `SUPABASE_SERVICE_ROLE_KEY` configurada
- [x] `NEXT_PUBLIC_APP_URL` com URL de produção
- [x] `NEXT_PUBLIC_APP_NAME` = Clinipharma

## Build e Deploy

- [x] `npm run build` passa sem erros
- [x] `npm run lint` passa sem warnings críticos
- [x] Deploy na Vercel bem-sucedido
- [x] URL de produção acessível (https://clinipharma-three.vercel.app)
- [x] Repositório GitHub conectado (auto-deploy no push para `main`)

## Funcionalidades críticas

- [x] Login com email/senha funciona
- [x] Dashboard carrega corretamente por papel
- [x] Catálogo exibe produtos seed
- [x] Criação de pedido com seleção de produto, clínica e médico
- [x] Upload de documentos vinculados ao pedido
- [x] Confirmação manual de pagamento pelo admin
- [x] Cálculo de comissão automático na confirmação
- [x] Registro manual de repasse para farmácia
- [x] Timeline do pedido com histórico de status
- [x] Farmácia avança status operacional do pedido
- [x] Logs de auditoria sendo gerados

## Segurança

- [x] `.env.local` NÃO está no repositório (`.gitignore` configurado)
- [x] Service Role Key NÃO exposta no frontend
- [x] RLS bloqueia acesso cruzado entre organizações
- [x] Rotas privadas redirecionam para login se não autenticado
- [x] Server Actions validam papéis no lado do servidor

## Email transacional

- [ ] Provedor SMTP real configurado no Supabase Auth (Resend, SendGrid, Postmark)
- [ ] Email de recuperação de senha testado em produção
- [ ] Emails automáticos de eventos críticos implementados (opcional no dia 1)

## Onboarding comercial (pós-deploy)

- [x] Usuário super admin criado em produção
- [ ] Farmácias reais cadastradas e ativas
- [ ] Catálogo real de produtos cadastrado — com `price_current`, `pharmacy_cost` e prazo por SKU
- [ ] Taxa de comissão dos consultores configurada em **Configurações → Taxa de comissão dos consultores**
- [ ] Clínicas clientes onboardadas
- [ ] Médicos vinculados às clínicas
- [ ] Consultores de vendas cadastrados e vinculados às clínicas (se aplicável)
- [ ] Primeiro pedido de teste realizado de ponta a ponta
- [ ] Domínio personalizado configurado (opcional)

---

_Legenda: [x] = concluído | [ ] = pendente_
