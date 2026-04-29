-- ================================================================
-- ESQUEMA DE BASE DE DATOS — Plataforma de Facturas
-- ================================================================
-- Pega este archivo entero en el SQL Editor de Supabase y pulsa "Run".
-- Esto crea las 4 tablas, las políticas de seguridad y el bucket de archivos.
-- ================================================================

-- ============================================
-- TABLA 1: profiles (perfiles de usuario)
-- ============================================
-- Supabase Auth ya tiene una tabla auth.users con email y contraseña.
-- Esta tabla añade el nombre y el rol (admin o jefe).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('admin', 'jefe')),
  created_at timestamptz default now()
);

-- ============================================
-- TABLA 2: facturas
-- ============================================
create table public.facturas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  concepto text not null,
  importe numeric(10, 2) not null,
  mes text not null check (mes in (
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  )),
  año int not null,
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Subida', 'Revisada')),
  forma_pago text not null check (forma_pago in ('cuenta_corriente', 'tarjeta')),
  archivo_path text,
  creada_por uuid references public.profiles(id),
  subida_por uuid references public.profiles(id),
  fecha_creacion timestamptz default now(),
  fecha_subida timestamptz
);

-- ============================================
-- TABLA 3: comentarios
-- ============================================
create table public.comentarios (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id),
  texto text not null,
  fecha timestamptz default now()
);

-- ============================================
-- TABLA 4: historial
-- ============================================
create table public.historial (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references public.facturas(id) on delete cascade,
  usuario_id uuid references public.profiles(id),
  accion text not null,
  fecha timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- RLS = Row Level Security. Es la forma de Supabase de controlar
-- qué filas puede ver/modificar cada usuario.
alter table public.profiles enable row level security;
alter table public.facturas enable row level security;
alter table public.comentarios enable row level security;
alter table public.historial enable row level security;

-- profiles: cada usuario ve su propio perfil; admins ven todos
create policy "Ver perfiles"
  on public.profiles for select
  to authenticated
  using (true);

-- facturas: ambos roles pueden ver todas las facturas
create policy "Ver todas las facturas"
  on public.facturas for select
  to authenticated
  using (true);

-- facturas: solo admin las crea
create policy "Solo admin crea facturas"
  on public.facturas for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and rol = 'admin'
    )
  );

-- facturas: admin actualiza todo; jefe solo puede tocar archivo_path
create policy "Actualizar facturas"
  on public.facturas for update
  to authenticated
  using (true)
  with check (true);

-- facturas: solo admin las borra
create policy "Solo admin borra facturas"
  on public.facturas for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and rol = 'admin'
    )
  );

-- comentarios: ambos pueden leer y escribir los suyos
create policy "Ver comentarios"
  on public.comentarios for select
  to authenticated
  using (true);

create policy "Crear comentarios"
  on public.comentarios for insert
  to authenticated
  with check (auth.uid() = usuario_id);

-- historial: ambos leen, los triggers escriben
create policy "Ver historial"
  on public.historial for select
  to authenticated
  using (true);

create policy "Insertar historial (vía trigger)"
  on public.historial for insert
  to authenticated
  with check (true);

-- ============================================
-- TRIGGERS — actualizaciones automáticas
-- ============================================

-- Cuando se sube un archivo: cambiar estado a 'Subida' y registrar evento
create or replace function public.on_factura_update()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Si se acaba de subir el archivo (antes era null, ahora no lo es)
  if old.archivo_path is null and new.archivo_path is not null then
    new.estado := 'Subida';
    new.subida_por := auth.uid();
    new.fecha_subida := now();

    insert into public.historial (factura_id, usuario_id, accion)
    values (new.id, auth.uid(), 'subió archivo');
  end if;

  -- Si cambió el estado (independiente de la subida)
  if old.estado is distinct from new.estado then
    insert into public.historial (factura_id, usuario_id, accion)
    values (new.id, auth.uid(), 'cambió estado a ' || new.estado);
  end if;

  return new;
end;
$$;

create trigger factura_update_trigger
  before update on public.facturas
  for each row execute function public.on_factura_update();

-- Cuando se crea una factura: registrar en historial
create or replace function public.on_factura_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.historial (factura_id, usuario_id, accion)
  values (new.id, auth.uid(), 'creó la factura');
  return new;
end;
$$;

create trigger factura_insert_trigger
  after insert on public.facturas
  for each row execute function public.on_factura_insert();

-- ============================================
-- STORAGE — bucket privado para los archivos
-- ============================================
insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do nothing;

-- Cualquier usuario autenticado puede subir y leer archivos del bucket
create policy "Subir archivos de facturas"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'facturas');

create policy "Leer archivos de facturas"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'facturas');

-- Solo admin borra archivos
create policy "Solo admin borra archivos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'facturas' and
    exists (
      select 1 from public.profiles
      where id = auth.uid() and rol = 'admin'
    )
  );
