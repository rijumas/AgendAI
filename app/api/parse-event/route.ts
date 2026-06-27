import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import {
  actualizarEvento,
  type EventoActualizable,
  type Evento,
  eliminarEvento,
  esFechaValida,
  fechaLocalHoy,
  guardarEventos,
  normalizarEventos,
  obtenerEventosPorFecha
} from "@/lib/events";

type Prioridad = "alta" | "media" | "baja";
type TipoAccion = "modificar" | "mover" | "borrar";

type AccionEvento = {
  id_evento: string;
  tipo_accion: TipoAccion;
  cambios: EventoActualizable;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventosResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["eventos"],
  properties: {
    eventos: {
      type: Type.ARRAY,
      description: "Lista de eventos o tareas separadas que el usuario menciono.",
      items: {
        type: Type.OBJECT,
        required: [
          "titulo",
          "fecha",
          "duracion_minutos",
          "hora_sugerida",
          "prioridad"
        ],
        properties: {
          titulo: {
            type: Type.STRING,
            description: "Titulo corto del evento en espanol."
          },
          fecha: {
            type: Type.STRING,
            description: "Fecha del evento en formato YYYY-MM-DD.",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$"
          },
          duracion_minutos: {
            type: Type.INTEGER,
            description: "Duracion estimada del evento en minutos.",
            minimum: 1
          },
          hora_sugerida: {
            type: Type.STRING,
            description: "Hora sugerida para hoy en formato de 24 horas HH:MM.",
            pattern: "^\\d{2}:\\d{2}$"
          },
          prioridad: {
            type: Type.STRING,
            format: "enum",
            enum: ["alta", "media", "baja"],
            description: "Prioridad del evento."
          }
        }
      }
    },
    acciones: {
      type: Type.ARRAY,
      description:
        "Acciones sobre eventos existentes. Usar solo cuando el usuario se refiere claramente a un evento existente del contexto.",
      items: {
        type: Type.OBJECT,
        required: ["id_evento", "tipo_accion"],
        properties: {
          id_evento: {
            type: Type.STRING,
            description: "ID exacto del evento existente al que se refiere la accion."
          },
          tipo_accion: {
            type: Type.STRING,
            format: "enum",
            enum: ["modificar", "mover", "borrar"],
            description: "Tipo de accion a realizar sobre el evento existente."
          },
          titulo: {
            type: Type.STRING,
            description: "Nuevo titulo, solo si el usuario pidio cambiarlo."
          },
          fecha: {
            type: Type.STRING,
            description: "Nueva fecha en formato YYYY-MM-DD, solo si se mueve de dia.",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$"
          },
          duracion_minutos: {
            type: Type.INTEGER,
            description: "Nueva duracion en minutos, solo si se modifica.",
            minimum: 1
          },
          hora_sugerida: {
            type: Type.STRING,
            description: "Nueva hora en formato HH:MM, solo si se modifica.",
            pattern: "^\\d{2}:\\d{2}$"
          },
          prioridad: {
            type: Type.STRING,
            format: "enum",
            enum: ["alta", "media", "baja"],
            description: "Nueva prioridad, solo si se modifica."
          }
        }
      }
    }
  },
  propertyOrdering: ["eventos"]
};

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

function esPrioridad(valor: unknown): valor is Prioridad {
  return typeof valor === "string" && ["alta", "media", "baja"].includes(valor);
}

function esTipoAccion(valor: unknown): valor is TipoAccion {
  return (
    typeof valor === "string" &&
    ["modificar", "mover", "borrar"].includes(valor)
  );
}

function normalizarCambiosEvento(body: Record<string, unknown>) {
  const cambios: EventoActualizable = {};

  if ("titulo" in body) {
    if (typeof body.titulo !== "string" || !body.titulo.trim()) {
      throw new Error("El titulo debe ser un texto no vacio.");
    }
    cambios.titulo = body.titulo.trim();
  }

  if ("duracion_minutos" in body) {
    if (
      typeof body.duracion_minutos !== "number" ||
      !Number.isFinite(body.duracion_minutos) ||
      body.duracion_minutos <= 0
    ) {
      throw new Error("La duracion_minutos debe ser un numero mayor a 0.");
    }
    cambios.duracion_minutos = Math.round(body.duracion_minutos);
  }

  if ("hora_sugerida" in body) {
    if (
      typeof body.hora_sugerida !== "string" ||
      !/^\d{2}:\d{2}$/.test(body.hora_sugerida)
    ) {
      throw new Error('La hora_sugerida debe tener formato "HH:MM".');
    }
    cambios.hora_sugerida = body.hora_sugerida;
  }

  if ("prioridad" in body) {
    if (!esPrioridad(body.prioridad)) {
      throw new Error('La prioridad debe ser "alta", "media" o "baja".');
    }
    cambios.prioridad = body.prioridad;
  }

  if ("fecha" in body) {
    if (typeof body.fecha !== "string" || !esFechaValida(body.fecha)) {
      throw new Error('La fecha debe tener formato "YYYY-MM-DD".');
    }
    cambios.fecha = body.fecha;
  }

  return cambios;
}

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dias));
  return date.toISOString().slice(0, 10);
}

