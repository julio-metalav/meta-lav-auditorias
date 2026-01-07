-- Meta Lav Auditorias (MVP)
-- Execute no Supabase SQL Editor

-- 1) Perfis (role por usuário)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null check (role in ('auditor','interno','gestor')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

-- gestor pode ver todos os perfis (para telas administrativas)
create policy "profiles_select_gestor" on public.profiles
for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'gestor'));

-- 2) Condomínios
create table if not exists public.condominios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text not null,
  uf text not null,
  cep text,
  rua text,
  numero text,
  bairro text,
  complemento text,

  sindico_nome text,
  sindico_telefone text,
  zelador_nome text,
  zelador_telefone text,

  valor_ciclo_lavadora numeric,
  valor_ciclo_secadora numeric,
  cashback_percent numeric,

  banco text,
  agencia text,
  conta text,
  tipo_conta text,
  pix text,
  favorecido_cnpj text,

  maquinas jsonb,
  created_at timestamptz not null default now()
);

alter table public.condominios enable row level security;

-- interno/gestor: pode ver e editar
create policy "condos_select_interno_gestor" on public.condominios
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "condos_write_interno_gestor" on public.condominios
for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "condos_update_interno_gestor" on public.condominios
for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

-- auditor: pode ver apenas os condomínios atribuídos
create table if not exists public.auditor_condominios (
  auditor_id uuid not null references auth.users(id) on delete cascade,
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (auditor_id, condominio_id)
);

alter table public.auditor_condominios enable row level security;

create policy "assign_select_interno_gestor" on public.auditor_condominios
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "assign_write_interno_gestor" on public.auditor_condominios
for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "assign_delete_interno_gestor" on public.auditor_condominios
for delete using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "condos_select_auditor_assigned" on public.condominios
for select using (
  exists (
    select 1 from public.auditor_condominios ac
    where ac.condominio_id = condominios.id and ac.auditor_id = auth.uid()
  )
);

-- 3) Auditorias (mensais)
create table if not exists public.auditorias (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  mes_ref date not null,
  status text not null default 'aberta' check (status in ('aberta','em_campo','em_conferencia','final')),

  auditor_id uuid not null references auth.users(id),
  created_by uuid references auth.users(id),

  agua_leitura numeric,
  energia_leitura numeric,
  gas_leitura numeric,
  quimicos_detergente_ml numeric,
  quimicos_amaciante_ml numeric,

  foto_agua_url text,
  foto_energia_url text,
  foto_gas_url text,
  foto_proveta_url text,
  foto_bombonas_url text,
  foto_cabo_bala_url text,

  cashback_comprovante_url text,

  ciclos jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominio_id, mes_ref)
);

alter table public.auditorias enable row level security;

-- triggers updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_auditorias_updated on public.auditorias;
create trigger trg_auditorias_updated
before update on public.auditorias
for each row execute function public.set_updated_at();

-- selects
create policy "aud_select_interno_gestor" on public.auditorias
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

create policy "aud_select_auditor" on public.auditorias
for select using (auditor_id = auth.uid());

-- inserts: interno/gestor
create policy "aud_insert_interno_gestor" on public.auditorias
for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

-- updates: auditor pode atualizar somente se for dono; interno/gestor pode tudo
create policy "aud_update_auditor" on public.auditorias
for update using (auditor_id = auth.uid());

create policy "aud_update_interno_gestor" on public.auditorias
for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('interno','gestor'))
);

-- IMPORTANTE: Storage
-- Crie um bucket chamado: auditorias
-- Deixe como "Public" (MVP). Depois a gente fecha com RLS de storage.
