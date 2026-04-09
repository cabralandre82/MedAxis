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
- [x] Site URL atualizada no Supabase Auth para `https://clinipharma.com.br`
- [x] Redirect URL `https://clinipharma.com.br/**` adicionada no Supabase Auth
- [x] Recuperação de senha via Resend (rota própria `POST /api/auth/forgot-password` + `admin.generateLink`)
- [x] Email de recuperação de senha testado e funcionando end-to-end
- [x] Página `/reset-password` criada e funcional

## Variáveis de Ambiente (Vercel)

- [x] `NEXT_PUBLIC_SUPABASE_URL` configurada
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configurada
- [x] `SUPABASE_SERVICE_ROLE_KEY` configurada
- [x] `NEXT_PUBLIC_APP_NAME` = Clinipharma
- [x] `NEXT_PUBLIC_APP_URL` atualizada para `https://clinipharma.com.br`
- [x] `RESEND_API_KEY` adicionada no Vercel
- [x] `EMAIL_FROM` = `Clinipharma <noreply@clinipharma.com.br>` adicionada no Vercel

## Build e Deploy

- [x] `npm run build` passa sem erros
- [x] `npm run lint` passa sem warnings críticos
- [x] Deploy na Vercel bem-sucedido (status: Ready)
- [x] URL de produção acessível (`https://clinipharma-5x0yoajyw-cabralandre-3009s-projects.vercel.app`)
- [x] Repositório GitHub conectado (auto-deploy no push para `main`)
- [x] Repositório GitHub renomeado para `clinipharma`
- [x] Git remote local atualizado para `cabralandre82/clinipharma`
- [x] Domínio `clinipharma.com.br` adicionado na Vercel
- [x] Nameservers do Cloudflare configurados no Registro.br
- [x] Cloudflare ativo e propagado
- [x] Domínio `clinipharma.com.br` com check verde na Vercel
- [x] HTTPS ativo em `https://clinipharma.com.br`

## Funcionalidades críticas

- [x] Login com email/senha funciona
- [x] Dashboard carrega corretamente por papel
- [x] Catálogo exibe produtos seed com paginação, filtros e ordenação
- [x] Criação de pedido com múltiplos produtos (carrinho)
- [x] Upload de documentos por tipo com checklist obrigatório
- [x] Confirmação manual de pagamento pelo admin
- [x] Cálculo de comissão automático na confirmação
- [x] Registro manual de repasse para farmácia e consultores
- [x] Timeline do pedido com histórico de status
- [x] Farmácia avança status operacional do pedido
- [x] Logs de auditoria sendo gerados (paginados)
- [x] Notificações in-app em tempo real (sino no header)
- [x] Busca global (⌘K) em pedidos, clínicas, médicos e produtos
- [x] Exportação CSV/Excel em pedidos, pagamentos, repasses e comissões
- [x] Dashboard de relatórios com KPIs, gráfico e alertas

## Segurança

- [x] `.env.local` NÃO está no repositório (`.gitignore` configurado)
- [x] Service Role Key NÃO exposta no frontend
- [x] RLS bloqueia acesso cruzado entre organizações
- [x] Rotas privadas redirecionam para login se não autenticado
- [x] Server Actions validam papéis no lado do servidor

## Email transacional

- [x] Resend integrado no código (`lib/email/`) com 5 templates
- [x] `RESEND_API_KEY` configurada em `.env.local` e no Vercel
- [x] `EMAIL_FROM` configurada no Vercel
- [x] Registros DNS do Resend adicionados no Cloudflare
- [x] Domínio `clinipharma.com.br` com status **Verified** no Resend
- [x] Recuperação de senha envia email via Resend (fluxo próprio, sem depender de SMTP do Supabase)
- [x] Email de recuperação de senha testado e funcionando end-to-end

## Onboarding comercial (pós-deploy)

- [x] Usuário super admin criado em produção (`cabralandre@yahoo.com.br` — André, SUPER_ADMIN)
- [ ] Farmácias reais cadastradas e ativas
- [ ] Catálogo real de produtos cadastrado — com `price_current`, `pharmacy_cost` e prazo por SKU
- [ ] Taxa de comissão dos consultores configurada em **Configurações → Taxa de comissão dos consultores**
- [ ] Clínicas clientes onboardadas
- [ ] Médicos vinculados às clínicas
- [ ] Consultores de vendas cadastrados e vinculados às clínicas (se aplicável)
- [ ] Primeiro pedido de teste realizado de ponta a ponta
- [ ] Domínio `clinipharma.com.br` ativo e HTTPS configurado na Vercel

---

_Legenda: [x] = concluído | [ ] = pendente_