function detectarFechasRelevantes(textoUsuario: string) {
  const hoy = fechaLocalHoy();
  const texto = textoUsuario.toLowerCase();
  const fechas = new Set<string>([hoy]);
  const diasSemana: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6
  };

  if (/\bayer\b/.test(texto)) fechas.add(sumarDias(hoy, -1));
  if (/\bma[ñn]ana\b/.test(texto)) fechas.add(sumarDias(hoy, 1));
  if (/\bpasado ma[ñn]ana\b/.test(texto)) fechas.add(sumarDias(hoy, 2));

  const [year, month, day] = hoy.split("-").map(Number);
  const hoyDate = new Date(Date.UTC(year, month - 1, day));
  const hoyDia = hoyDate.getUTCDay();

  for (const [dia, numeroDia] of Object.entries(diasSemana)) {
    if (new RegExp(`\\b(?:el\\s+)?${dia}\\b`).test(texto)) {
      const offset = (numeroDia - hoyDia + 7) % 7 || 7;
      fechas.add(sumarDias(hoy, offset));
    }
  }

  return [...fechas];
}

async function obtenerEventosContexto(userId: string, textoUsuario: string) {
  const fechas = detectarFechasRelevantes(textoUsuario);
  const eventosPorFecha = await Promise.all(
    fechas.map((fecha) => obtenerEventosPorFecha(userId, fecha))
  );
  const eventos = eventosPorFecha.flatMap((resultado) => resultado.eventos);
  const eventosUnicos = new Map(eventos.map((evento) => [evento.id, evento]));

  return [...eventosUnicos.values()];
}

function serializarEventosContexto(eventos: Evento[]) {
  if (eventos.length === 0) {
    return "No hay eventos existentes relevantes en las fechas consultadas.";
  }

  return JSON.stringify(
    eventos.map((evento) => ({
      id: evento.id,
      titulo: evento.titulo,
      fecha: evento.fecha,
      hora_sugerida: evento.hora_sugerida,
      duracion_minutos: evento.duracion_minutos,
      prioridad: evento.prioridad
    }))
  );
}

function normalizarAcciones(acciones: unknown, eventosContexto: Evento[]) {
  if (!Array.isArray(acciones)) return [];

  const idsExistentes = new Set(eventosContexto.map((evento) => evento.id));

  return acciones
    .map((accion): AccionEvento | null => {
      if (!accion || typeof accion !== "object") return null;

      const valor = accion as Record<string, unknown>;
      if (
        typeof valor.id_evento !== "string" ||
        !idsExistentes.has(valor.id_evento) ||
        !esTipoAccion(valor.tipo_accion)
      ) {
        return null;
      }

      let cambios: EventoActualizable;
      try {
        cambios = normalizarCambiosEvento(valor);
      } catch {
        return null;
      }

      return {
        id_evento: valor.id_evento,
        tipo_accion: valor.tipo_accion,
        cambios
      };
    })
    .filter((accion): accion is AccionEvento => accion !== null);
}

async function procesarAcciones(userId: string, acciones: AccionEvento[]) {
  for (const accion of acciones) {
    if (accion.tipo_accion === "borrar") {
      await eliminarEvento(userId, accion.id_evento);
      continue;
    }

    if (Object.keys(accion.cambios).length === 0) {
      continue;
    }

    await actualizarEvento(userId, accion.id_evento, accion.cambios);
  }
}

