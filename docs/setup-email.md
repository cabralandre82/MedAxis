# MedAxis — Configuração de Email Transacional (Resend)

O MedAxis usa o [Resend](https://resend.com) para dois propósitos:

1. **Emails automáticos da aplicação** — novos pedidos, pagamento confirmado, repasse registrado, status atualizado
2. **Emails de autenticação do Supabase** — recuperação de senha, confirmação de cadastro

---

## Parte 1 — Configurar Resend na aplicação

### 1.1 Criar conta e API key

1. Acesse [resend.com](https://resend.com) e crie uma conta gratuita
2. No menu lateral, vá em **API Keys → Create API Key**
3. Dê o nome `medaxis-production`, selecione permissão **Sending access**
4. Copie a chave gerada (começa com `re_...`) — ela só aparece uma vez

### 1.2 Verificar domínio (obrigatório para produção)

> Sem domínio verificado, o Resend envia apenas para o seu próprio email (modo sandbox).

1. No Resend, vá em **Domains → Add Domain**
2. Insira seu domínio (ex: `medaxis.com.br`)
3. Adicione os registros DNS informados (SPF, DKIM, DMARC) no seu registrador (Registro.br, GoDaddy, Cloudflare, etc.)
4. Aguarde a verificação (normalmente < 5 minutos com Cloudflare, até 48h em outros)

### 1.3 Adicionar variáveis no Vercel

1. Acesse [vercel.com/dashboard](https://vercel.com/dashboard) → seu projeto MedAxis → **Settings → Environment Variables**
2. Adicione as duas variáveis abaixo para os ambientes **Production** e **Preview**:

| Variável         | Valor                                 |
| ---------------- | ------------------------------------- |
| `RESEND_API_KEY` | `re_sua_chave_aqui`                   |
| `EMAIL_FROM`     | `MedAxis <noreply@seudominio.com.br>` |

3. Faça um novo deploy (ou aguarde o próximo push automático)

---

## Parte 2 — Configurar SMTP do Supabase Auth

O Supabase usa SMTP para enviar emails de **recuperação de senha** e **confirmação de email**. Por padrão usa seu próprio servidor limitado a 3 emails/hora — inviável para produção.

### 2.1 Obter credenciais SMTP do Resend

No Resend:

1. Vá em **SMTP → Generate SMTP Credentials**
2. Você receberá:
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: uma chave de API dedicada

### 2.2 Configurar no Supabase

1. Acesse [app.supabase.com](https://app.supabase.com) → projeto MedAxis (`jomdntqlgrupvhrqoyai`)
2. Vá em **Authentication → Settings → Email** (ou **SMTP Settings**)
3. Desabilite **Enable Supabase SMTP** e ative **Custom SMTP**
4. Preencha:

| Campo        | Valor                           |
| ------------ | ------------------------------- |
| Host         | `smtp.resend.com`               |
| Port         | `465`                           |
| Username     | `resend`                        |
| Password     | sua chave de API SMTP do Resend |
| Sender name  | `MedAxis`                       |
| Sender email | `noreply@seudominio.com.br`     |

5. Clique em **Save** e depois em **Test SMTP** para confirmar

---

## Emails automáticos implementados

| Evento                         | Destinatário      | Quando dispara                              |
| ------------------------------ | ----------------- | ------------------------------------------- |
| Novo pedido criado             | Farmácia parceira | `createOrder` — após inserção no DB         |
| Pagamento confirmado           | Clínica           | `confirmPayment` — após confirmação         |
| Repasse à farmácia registrado  | Farmácia          | `completeTransfer` — após registro          |
| Status do pedido atualizado    | Clínica           | `updateOrderStatus` — estados selecionados¹ |
| Repasse a consultor registrado | Consultor         | `registerConsultantTransfer`                |

¹ Notifica apenas para: `READY`, `SHIPPED`, `DELIVERED`, `COMPLETED`, `CANCELED`, `WITH_ISSUE`

---

## Variáveis de ambiente necessárias

```env
RESEND_API_KEY=re_sua_chave_aqui
EMAIL_FROM=MedAxis <noreply@seudominio.com.br>
```

> Se `RESEND_API_KEY` não estiver configurada, os emails são silenciosamente ignorados com um `console.warn`. A plataforma funciona normalmente sem emails.

---

## Plano gratuito do Resend

| Limite     | Free tier |
| ---------- | --------- |
| Emails/mês | 3.000     |
| Emails/dia | 100       |
| Domínios   | 1         |
| Suporte    | Community |

Suficiente para operar nos primeiros meses. Plano Pro a partir de US$ 20/mês para 50.000 emails.
