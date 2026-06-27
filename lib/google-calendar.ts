import { getSupabaseServerClient } from "@/lib/supabase";
import type { Evento } from "@/lib/events";

type TokensGoogleInput = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date;
};

type TokenGoogleRow = {
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEventResponse = {
  id?: string;
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_TIME_ZONE = "America/Lima";
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export async function guardarTokensGoogle(userId: string, tokens: TokensGoogleInput) {
  const supabase = getSupabaseServerClient();
  const tokenRow: Record<string, string> = {
    user_id: userId,
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.expiresAt.toISOString(),
    updated_at: new Date().toISOString()
  };

  if (tokens.refreshToken) {
    tokenRow.refresh_token = tokens.refreshToken;
  }

  const { error } = await supabase
    .from("tokens_google")
    .upsert(tokenRow, { onConflict: "user_id" });

  if (error) {
    throw new Error(`No se pudieron guardar los tokens de Google: ${error.message}`);
  }
}

async function obtenerTokensGuardados(userId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("tokens_google")
    .select("access_token, refresh_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudieron leer los tokens de Google: ${error.message}`);
  }

  return data as TokenGoogleRow | null;
}

function tokenEstaVencido(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + TOKEN_REFRESH_MARGIN_MS;
}

async function renovarAccessToken(userId: string, refreshToken: string) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Faltan AUTH_GOOGLE_ID o AUTH_GOOGLE_SECRET para renovar Google.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ??
        data.error ??
        "Google no devolvio un access_token renovado."
    );
  }

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await guardarTokensGoogle(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt
  });

  return data.access_token;
}

async function obtenerAccessTokenValido(userId: string) {
  const tokens = await obtenerTokensGuardados(userId);

  if (!tokens) {
    throw new Error("No hay tokens de Google guardados para este usuario.");
  }

  if (!tokenEstaVencido(tokens.access_token_expires_at)) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    throw new Error("No hay refresh_token de Google para renovar el acceso.");
  }

  return renovarAccessToken(userId, tokens.refresh_token);
}

function crearFechaHoraLocal(fecha: string, hora: string) {
  const [year, month, day] = fecha.split("-").map(Number);
  const [hours, minutes] = hora.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes));
}

function formatearFechaHoraGoogle(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}

function crearPayloadEvento(evento: Evento) {
  const inicio = crearFechaHoraLocal(evento.fecha, evento.hora_sugerida);
  const fin = new Date(inicio.getTime() + evento.duracion_minutos * 60_000);

  return {
    summary: evento.titulo,
    start: {
      dateTime: formatearFechaHoraGoogle(inicio),
      timeZone: CALENDAR_TIME_ZONE
    },
    end: {
      dateTime: formatearFechaHoraGoogle(fin),
      timeZone: CALENDAR_TIME_ZONE
    },
    extendedProperties: {
      private: {
        agendaia_event_id: evento.id,
        agendaia_prioridad: evento.prioridad
      }
    }
  };
}

async function leerErrorGoogle(response: Response) {
  const texto = await response.text();
  return texto.slice(0, 500) || response.statusText;
}

async function fetchGoogleCalendar(
  userId: string,
  url: string,
  init: RequestInit
) {
  const accessToken = await obtenerAccessTokenValido(userId);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Error(await leerErrorGoogle(response));
  }

  return response;
}

export async function crearEventoGoogleCalendar(userId: string, evento: Evento) {
  const response = await fetchGoogleCalendar(userId, GOOGLE_CALENDAR_EVENTS_URL, {
    method: "POST",
    body: JSON.stringify(crearPayloadEvento(evento))
  });
  const data = (await response.json()) as GoogleCalendarEventResponse;

  if (!data.id) {
    throw new Error("Google Calendar no devolvio id para el evento creado.");
  }

  return data.id;
}

export async function actualizarEventoGoogleCalendar(
  userId: string,
  googleEventId: string,
  evento: Evento
) {
  await fetchGoogleCalendar(
    userId,
    `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(googleEventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(crearPayloadEvento(evento))
    }
  );
}

export async function borrarEventoGoogleCalendar(
  userId: string,
  googleEventId: string
) {
  await fetchGoogleCalendar(
    userId,
    `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(googleEventId)}`,
    {
      method: "DELETE"
    }
  );
}