async function pedirEventosAGemini(textoUsuario: string, eventosContexto: Evento[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  const hoy = fechaLocalHoy();

  if (!apiKey) {
    throw new Error("Falta configurar GEMINI_API_KEY.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: textoUsuario,
    config: {
      temperature: 0,
      maxOutputTokens: 2048,
      thinkingConfig: {
        thinkingBudget: 0
      },
      responseMimeType: "application/json",
      responseSchema: eventosResponseSchema,
      systemInstruction: [
        "Eres un asistente que convierte texto informal en espanol en eventos para una agenda diaria.",
        `La fecha de HOY es ${hoy}. Usa esta fecha como referencia actual.`,
        `Eventos existentes relevantes: ${serializarEventosContexto(eventosContexto)}.`,
        "El usuario puede mencionar MULTIPLES eventos o tareas en una sola frase; separa cada tarea mencionada.",
        'Si el usuario se refiere claramente a un evento existente por titulo similar, hora o contexto, devuelve una accion con el id_evento exacto en vez de crear un evento duplicado.',
        'Usa tipo_accion "modificar" para cambiar hora_sugerida, duracion_minutos, titulo o prioridad; usa "mover" para cambiar fecha; usa "borrar" para cancelar o eliminar.',
        "Si no hay forma clara de identificar el evento existente, crea un evento nuevo como siempre.",
        'Interpreta fechas relativas en espanol asi: "hoy" es la fecha actual, "manana" es la fecha actual + 1 dia, "ayer" es la fecha actual - 1 dia, "pasado manana" es la fecha actual + 2 dias.',
        'Los dias de la semana como "el lunes" o "el viernes" significan la proxima ocurrencia de ese dia desde la fecha actual.',
        "Si el usuario no menciona ninguna fecha ni expresion temporal, asume que el evento es para hoy.",
        'Cada evento debe incluir fecha en formato "YYYY-MM-DD".',
        'Usa prioridades "alta", "media" o "baja". La hora_sugerida siempre debe estar en formato de 24 horas "HH:MM".',
        "Si el usuario no da una hora exacta, sugiere una hora razonable para la fecha del evento."
      ].join(" ")
    }
  });

  if (!response.text) {
    throw new Error("Gemini no devolvio texto para parsear.");
  }

  const parsed = JSON.parse(response.text) as {
    eventos?: unknown;
    acciones?: unknown;
  };

  return {
    eventos: normalizarEventos(parsed.eventos),
    acciones: normalizarAcciones(parsed.acciones, eventosContexto)
  };
}

export async function GET(request: Request) {
  const userId = await obtenerUserIdAutenticado();
  if (!userId) return respuestaNoAutorizado();

  const { searchParams } = new URL(request.url);
  const fechaParam = searchParams.get("fecha")?.trim();
  const fecha = fechaParam && esFechaValida(fechaParam) ? fechaParam : fechaLocalHoy();
  const data = await obtenerEventosPorFecha(userId, fecha);
  return NextResponse.json({ eventos: data.eventos });
}

export async function DELETE(request: Request) {
  try {
    const userId = await obtenerUserIdAutenticado();
    if (!userId) return respuestaNoAutorizado();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    const fechaParam = searchParams.get("fecha")?.trim();
    const fechaRespuesta =
      fechaParam && esFechaValida(fechaParam) ? fechaParam : fechaLocalHoy();

    if (!id) {
      return NextResponse.json(
        { error: "Falta el id del evento a eliminar." },
        { status: 400 }
      );
    }

    const resultado = await eliminarEvento(userId, id, fechaRespuesta);

    if (!resultado.encontrado) {
      return NextResponse.json(
        { error: "No se encontro un evento con ese id.", eventos: resultado.eventos },
        { status: 404 }
      );
    }

    return NextResponse.json({ eventos: resultado.eventos });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await obtenerUserIdAutenticado();
    if (!userId) return respuestaNoAutorizado();

    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const fechaRespuesta =
      typeof body.fecha === "string" && esFechaValida(body.fecha)
        ? body.fecha
        : fechaLocalHoy();

    if (!id) {
      return NextResponse.json(
        { error: "Falta el id del evento a actualizar." },
        { status: 400 }
      );
    }

    let cambios: EventoActualizable;
    try {
      cambios = normalizarCambiosEvento(body);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Datos invalidos." },
        { status: 400 }
      );
    }

    if (Object.keys(cambios).length === 0) {
      return NextResponse.json(
        { error: "No se envio ningun campo para actualizar." },
        { status: 400 }
      );
    }

    const resultado = await actualizarEvento(userId, id, cambios, fechaRespuesta);

    if (!resultado.encontrado) {
      return NextResponse.json(
        { error: "No se encontro un evento con ese id.", eventos: resultado.eventos },
        { status: 404 }
      );
    }

    return NextResponse.json({
      evento: resultado.evento,
      eventos: resultado.eventos
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

    const body = (await request.json()) as { texto?: unknown };
    const texto = typeof body.texto === "string" ? body.texto.trim() : "";

    if (!texto) {
      return NextResponse.json(
        { error: "Escribe una tarea o evento para agendar." },
        { status: 400 }
      );
    }

    const eventosContexto = await obtenerEventosContexto(userId, texto);
    const resultadoGemini = await pedirEventosAGemini(texto, eventosContexto);
    const eventosNuevos = resultadoGemini.eventos;
    const acciones = resultadoGemini.acciones;

    if (eventosNuevos.length === 0 && acciones.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron eventos ni acciones validas en la respuesta." },
        { status: 422 }
      );
    }

    if (eventosNuevos.length > 0) {
      await guardarEventos(eventosNuevos, userId);
    }
    await procesarAcciones(userId, acciones);
    const { eventos: eventosHoy } = await obtenerEventosPorFecha(userId, fechaLocalHoy());

    return NextResponse.json({
      eventos: eventosNuevos,
      acciones,
      eventosHoy
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 500 }
    );
  }
}
