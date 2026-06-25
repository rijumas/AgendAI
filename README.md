# AgendaIA

AgendaIA es un MVP open source hecho con Next.js, TypeScript y Tailwind CSS. Permite escribir en espanol lo que necesitas hacer hoy, pedirle a Gemini que lo convierta en uno o mas eventos, y guardar esos eventos en `data/eventos.json`.

## Requisitos

- Node.js 20 o superior
- Una API key de Gemini. Puedes crearla gratis, sin tarjeta de credito, en [Google AI Studio](https://aistudio.google.com/apikey).

## Correr localmente

1. Instala dependencias:

```bash
npm install
```

2. Crea tu archivo de entorno local:

```bash
cp .env.example .env.local
```

3. Edita `.env.local` y agrega tu API key:

```bash
GEMINI_API_KEY=tu_api_key_real
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
      "titulo": "Estudiar",
      "duracion_minutos": 120,
      "hora_sugerida": "15:00",
      "prioridad": "media"
    }
  ]
}
```

La ruta tambien acepta `GET /api/parse-event` para cargar los eventos guardados de hoy.

## Desplegar en Vercel

1. Sube el repositorio a GitHub.
2. Crea un nuevo proyecto en Vercel e importa el repositorio.
3. En `Settings > Environment Variables`, agrega:

```bash
GEMINI_API_KEY=tu_api_key_real
```

4. Despliega el proyecto.

Nota: este MVP guarda eventos en `data/eventos.json` como persistencia simple. En Vercel, el sistema de archivos de funciones serverless no debe tratarse como almacenamiento durable; para produccion reemplazaremos esto luego por una base de datos.

## PWA en iPhone

La app incluye `public/manifest.json` y metadatos para modo standalone. En Safari para iPhone, abre la URL desplegada, toca Compartir y luego "Agregar a pantalla de inicio".
