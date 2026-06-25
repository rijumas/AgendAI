import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Prioridad = "alta" | "media" | "baja";

export type Evento = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
};

type EventosPorFecha = Record<string, Evento[]>;
type EventosDelDiaLegacy = {
  fecha: string;
  eventos: unknown[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "eventos.json");
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fechaLocalHoy() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function esFechaValida(fecha: string) {
  return FECHA_RE.test(fecha);
}

function esEventoGuardable(valor: unknown) {
  if (!valor || typeof valor !== "object") return false;

  const evento = valor as Record<string, unknown>;
  return (
    typeof evento.titulo === "string" &&
    typeof evento.duracion_minutos === "number" &&
    Number.isFinite(evento.duracion_minutos) &&
    typeof evento.hora_sugerida === "string" &&
    ["alta", "media", "baja"].includes(String(evento.prioridad))
  );
}

function prepararEvento(valor: unknown, fechaFallback = fechaLocalHoy()): Evento | null {
  if (!esEventoGuardable(valor)) return null;

  const evento = valor as {
    id?: unknown;
    fecha?: unknown;
    titulo: string;
    duracion_minutos: number;
    hora_sugerida: string;
    prioridad: Prioridad;
  };
  const fecha =
    typeof evento.fecha === "string" && esFechaValida(evento.fecha)
      ? evento.fecha
      : fechaFallback;

  return {
    id: typeof evento.id === "string" && evento.id.trim() ? evento.id : randomUUID(),
    fecha,
    titulo: evento.titulo.trim(),
    duracion_minutos: Math.max(1, Math.round(evento.duracion_minutos)),
    hora_sugerida: evento.hora_sugerida.trim(),
    prioridad: evento.prioridad
  };
}

function agregarEvento(mapa: EventosPorFecha, evento: Evento) {
  mapa[evento.fecha] = [...(mapa[evento.fecha] ?? []), evento];
}

function normalizarMapa(data: unknown): EventosPorFecha {
  const mapa: EventosPorFecha = {};

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return mapa;
  }

  const posibleLegacy = data as Partial<EventosDelDiaLegacy>;
  if (
    typeof posibleLegacy.fecha === "string" &&
    esFechaValida(posibleLegacy.fecha) &&
    Array.isArray(posibleLegacy.eventos)
  ) {
    for (const valor of posibleLegacy.eventos) {
      const evento = prepararEvento(valor, posibleLegacy.fecha);
      if (evento) agregarEvento(mapa, evento);
    }
    return mapa;
  }

  for (const [fecha, valores] of Object.entries(data)) {
    if (!esFechaValida(fecha) || !Array.isArray(valores)) continue;

    for (const valor of valores) {
      const evento = prepararEvento(valor, fecha);
      if (evento) agregarEvento(mapa, evento);
    }
  }

  return mapa;
}

async function escribirArchivo(data: EventosPorFecha) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function leerArchivo(): Promise<EventosPorFecha> {
  try {
    const contenido = await readFile(DATA_FILE, "utf8");
    const data = JSON.parse(contenido) as unknown;
    const normalizado = normalizarMapa(data);

    if (JSON.stringify(data) !== JSON.stringify(normalizado)) {
      await escribirArchivo(normalizado);
    }

    return normalizado;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("No se pudo leer data/eventos.json", error);
    }
  }

  return {};
}

export async function obtenerEventosPorFecha(fecha = fechaLocalHoy()) {
  const data = await leerArchivo();
  return {
    fecha,
    eventos: data[fecha] ?? []
  };
}

export async function guardarEventos(eventosNuevos: Evento[]) {
  const data = await leerArchivo();

  for (const evento of eventosNuevos) {
    agregarEvento(data, evento);
  }

  await escribirArchivo(data);
  return data;
}

export async function eliminarEvento(id: string, fechaRespuesta = fechaLocalHoy()) {
  const data = await leerArchivo();
  let encontrado = false;

  for (const [fecha, eventos] of Object.entries(data)) {
    const filtrados = eventos.filter((evento) => evento.id !== id);

    if (filtrados.length !== eventos.length) {
      encontrado = true;
      data[fecha] = filtrados;
    }
  }

  if (!encontrado) {
    return { encontrado: false, eventos: data[fechaRespuesta] ?? [] };
  }

  await escribirArchivo(data);
  return { encontrado: true, eventos: data[fechaRespuesta] ?? [] };
}

export function normalizarEventos(eventos: unknown): Evento[] {
  if (!Array.isArray(eventos)) return [];

  return eventos
    .map((evento) => prepararEvento(evento))
    .filter((evento): evento is Evento => evento !== null)
    .filter(
      (evento) =>
        evento.titulo &&
        esFechaValida(evento.fecha) &&
        /^\d{2}:\d{2}$/.test(evento.hora_sugerida)
    );
}
