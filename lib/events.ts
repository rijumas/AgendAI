import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase";

export type Prioridad = "alta" | "media" | "baja";

export type Evento = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
};

type EventoRow = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
};

export type EventoActualizable = Partial<
  Pick<Evento, "titulo" | "fecha" | "duracion_minutos" | "hora_sugerida" | "prioridad">
>;

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

function desdeRow(row: EventoRow): Evento {
  return {
    id: row.id,
    fecha: row.fecha,
    titulo: row.titulo,
    duracion_minutos: row.duracion_minutos,
    hora_sugerida: row.hora_sugerida,
    prioridad: row.prioridad
  };
}

export async function obtenerEventosPorFecha(userId: string, fecha = fechaLocalHoy()) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .select("id, fecha, titulo, duracion_minutos, hora_sugerida, prioridad")
    .eq("user_id", userId)
    .eq("fecha", fecha)
    .order("hora_sugerida", { ascending: true });

  if (error) {
    throw new Error(`No se pudieron cargar los eventos: ${error.message}`);
  }

  return {
    fecha,
    eventos: (data ?? []).map((row) => desdeRow(row as EventoRow))
  };
}

export async function guardarEventos(eventosNuevos: Evento[], userId: string) {
  if (eventosNuevos.length === 0) {
    return [];
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .insert(eventosNuevos.map((evento) => ({ ...evento, user_id: userId })))
    .select("id, fecha, titulo, duracion_minutos, hora_sugerida, prioridad");

  if (error) {
    throw new Error(`No se pudieron guardar los eventos: ${error.message}`);
  }

  return (data ?? []).map((row) => desdeRow(row as EventoRow));
}

export async function eliminarEvento(userId: string, id: string, fechaRespuesta = fechaLocalHoy()) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");

  if (error) {
    throw new Error(`No se pudo eliminar el evento: ${error.message}`);
  }

  const eventosDeFecha = await obtenerEventosPorFecha(userId, fechaRespuesta);

  return {
    encontrado: Boolean(data?.length),
    eventos: eventosDeFecha.eventos
  };
}

export async function actualizarEvento(
  userId: string,
  id: string,
  cambios: EventoActualizable,
  fechaRespuesta = fechaLocalHoy()
) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .update(cambios)
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, fecha, titulo, duracion_minutos, hora_sugerida, prioridad");

  if (error) {
    throw new Error(`No se pudo actualizar el evento: ${error.message}`);
  }

  const eventosDeFecha = await obtenerEventosPorFecha(userId, fechaRespuesta);
  const eventoActualizado = data?.[0] ? desdeRow(data[0] as EventoRow) : null;

  return {
    encontrado: Boolean(eventoActualizado),
    evento: eventoActualizado,
    eventos: eventosDeFecha.eventos
  };
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
