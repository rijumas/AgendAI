# AgendaIA

AgendaIA es un MVP open source hecho con Next.js, TypeScript y Tailwind CSS. Permite escribir en espanol lo que necesitas hacer, pedirle a Gemini que lo convierta en uno o mas eventos, y guardar esos eventos en Supabase.

## Requisitos

- Node.js 20 o superior
- Una API key de Gemini. Puedes crearla gratis, sin tarjeta de credito, en [Google AI Studio](https://aistudio.google.com/apikey).
- Un proyecto gratis de Supabase. Puedes crearlo en [Supabase](https://supabase.com/).
- Credenciales OAuth de Google para iniciar sesion con Auth.js.

## Correr localmente

1. Instala dependencias:

```bash
npm install
```

2. Crea tu archivo de entorno local:

```bash
cp .env.example .env.local
```

3. Edita `.env.local` y agrega tus variables:

```bash
GEMINI_API_KEY=tu_api_key_real
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
AUTH_SECRET=tu_auth_secret_seguro
AUTH_GOOGLE_ID=tu_google_oauth_client_id
AUTH_GOOGLE_SECRET=tu_google_oauth_client_secret
```

Puedes generar `AUTH_SECRET` localmente con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Inicia el servidor de desarrollo:

```bash
npm run dev
```

5. Abre `http://localhost:3000`.

## API

`POST /api/parse-event`

Body:

```json
{
  "texto": "tengo que estudiar 2 horas y voy al gym a las 6pm"
}
```

Respuesta:

```json
{
  "eventos": [
    {
      "id": "d7f47b9d-9e37-4a74-87b8-1d7b8ad5b3c1",
      "titulo": "Estudiar",
      "fecha": "2026-06-25",
      "duracion_minutos": 120,
      "hora_sugerida": "15:00",
      "prioridad": "media"
    }
  ]
}
```

La ruta tambien acepta `GET /api/parse-event` para cargar los eventos guardados de hoy.

Tambien acepta `GET /api/parse-event?fecha=YYYY-MM-DD` para cargar eventos de una fecha especifica, y `DELETE /api/parse-event?id=uuid&fecha=YYYY-MM-DD` para eliminar un evento por id.

## Google Auth

AgendaIA usa Auth.js (`next-auth`) con Google como unico metodo de login.

Configura Google Cloud Console asi:

1. Entra a [Google Cloud Console](https://console.cloud.google.com/).
2. Crea o selecciona un proyecto.
3. Ve a `APIs & Services > OAuth consent screen`.
4. Configura la pantalla de consentimiento. Para este paso no necesitas Google Calendar API todavia.
5. Ve a `APIs & Services > Credentials`.
6. Crea `OAuth client ID`.
7. Elige tipo `Web application`.
8. En `Authorized JavaScript origins`, agrega:

```text
http://localhost:3000
https://tu-dominio.vercel.app
```

9. En `Authorized redirect URIs`, agrega:

```text
http://localhost:3000/api/auth/callback/google
https://tu-dominio.vercel.app/api/auth/callback/google
```

10. Copia el `Client ID` en `AUTH_GOOGLE_ID`.
11. Copia el `Client secret` en `AUTH_GOOGLE_SECRET`.

Para produccion en Vercel, asegúrate tambien de configurar `AUTH_URL` si tu despliegue no detecta bien la URL publica:

```bash
AUTH_URL=https://tu-dominio.vercel.app
```

## Supabase

1. Crea un proyecto gratis en [Supabase](https://supabase.com/).
2. En el dashboard del proyecto, ve a `Project Settings > API`.
3. Copia `Project URL` en `NEXT_PUBLIC_SUPABASE_URL`.
4. Copia `service_role secret` en `SUPABASE_SERVICE_ROLE_KEY`.

La `service_role` key solo debe usarse del lado del servidor. No la expongas en componentes cliente ni en codigo que corra en el navegador.

Ejecuta este SQL en el editor SQL de Supabase. Si ya tenias eventos creados antes de agregar login multi-usuario, este SQL conserva esas filas y las deja con `user_id` nulo; asi no se asignan por accidente a una cuenta incorrecta.

```sql
create table if not exists public.eventos (
  id uuid primary key,
  user_id text,
  titulo text not null,
  duracion_minutos integer not null check (duracion_minutos > 0),
  hora_sugerida text not null check (hora_sugerida ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  prioridad text not null check (prioridad in ('alta', 'media', 'baja')),
  fecha date not null
);

alter table public.eventos
  add column if not exists user_id text;

create index if not exists eventos_user_fecha_hora_idx
  on public.eventos (user_id, fecha, hora_sugerida);

alter table public.eventos enable row level security;

drop policy if exists "eventos_select_own" on public.eventos;
drop policy if exists "eventos_insert_own" on public.eventos;
drop policy if exists "eventos_update_own" on public.eventos;
drop policy if exists "eventos_delete_own" on public.eventos;

create policy "eventos_select_own"
  on public.eventos
  for select
  using (
    auth.role() = 'authenticated'
    and user_id in (auth.uid()::text, auth.jwt() ->> 'sub', auth.jwt() ->> 'email')
  );

create policy "eventos_insert_own"
  on public.eventos
  for insert
  with check (
    auth.role() = 'authenticated'
    and user_id in (auth.uid()::text, auth.jwt() ->> 'sub', auth.jwt() ->> 'email')
  );

create policy "eventos_update_own"
  on public.eventos
  for update
  using (
    auth.role() = 'authenticated'
    and user_id in (auth.uid()::text, auth.jwt() ->> 'sub', auth.jwt() ->> 'email')
  )
  with check (
    auth.role() = 'authenticated'
    and user_id in (auth.uid()::text, auth.jwt() ->> 'sub', auth.jwt() ->> 'email')
  );

create policy "eventos_delete_own"
  on public.eventos
  for delete
  using (
    auth.role() = 'authenticated'
    and user_id in (auth.uid()::text, auth.jwt() ->> 'sub', auth.jwt() ->> 'email')
  );
```

La app escribe `user_id` desde la sesion de NextAuth en el backend. La `service_role` key evita depender de RLS durante las API routes, pero las politicas quedan listas como capa de seguridad para una futura integracion directa con Supabase desde el cliente.

## Desplegar en Vercel

1. Sube el repositorio a GitHub.
2. Crea un nuevo proyecto en Vercel e importa el repositorio.
3. En `Settings > Environment Variables`, agrega:

```bash
GEMINI_API_KEY=tu_api_key_real
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
AUTH_SECRET=tu_auth_secret_seguro
AUTH_GOOGLE_ID=tu_google_oauth_client_id
AUTH_GOOGLE_SECRET=tu_google_oauth_client_secret
```

4. Despliega el proyecto.

Nota: `data/eventos.json` era la persistencia local anterior. Ya no se usa en el codigo y sigue ignorado por Git.

## PWA en iPhone

La app incluye `public/manifest.json` y metadatos para modo standalone. En Safari para iPhone, abre la URL desplegada, toca Compartir y luego "Agregar a pantalla de inicio".
