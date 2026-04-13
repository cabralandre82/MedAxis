# Evolution API — Guia de Ativação em Produção

> **Status atual**: `EVOLUTION_API_URL=PENDING_DEPLOY`  
> Enquanto a variável não for atualizada para uma URL real, todas as mensagens WhatsApp são silenciosamente ignoradas (log `[whatsapp] Evolution API not configured yet`).

---

## 1. Pré-requisitos

| Item            | Detalhe                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Servidor        | VPS ou Render.com com Docker                                                |
| Número WhatsApp | Número real (chip físico ou virtual) — **não pode ser conta pessoal ativa** |
| Porta liberada  | 8080 (ou mapeada via proxy reverso)                                         |

---

## 2. Deploy via Docker Compose

Crie o arquivo `docker-compose.yml` no servidor:

```yaml
version: '3.8'

services:
  evolution-api:
    image: atendai/evolution-api:v2.2.3
    container_name: evolution-api
    restart: unless-stopped
    ports:
      - '8080:8080'
    environment:
      SERVER_URL: 'https://SEU_DOMINIO.com' # URL pública da API
      AUTHENTICATION_API_KEY: 'SUA_API_KEY_SECRETA' # Chave de acesso
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: 'true'
      DEL_INSTANCE: 'false'
      QRCODE_LIMIT: 30
      WEBHOOK_GLOBAL_ENABLED: 'false'
      LOG_LEVEL: 'ERROR,WARN,DEBUG,INFO,LOG,VERBOSE,DARK,WEBHOOKS'
      LOG_COLOR: 'true'
      LOG_BAILEYS: 'error'
      DATABASE_ENABLED: 'false' # true se usar PostgreSQL
      REDIS_ENABLED: 'false'
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store

volumes:
  evolution_instances:
  evolution_store:
```

```bash
docker compose up -d
```

---

## 3. Criar instância e conectar WhatsApp

```bash
# 3.1 Criar instância
curl -X POST https://SEU_DOMINIO.com/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: SUA_API_KEY_SECRETA" \
  -d '{"instanceName": "clinipharma", "qrcode": true}'

# 3.2 Obter QR Code para escanear com o WhatsApp do número
curl https://SEU_DOMINIO.com/instance/connect/clinipharma \
  -H "apikey: SUA_API_KEY_SECRETA"
# → Retorna base64 do QR. Abra no navegador ou use um decodificador.

# 3.3 Verificar status da conexão
curl https://SEU_DOMINIO.com/instance/connectionState/clinipharma \
  -H "apikey: SUA_API_KEY_SECRETA"
# → {"state": "open"} quando conectado
```

---

## 4. Configurar Webhook (opcional)

Para receber mensagens de entrada na plataforma:

```bash
curl -X POST https://SEU_DOMINIO.com/webhook/set/clinipharma \
  -H "Content-Type: application/json" \
  -H "apikey: SUA_API_KEY_SECRETA" \
  -d '{
    "url": "https://clinipharma.com.br/api/webhooks/whatsapp",
    "webhook_by_events": false,
    "webhook_base64": false,
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
  }'
```

---

## 5. Atualizar variáveis de ambiente

### Vercel (produção)

```bash
vercel env add EVOLUTION_API_URL production
# valor: https://SEU_DOMINIO.com

vercel env add EVOLUTION_API_KEY production
# valor: SUA_API_KEY_SECRETA

vercel env add EVOLUTION_INSTANCE_NAME production
# valor: clinipharma
```

### `.env.local` (desenvolvimento)

```env
EVOLUTION_API_URL=https://SEU_DOMINIO.com
EVOLUTION_API_KEY=SUA_API_KEY_SECRETA
EVOLUTION_INSTANCE_NAME=clinipharma
```

---

## 6. Atualizar Twilio para produção

O número atual `+15005550006` é um número de teste Twilio. Para produção:

1. Acesse [console.twilio.com](https://console.twilio.com)
2. Compre um número brasileiro (DDI +55) em **Phone Numbers → Buy a Number**
3. Atualize as variáveis:

```bash
vercel env add TWILIO_PHONE_NUMBER production
# valor: +55119XXXXXXXX (número comprado)
```

> **Nota**: Para enviar SMS a números brasileiros via Twilio, pode ser necessário usar o serviço **Twilio Messaging Service** com registro de marca (A2P 10DLC não se aplica ao Brasil — verificar regulamentação ANATEL).

---

## 7. Checklist de ativação

- [ ] Evolution API deployada e acessível via HTTPS
- [ ] QR Code escaneado e instância `clinipharma` com estado `open`
- [ ] `EVOLUTION_API_URL` atualizado no Vercel
- [ ] Número Twilio brasileiro adquirido
- [ ] `TWILIO_PHONE_NUMBER` atualizado no Vercel
- [ ] Teste de envio: `POST /api/push/subscribe` + verificar toast no frontend
- [ ] Teste de SMS: pedido de teste com número real
- [ ] Teste de WhatsApp: aprovação de cadastro de teste
