"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CalendarioGrid from "./CalendarioGrid";

type Prioridad = "alta" | "media" | "baja";
type Vista = "lista" | "calendario";
type ModoEntrada = "voz" | "texto";

type Evento = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const prioridadClases: Record<Prioridad, string> = {
  alta: "border-red-200 bg-red-50 text-red-700",
  media: "border-amber-200 bg-amber-50 text-amber-700",
  baja: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

function fechaLocalHoy() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function desplazarFecha(fecha: string, dias: number) {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dias));
  return date.toISOString().slice(0, 10);
}

export default function Home() {
  const [texto, setTexto] = useState("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState(fechaLocalHoy);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [vista, setVista] = useState<Vista>("lista");
  const [modoEntrada, setModoEntrada] = useState<ModoEntrada>("voz");
  const [vozDisponible, setVozDisponible] = useState(true);
  const [escuchando, setEscuchando] = useState(false);
  const [textoInterino, setTextoInterino] = useState("");
  const [mensajeVoz, setMensajeVoz] = useState("");
  const [cargando, setCargando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const textoInterinoRef = useRef("");
  const interinoConfirmadoManualRef = useRef("");

  const cargarEventos = useCallback(async (fecha: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/parse-event?fecha=${encodeURIComponent(fecha)}`, {
      cache: "no-store",
      signal
    });
    const data = (await response.json()) as { eventos?: Evento[]; error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "No se pudieron cargar los eventos.");
    }

    setEventos(Array.isArray(data.eventos) ? data.eventos : []);
  }, []);

  useEffect(() => {
    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVozDisponible(false);
      setModoEntrada("texto");
      setMensajeVoz(
        "La entrada por voz no esta disponible en este navegador. Puedes escribir tu solicitud."
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function cargarEventosSeleccionados() {
      try {
        await cargarEventos(fechaSeleccionada, controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudieron cargar los eventos guardados."
          );
        }
      }
    }

    cargarEventosSeleccionados();

    return () => {
      controller.abort();
    };
  }, [cargarEventos, fechaSeleccionada]);

  const totalMinutos = useMemo(
    () => eventos.reduce((total, evento) => total + evento.duracion_minutos, 0),
    [eventos]
  );
  const hoy = fechaLocalHoy();

  function agregarTextoTranscrito(transcripcion: string) {
    const limpio = transcripcion.trim();
    if (!limpio) return;

    setTexto((actual) => `${actual}${actual ? " " : ""}${limpio}`);
  }

  function finalizarGrabacion(confirmarInterino: boolean) {
    setEscuchando(false);

    if (confirmarInterino && textoInterinoRef.current.trim()) {
      const interino = textoInterinoRef.current.trim();
      agregarTextoTranscrito(interino);
      interinoConfirmadoManualRef.current = interino;
    }

    textoInterinoRef.current = "";
    setTextoInterino("");
  }

  function detenerGrabacion() {
    finalizarGrabacion(true);
    recognitionRef.current?.stop();
  }

  function iniciarGrabacion() {
    setError("");
    setMensajeVoz("");
    setTextoInterino("");

    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVozDisponible(false);
      setModoEntrada("texto");
      setMensajeVoz(
        "La entrada por voz no esta disponible en este navegador. Puedes escribir tu solicitud."
      );
      return;
    }

    if (escuchando) {
      detenerGrabacion();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "es-419";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let textoFinal = "";
      let interino = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const resultado = event.results[index];
        const transcript = resultado[0].transcript;

        if (resultado.isFinal) {
          textoFinal += transcript;
        } else {
          interino += transcript;
        }
      }

      const finalLimpio = textoFinal.trim();
      if (finalLimpio) {
        if (finalLimpio === interinoConfirmadoManualRef.current) {
          interinoConfirmadoManualRef.current = "";
        } else {
          agregarTextoTranscrito(finalLimpio);
        }
      }

      textoInterinoRef.current = interino.trim();
      setTextoInterino(textoInterinoRef.current);
    };

    recognition.onerror = (event) => {
      finalizarGrabacion(false);

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setModoEntrada("texto");
        setMensajeVoz(
          "Permiso de microfono denegado. Habilitalo en Configuracion de Safari o del navegador y vuelve a intentar."
        );
        return;
      }

      setMensajeVoz("No se pudo usar el microfono. Puedes escribir tu solicitud.");
    };

    recognition.onend = () => {
      finalizarGrabacion(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setEscuchando(true);
  }

  async function agendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entrada = texto.trim();

    if (!entrada) {
      setError("Graba o escribe algo para agendar.");
      return;
    }

    setCargando(true);
    setError("");

    try {
      const response = await fetch("/api/parse-event", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ texto: entrada })
      });

      const data = (await response.json()) as {
        eventos?: Evento[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo agendar.");
      }

      await cargarEventos(fechaSeleccionada);
      setTexto("");
      setTextoInterino("");
      setModoEntrada(vozDisponible ? "voz" : "texto");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agendar.");
    } finally {
      setCargando(false);
    }
  }

  async function eliminarEvento(id: string) {
    setEliminandoId(id);
    setError("");

    try {
      const response = await fetch(
        `/api/parse-event?id=${encodeURIComponent(id)}&fecha=${encodeURIComponent(
          fechaSeleccionada
        )}`,
        {
          method: "DELETE"
        }
      );
      const data = (await response.json()) as {
        eventos?: Evento[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo eliminar el evento.");
      }

      setEventos((actuales) =>
        Array.isArray(data.eventos)
          ? data.eventos
          : actuales.filter((evento) => evento.id !== id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el evento.");
    } finally {
      setEliminandoId(null);
    }
  }

  function descartarTexto() {
    detenerGrabacion();
    setTexto("");
    setTextoInterino("");
    setMensajeVoz("");
    setModoEntrada(vozDisponible ? "voz" : "texto");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <section className="mb-8">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-mint">
          AgendaIA
        </p>
        <h1 className="text-4xl font-bold leading-tight text-ink sm:text-5xl">
          Convierte planes sueltos en eventos para hoy.
        </h1>
      </section>

      <form
        onSubmit={agendar}
        className="rounded-lg border border-ink/10 bg-white/88 p-4 shadow-sm backdrop-blur sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <label htmlFor="texto" className="block text-sm font-semibold text-ink">
            Que necesitas hacer
          </label>
          {vozDisponible ? (
            <button
              type="button"
              onClick={() => {
                detenerGrabacion();
                setModoEntrada(modoEntrada === "voz" ? "texto" : "voz");
              }}
              className="rounded-md border border-ink/15 px-3 py-2 text-xs font-bold text-ink/70 transition hover:bg-ink/5"
            >
              {modoEntrada === "voz" ? "Escribir en su lugar" : "Usar voz"}
            </button>
          ) : null}
        </div>

        {modoEntrada === "voz" && vozDisponible && !texto ? (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-ink/15 bg-white/70 px-5 py-8 text-center">
            <button
              type="button"
              onClick={iniciarGrabacion}
              className={`flex h-36 w-36 items-center justify-center rounded-full border text-5xl font-bold shadow-sm transition ${
                escuchando
                  ? "animate-pulse border-red-200 bg-red-50 text-red-700"
                  : "border-mint/30 bg-mint text-white hover:bg-mint/90"
              }`}
              aria-label={escuchando ? "Detener grabacion" : "Iniciar grabacion"}
            >
              🎙
            </button>
            <div>
              <p className="text-base font-bold text-ink">
                {escuchando ? "Escuchando..." : "Toca para hablar"}
              </p>
              <p className="mt-1 text-sm text-ink/60">
                {escuchando
                  ? "Toca otra vez para detener."
                  : "AgendaIA transcribira tu voz antes de enviarla."}
              </p>
            </div>
            {textoInterino ? (
              <p className="max-w-xl rounded-md bg-paper px-4 py-3 text-sm text-ink/70">
                {textoInterino}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {mensajeVoz ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {mensajeVoz}
              </p>
            ) : null}
            <textarea
              id="texto"
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              placeholder="Ej: manana tengo dentista a las 10am"
              className="min-h-36 w-full resize-y rounded-md border border-ink/15 bg-white px-4 py-3 text-base leading-relaxed text-ink outline-none transition focus:border-mint focus:ring-4 focus:ring-mint/20"
            />
          </div>
        )}

        {modoEntrada === "voz" && vozDisponible && texto ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={iniciarGrabacion}
              className="rounded-md border border-ink/15 px-3 py-2 text-xs font-bold text-ink/70 transition hover:bg-ink/5"
            >
              Volver a grabar
            </button>
            <button
              type="button"
              onClick={descartarTexto}
              className="rounded-md border border-ink/15 px-3 py-2 text-xs font-bold text-ink/70 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              Descartar
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink/65">
            {eventos.length} eventos en esta fecha - {totalMinutos} min agendados
          </p>
          <button
            type="submit"
            disabled={cargando || !texto.trim()}
            className="inline-flex h-12 items-center justify-center rounded-md bg-ink px-6 text-sm font-bold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/45"
          >
            {cargando ? "Agendando..." : "Agendar"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="mt-8 flex-1">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink">Eventos del dia</h2>
            <p className="text-sm text-ink/60">
              {fechaSeleccionada} - se guardan en Supabase.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFechaSeleccionada(desplazarFecha(hoy, -1))}
                className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm font-bold text-ink/70 transition hover:bg-ink/5"
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => setFechaSeleccionada(hoy)}
                className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm font-bold text-ink/70 transition hover:bg-ink/5"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => setFechaSeleccionada(desplazarFecha(hoy, 1))}
                className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm font-bold text-ink/70 transition hover:bg-ink/5"
              >
                Manana
              </button>
              <input
                type="date"
                value={fechaSeleccionada}
                onChange={(event) => setFechaSeleccionada(event.target.value)}
                className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-mint focus:ring-4 focus:ring-mint/20"
              />
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-ink/15 bg-white text-sm font-bold shadow-sm">
              <button
                type="button"
                onClick={() => setVista("lista")}
                className={`px-4 py-2 transition ${
                  vista === "lista" ? "bg-ink text-white" : "text-ink/70 hover:bg-ink/5"
                }`}
              >
                Vista de lista
              </button>
              <button
                type="button"
                onClick={() => setVista("calendario")}
                className={`px-4 py-2 transition ${
                  vista === "calendario"
                    ? "bg-ink text-white"
                    : "text-ink/70 hover:bg-ink/5"
                }`}
              >
                Vista de calendario
              </button>
            </div>
          </div>
        </div>

        {eventos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink/20 bg-white/60 px-5 py-10 text-center text-ink/60">
            Todavia no hay eventos agendados para esta fecha.
          </div>
        ) : vista === "calendario" ? (
          <CalendarioGrid
            eventos={eventos}
            eliminandoId={eliminandoId}
            onEliminar={eliminarEvento}
            fecha={fechaSeleccionada}
          />
        ) : (
          <ul className="space-y-3">
            {eventos.map((evento) => (
              <li
                key={evento.id}
                className="rounded-lg border border-ink/10 bg-white px-4 py-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-ink">{evento.titulo}</h3>
                    <p className="mt-1 text-sm text-ink/65">
                      {evento.hora_sugerida} - {evento.duracion_minutos} min
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-fit rounded-full border px-3 py-1 text-xs font-bold uppercase ${prioridadClases[evento.prioridad]}`}
                    >
                      {evento.prioridad}
                    </span>
                    <button
                      type="button"
                      onClick={() => eliminarEvento(evento.id)}
                      disabled={eliminandoId === evento.id}
                      className="rounded-md border border-ink/15 px-3 py-1 text-xs font-bold text-ink/70 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Eliminar ${evento.titulo}`}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
