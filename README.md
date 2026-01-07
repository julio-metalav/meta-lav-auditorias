# Meta Lav Auditorias (MVP)

## O que está pronto
- Login com Supabase Auth (email/senha)
- Perfis e permissão por role: **auditor / interno / gestor**
- Cadastro de condomínios (interno/gestor)
- Atribuição de condomínios por auditor (interno/gestor)
- Auditorias mensais: criar/listar/editar
  - Interno/gestor cria a auditoria e define o auditor
  - Auditor preenche leituras e anexos
  - Interno anexa comprovante e fecha como FINAL

## 1) Configurar Supabase (1 vez)
1. Abra o Supabase SQL Editor e rode o arquivo: `SUPABASE_SQL_SETUP.sql`
2. Crie um bucket no **Storage** chamado: `auditorias`
   - MVP: deixe como **Public**

## 2) Criar o primeiro usuário gestor
No Supabase (Auth -> Users):
- Crie um usuário (email/senha)
- Depois, no SQL Editor, rode:

```sql
insert into public.profiles (id, email, role)
values ('UUID_DO_USUARIO', 'seu@email.com', 'gestor');
```

Depois disso, logue no sistema e crie os demais usuários pela tela **Usuários**.

## 3) Rodar local
Crie um `.env.local` na raiz:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # necessário para tela Usuários
```

Instale e rode:

```bash
npm install
npm run dev
```

Abra: http://localhost:3000

## Observações
- Se você não colocar `SUPABASE_SERVICE_ROLE_KEY`, o sistema funciona, mas **não cria usuários pela tela**.
- PDF e envio de e-mail (SMTP) estão como próxima etapa.
