"use client";

type Prioridad = "alta" | "media" | "baja";

export type EventoCalendario = {
  id: string;
  fecha: string;
  titulo: string;
  duracion_minutos: number;
  hora_sugerida: string;
  prioridad: Prioridad;
};

type CalendarioGridProps = {
  eventos: EventoCalendario[];
  eliminandoId: string | null;
  onEliminar: (id: string) => void;
  onEditar: (evento: EventoCalendario) => void;
  fecha: string;
};

type EventoPosicionado = {
  evento: EventoCalendario;
  inicio: number;
  fin: number;
  columna: number;
  columnas: number;
};

const HORA_INICIO = 6;
const HORA_FIN = 24;
const ALTURA_HORA = 72;
const MINUTOS_INICIO = HORA_INICIO * 60;
const MINUTOS_FIN = HORA_FIN * 60;
const HORAS = Array.from(
  { length: HORA_FIN - HORA_INICIO + 1 },
  (_, index) => HORA_INICIO + index
);

const prioridadGridClases: Record<Prioridad, string> = {
  alta: "border-red-200 bg-red-50 text-red-700",
  media: "border-amber-200 bg-amber-50 text-amber-700",
  baja: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

function minutosDesdeHora(hora: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!match) return null;

  const horas = Number(match[1]);
  const minutos = Number(match[2]);

  if (horas > 23 || minutos > 59) return null;
  return horas * 60 + minutos;
}

function posicionarEventos(eventos: EventoCalendario[]) {
  const candidatos = eventos
    .map((evento) => {
      const inicio = minutosDesdeHora(evento.hora_sugerida);
      if (inicio === null) return null;

      return {
        evento,
        inicio,
        fin: inicio + evento.duracion_minutos
      };
    })
    .filter((evento): evento is Omit<EventoPosicionado, "columna" | "columnas"> =>
      Boolean(evento && evento.fin > MINUTOS_INICIO && evento.inicio < MINUTOS_FIN)
    )
    .sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);

  const grupos: Array<typeof candidatos> = [];
  let grupoActual: typeof candidatos = [];
  let finGrupoActual = 0;

  for (const evento of candidatos) {
    if (grupoActual.length === 0 || evento.inicio < finGrupoActual) {
      grupoActual.push(evento);
      finGrupoActual = Math.max(finGrupoActual, evento.fin);
    } else {
      grupos.push(grupoActual);
      grupoActual = [evento];
      finGrupoActual = evento.fin;
    }
  }

  if (grupoActual.length > 0) {
    grupos.push(grupoActual);
  }

  return grupos.flatMap((grupo) => {
    const finalesPorColumna: number[] = [];
    const posicionados = grupo.map((evento) => {
      const columnaDisponible = finalesPorColumna.findIndex((fin) => fin <= evento.inicio);
      const columna =
        columnaDisponible === -1 ? finalesPorColumna.length : columnaDisponible;

      finalesPorColumna[columna] = evento.fin;

      return {
        ...evento,
        columna,
        columnas: 1
      };
    });

    return posicionados.map((evento) => ({
      ...evento,
      columnas: finalesPorColumna.length
    }));
  });
}

function formatoHora(hora: number) {
  if (hora === 24) return "00:00";
  return `${String(hora).padStart(2, "0")}:00`;
}

export default function CalendarioGrid({
  eventos,
  eliminandoId,
  onEliminar,
  onEditar,
  fecha
}: CalendarioGridProps) {
  const eventosPosicionados = posicionarEventos(eventos);
  const alturaTotal = (HORA_FIN - HORA_INICIO) * ALTURA_HORA;

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-sm">
      <div className="grid grid-cols-[4.5rem_1fr] border-b border-ink/10 bg-white px-3 py-3 text-sm font-bold text-ink">
        <div>{fecha}</div>
        <div>6:00 - 00:00</div>
      </div>

      <div className="max-h-[68vh] overflow-y-auto">
        <div
          className="relative grid grid-cols-[4.5rem_1fr]"
          style={{ height: `${alturaTotal}px` }}
        >
          <div className="relative border-r border-ink/10 bg-paper/45">
            {HORAS.slice(0, -1).map((hora) => (
              <div
                key={hora}
                className="absolute right-2 -translate-y-2 text-xs font-semibold text-ink/55"
                style={{ top: `${(hora - HORA_INICIO) * ALTURA_HORA}px` }}
              >
                {formatoHora(hora)}
              </div>
            ))}
          </div>

          <div className="relative">
            {HORAS.slice(0, -1).map((hora) => (
              <div
                key={hora}
                className="absolute left-0 right-0 border-t border-ink/10"
                style={{ top: `${(hora - HORA_INICIO) * ALTURA_HORA}px` }}
              />
            ))}

            {eventosPosicionados.map(({ evento, inicio, fin, columna, columnas }) => {
              const inicioVisible = Math.max(inicio, MINUTOS_INICIO);
              const finVisible = Math.min(fin, MINUTOS_FIN);
              const top = ((inicioVisible - MINUTOS_INICIO) / 60) * ALTURA_HORA;
              const height = Math.max(
                2,
                ((finVisible - inicioVisible) / 60) * ALTURA_HORA - 4
              );
              const width = `calc(${100 / columnas}% - 0.375rem)`;
              const left = `calc(${(100 / columnas) * columna}% + 0.1875rem)`;

              return (
                <article
                  key={evento.id}
                  className={`absolute overflow-hidden rounded-md border px-2 py-1.5 shadow-sm ${prioridadGridClases[evento.prioridad]}`}
                  style={{ top: `${top + 2}px`, height: `${height}px`, left, width }}
                >
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex items-start justify-between gap-1">
                      <p className="min-w-0 truncate text-xs font-bold leading-tight">
                        {evento.titulo}
                      </p>
                      <button
                        type="button"
                        onClick={() => onEliminar(evento.id)}
                        disabled={eliminandoId === evento.id}
                        className="shrink-0 rounded border border-current/20 px-1 text-[10px] font-bold leading-4 opacity-75 transition hover:bg-white/70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Eliminar ${evento.titulo}`}
                      >
                        X
                      </button>
                    </div>
                    <p className="mt-1 truncate text-[11px] leading-tight opacity-75">
                      {evento.hora_sugerida} - {evento.duracion_minutos} min
                    </p>
                    <button
                      type="button"
                      onClick={() => onEditar(evento)}
                      className="mt-auto w-fit rounded border border-current/20 px-1.5 text-[10px] font-bold leading-4 opacity-75 transition hover:bg-white/70 hover:opacity-100"
                    >
                      Editar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
