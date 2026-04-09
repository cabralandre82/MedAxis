# Clinipharma — Plano de Rollback

## Em caso de falha no deploy

### 1. Rollback na Vercel

1. Acesse o painel da Vercel → **Deployments**
2. Localize o último deploy estável
3. Clique em **Promote to Production**

### 2. Rollback de migration de banco

As migrations são incrementais e **não destrutivas** sempre que possível.
Se uma migration causar problemas:

1. Acesse o SQL Editor do Supabase
2. Execute o script de rollback correspondente em `supabase/migrations/rollback/`
3. Documente o incidente no CHANGELOG

### 3. Em caso de falha crítica de dados

1. O Supabase mantém backups automáticos (Point-in-Time Recovery no plano Pro)
2. Contate o suporte do Supabase com o timestamp do incidente

## Prevenção

- Sempre teste em ambiente local antes de subir para produção
- Nunca rode migrations diretamente em produção sem testar localmente
- Mantenha pelo menos 1 versão anterior de deploy disponível na Vercel
