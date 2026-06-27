import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import {
  actualizarEvento,
  type Evento,
  fechaLocalHoy,
  obtenerEventosPorFecha
} from "@/lib/events";
import { getSupabaseServerClient } from "@/lib/supabase";

type EstadoEnergia = "energia" | "normal" | "cansado" | "agotado";

type MovimientoEnergia = {
  titulo: string;
  fechaAnterior: string;
  horaAnterior: string;
  fechaNueva: string;
  horaNueva: string;
};

const ESTADOS_VALIDOS = new Set<EstadoEnergia>([
  "energia",
  "normal",
  "cansado",
  "agotado"
]);
const INICIO_DIA_MINUTOS = 6 * 60;
const FIN_DIA_MINUTOS = 24 * 60;
const PASO_MINUTOS = 30;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function obtenerUserIdAutenticado() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? session?.user?.email ?? null;
}

function respuestaNoAutorizado() {
  return NextResponse.json(
    { error: "No autorizado. Inicia sesion con Google para continuar." },
    { status: 401 }
  );
}

function minutosDesdeHora(hora: string) {
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

function horaDesdeMinutos(totalMinutos: number) {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function redondearHaciaArriba(minutos: number) {
  return Math.ceil(minutos / PASO_MINUTOS) * PASO_MINUTOS;
}

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dias));
  return date.toISOString().slice(0, 10);
}

function minutosActualesLima() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());
  const hora = Number(partes.find((parte) => parte.type === "hour")?.value ?? "0");
  const minuto = Number(partes.find((parte) => parte.type === "minute")?.value ?? "0");

  return (hora % 24) * 60 + minuto;
}

function esEventoPesado(evento: Evento) {
  return evento.prioridad === "alta" || evento.duracion_minutos >= 90;
}

function crearIntervalos(eventos: Evento[]) {
  return eventos.map((evento) => {
    const inicio = minutosDesdeHora(evento.hora_sugerida);
    return {
      inicio,
      fin: inicio + evento.duracion_minutos
    };
  });
}

function hayChoque(inicio: number, fin: number, intervalos: Array<{ inicio: number; fin: number }>) {
  return intervalos.some((intervalo) => inicio < intervalo.fin && fin > intervalo.inicio);
}

function encontrarEspacio(
  duracionMinutos: number,
  desdeMinutos: number,
  intervalos: Array<{ inicio: number; fin: number }>
) {
  for (
    let inicio = redondearHaciaArriba(Math.max(desdeMinutos, INICIO_DIA_MINUTOS));
    inicio + duracionMinutos <= FIN_DIA_MINUTOS;
    inicio += PASO_MINUTOS
  ) {
    const fin = inicio + duracionMinutos;

    if (!hayChoque(inicio, fin, intervalos)) {
      return inicio;
    }
  }

  return null;
}

function crearMensaje(movimientos: MovimientoEnergia[]) {
  if (movimientos.length === 0) {
    return "Guardé cómo te sientes hoy. No encontré tareas pesadas futuras que mover.";
  }

  if (movimientos.length === 1) {
    const movimiento = movimientos[0];
    const destino =
      movimiento.fechaNueva === movimiento.fechaAnterior
        ? `las ${movimiento.horaNueva}`
        : `las ${movimiento.horaNueva} del ${movimiento.fechaNueva}`;

    return `Como dijiste que estás cansado, moví "${movimiento.titulo}" para ${destino}.`;
  }

  return `Como dijiste que estás cansado, moví ${movimientos.length} tareas pesadas a momentos más llevaderos.`;
}

async function guardarEstadoDiario(
  userId: string,
  fecha: string,
  estado: EstadoEnergia | null,
  omitido: boolean
) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("estados_animo_diarios").upsert(
    {
      user_id: userId,
      fecha,
      estado,
      omitido,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,fecha" }
  );

  if (error) {
    throw new Error(`No se pudo guardar el estado de animo: ${error.message}`);
  }
}

