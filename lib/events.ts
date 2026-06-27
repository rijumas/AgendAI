import { randomUUID } from "node:crypto";
import {
  actualizarEventoGoogleCalendar,
  borrarEventoGoogleCalendar,
  crearEventoGoogleCalendar
} from "@/lib/google-calendar";
import { getSupabaseServerClient } from "@/lib/supabase";

export type Prioridad = "alta" | "media" | "baja";

export type Evento = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
  google_event_id?: string | null;
};

type EventoRow = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
  google_event_id: string | null;
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
    prioridad: row.prioridad,
    google_event_id: row.google_event_id
  };
}

const EVENTO_SELECT =
  "id, fecha, titulo, duracion_minutos, hora_sugerida, prioridad, google_event_id";

async function vincularEventoConGoogleCalendar(
  userId: string,
  evento: Evento
): Promise<Evento> {
  try {
    const googleEventId = await crearEventoGoogleCalendar(userId, evento);
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("eventos")
      .update({ google_event_id: googleEventId })
      .eq("user_id", userId)
      .eq("id", evento.id)
      .select(EVENTO_SELECT)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo guardar google_event_id: ${error.message}`);
    }

    return data ? desdeRow(data as EventoRow) : { ...evento, google_event_id: googleEventId };
  } catch (error) {
    console.error("No se pudo crear el evento en Google Calendar:", error);
    return evento;
  }
}

async function sincronizarActualizacionGoogleCalendar(userId: string, evento: Evento) {
  try {
    if (evento.google_event_id) {
      await actualizarEventoGoogleCalendar(userId, evento.google_event_id, evento);
      return evento;
    }

    return await vincularEventoConGoogleCalendar(userId, evento);
  } catch (error) {
    console.error("No se pudo actualizar el evento en Google Calendar:", error);
    return evento;
  }
}

async function sincronizarEliminacionGoogleCalendar(
  userId: string,
  googleEventId: string | null
) {
  if (!googleEventId) return;

  try {
    await borrarEventoGoogleCalendar(userId, googleEventId);
  } catch (error) {
    console.error("No se pudo borrar el evento en Google Calendar:", error);
  }
}

export async function obtenerEventosPorFecha(userId: string, fecha = fechaLocalHoy()) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .select(EVENTO_SELECT)
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
    .select(EVENTO_SELECT);

  if (error) {
    throw new Error(`No se pudieron guardar los eventos: ${error.message}`);
  }

  const eventosGuardados = (data ?? []).map((row) => desdeRow(row as EventoRow));
  return Promise.all(
    eventosGuardados.map((evento) => vincularEventoConGoogleCalendar(userId, evento))
  );
}

export async function eliminarEvento(userId: string, id: string, fechaRespuesta = fechaLocalHoy()) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("eventos")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, google_event_id");

  if (error) {
    throw new Error(`No se pudo eliminar el evento: ${error.message}`);
  }

  const eventoEliminado = data?.[0] as Pick<EventoRow, "google_event_id"> | undefined;
  await sincronizarEliminacionGoogleCalendar(
    userId,
    eventoEliminado?.google_event_id ?? null
  );
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
    .select(EVENTO_SELECT);

  if (error) {
    throw new Error(`No se pudo actualizar el evento: ${error.message}`);
  }

  const eventosDeFecha = await obtenerEventosPorFecha(userId, fechaRespuesta);
  const eventoActualizado = data?.[0] ? desdeRow(data[0] as EventoRow) : null;
  const eventoSincronizado = eventoActualizado
    ? await sincronizarActualizacionGoogleCalendar(userId, eventoActualizado)
    : null;

  return {
    encontrado: Boolean(eventoSincronizado),
    evento: eventoSincronizado,
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
