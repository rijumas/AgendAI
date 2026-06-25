import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import {
  eliminarEvento,
  esFechaValida,
  fechaLocalHoy,
  guardarEventos,
  normalizarEventos,
  obtenerEventosPorFecha
} from "@/lib/events";

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
    }
  },
  propertyOrdering: ["eventos"]
};

async function pedirEventosAGemini(textoUsuario: string) {
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
        "El usuario puede mencionar MULTIPLES eventos o tareas en una sola frase; separa cada tarea mencionada.",
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

  const parsed = JSON.parse(response.text) as { eventos?: unknown };
  return normalizarEventos(parsed.eventos);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fechaParam = searchParams.get("fecha")?.trim();
  const fecha = fechaParam && esFechaValida(fechaParam) ? fechaParam : fechaLocalHoy();
  const data = await obtenerEventosPorFecha(fecha);
  return NextResponse.json({ eventos: data.eventos });
}

export async function DELETE(request: Request) {
  try {
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

    const resultado = await eliminarEvento(id, fechaRespuesta);

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { texto?: unknown };
    const texto = typeof body.texto === "string" ? body.texto.trim() : "";

    if (!texto) {
      return NextResponse.json(
        { error: "Escribe una tarea o evento para agendar." },
        { status: 400 }
      );
    }

    const eventosNuevos = await pedirEventosAGemini(texto);

    if (eventosNuevos.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron eventos validos en la respuesta." },
        { status: 422 }
      );
    }

    const data = await guardarEventos(eventosNuevos);
    const eventosHoy = data[fechaLocalHoy()] ?? [];

    return NextResponse.json({
      eventos: eventosNuevos,
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