async function reordenarEventosPorEnergia(userId: string, estado: EstadoEnergia) {
  if (estado !== "cansado" && estado !== "agotado") {
    return {
      movimientos: [] as MovimientoEnergia[],
      mensaje: "Guardé cómo te sientes hoy."
    };
  }

  const hoy = fechaLocalHoy();
  const manana = sumarDias(hoy, 1);
  const ahoraMinutos = minutosActualesLima();
  const { eventos: eventosHoy } = await obtenerEventosPorFecha(userId, hoy);
  const { eventos: eventosManana } = await obtenerEventosPorFecha(userId, manana);
  const candidatos = eventosHoy
    .filter((evento) => minutosDesdeHora(evento.hora_sugerida) > ahoraMinutos)
    .filter(esEventoPesado)
    .sort(
      (primero, segundo) =>
        minutosDesdeHora(primero.hora_sugerida) - minutosDesdeHora(segundo.hora_sugerida)
    );
  const idsCandidatos = new Set(candidatos.map((evento) => evento.id));
  const intervalosHoy = crearIntervalos(
    eventosHoy.filter((evento) => !idsCandidatos.has(evento.id))
  );
  const intervalosManana = crearIntervalos(eventosManana);
  const movimientos: MovimientoEnergia[] = [];
  const demoraMinutos = estado === "agotado" ? 180 : 120;

  for (const evento of candidatos) {
    const inicioActual = minutosDesdeHora(evento.hora_sugerida);
    const inicioMinimoHoy = Math.max(
      inicioActual + demoraMinutos,
      ahoraMinutos + PASO_MINUTOS
    );
    const nuevoInicioHoy = encontrarEspacio(
      evento.duracion_minutos,
      inicioMinimoHoy,
      intervalosHoy
    );
    const fechaNueva = nuevoInicioHoy === null ? manana : hoy;
    const nuevoInicio =
      nuevoInicioHoy ??
      encontrarEspacio(evento.duracion_minutos, 9 * 60, intervalosManana);

    if (nuevoInicio === null) {
      intervalosHoy.push({
        inicio: inicioActual,
        fin: inicioActual + evento.duracion_minutos
      });
      continue;
    }

    const horaNueva = horaDesdeMinutos(nuevoInicio);
    await actualizarEvento(
      userId,
      evento.id,
      {
        fecha: fechaNueva,
        hora_sugerida: horaNueva
      },
      hoy
    );

    const destino = {
      inicio: nuevoInicio,
      fin: nuevoInicio + evento.duracion_minutos
    };
    if (fechaNueva === hoy) {
      intervalosHoy.push(destino);
    } else {
      intervalosManana.push(destino);
    }

    movimientos.push({
      titulo: evento.titulo,
      fechaAnterior: hoy,
      horaAnterior: evento.hora_sugerida,
      fechaNueva,
      horaNueva
    });
  }

  return {
    movimientos,
    mensaje: crearMensaje(movimientos)
  };
}

export async function GET() {
  try {
    const userId = await obtenerUserIdAutenticado();
    if (!userId) return respuestaNoAutorizado();

    const fecha = fechaLocalHoy();
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("estados_animo_diarios")
      .select("estado, omitido")
      .eq("user_id", userId)
      .eq("fecha", fecha)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo consultar el estado de animo: ${error.message}`);
    }

    return NextResponse.json({
      fecha,
      debePreguntar: !data
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await obtenerUserIdAutenticado();
    if (!userId) return respuestaNoAutorizado();

    const body = (await request.json()) as {
      estado?: unknown;
      omitido?: unknown;
    };
    const fecha = fechaLocalHoy();
    const omitido = body.omitido === true;
    const estado = typeof body.estado === "string" ? body.estado : null;

    if (!omitido && (!estado || !ESTADOS_VALIDOS.has(estado as EstadoEnergia))) {
      return NextResponse.json(
        { error: "El estado de energia enviado no es valido." },
        { status: 400 }
      );
    }

    await guardarEstadoDiario(
      userId,
      fecha,
      omitido ? null : (estado as EstadoEnergia),
      omitido
    );

    if (omitido) {
      return NextResponse.json({
        mensaje: "",
        movimientos: []
      });
    }

    const resultado = await reordenarEventosPorEnergia(userId, estado as EstadoEnergia);
    const { eventos } = await obtenerEventosPorFecha(userId, fecha);

    return NextResponse.json({
      mensaje: resultado.mensaje,
      movimientos: resultado.movimientos,
      eventosHoy: eventos
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 500 }
    );
  }
}
