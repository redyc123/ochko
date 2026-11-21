import type { LatLng, Route, RouteProfile } from '../nav/types';

/**
 * Thin HTTP client for the О.Ч.К.О. server. All agent logic and external
 * integrations (LLM/GigaChat, geocoding Nominatim, routing OSRM, STT) live on
 * the server; the client only calls these endpoints, keeps the session alive,
 * and executes the structured actions the server returns.
 */

export const DEFAULT_PROXY_URL =
  process.env.EXPO_PUBLIC_AGENT_PROXY_URL ?? 'http://localhost:8787';

export class ServerError extends Error {
  readonly status: number;
  readonly cause?: unknown;
  constructor(message: string, status = 0, cause?: unknown) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface ServerGeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

export interface ServerGeocodeParams {
  query: string;
  position?: LatLng | null;
  limit?: number;
}

export async function geocode(
  baseUrl: string,
  params: ServerGeocodeParams,
): Promise<ServerGeocodeResult[]> {
  const res = await fetch(`${trimTrailingSlash(baseUrl)}/geocode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json().catch(() => ({}))) as {
    results?: ServerGeocodeResult[];
    error?: string;
  };
  if (!res.ok || !data.results) {
    throw new ServerError(data.error ?? `Геокодинг не удался (${res.status})`, res.status);
  }
  return data.results;
}

export interface ServerRouteParams {
  from: LatLng;
  to: LatLng;
  profile?: RouteProfile;
}

export async function buildRoute(
  baseUrl: string,
  params: ServerRouteParams,
): Promise<Route> {
  const res = await fetch(`${trimTrailingSlash(baseUrl)}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json().catch(() => ({}))) as {
    route?: Route;
    error?: string;
  };
  if (!res.ok || !data.route) {
    throw new ServerError(data.error ?? `Маршрут не удался (${res.status})`, res.status);
  }
  return data.route;
}

/** Structured, client-executable action returned by the server /agent. */
export type ServerAgentAction =
  | { type: 'start_route'; destination: LatLng; route: Route }
  | { type: 'stop_navigation' };

export interface ServerAgentReply {
  display: string;
  full: string;
  candidates: ServerGeocodeResult[];
  actions: ServerAgentAction[];
}

export interface ServerAgentContext {
  position: LatLng | null;
  nav_status: string; // NavStatus string sent by client (server derives what it needs from it)
}

export interface ServerAgentParams {
  session_id?: string | null;
  user_text: string;
  context: ServerAgentContext;
}

export interface ServerAgentResult {
  session_id: string;
  reply: ServerAgentReply;
}

export async function agentTurn(
  baseUrl: string,
  params: ServerAgentParams,
): Promise<ServerAgentResult> {
  const res = await fetch(`${trimTrailingSlash(baseUrl)}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json().catch(() => ({}))) as
    | ServerAgentResult
    | { error?: string };
  if (!res.ok || !('session_id' in data) || !data.session_id) {
    const msg = 'error' in data && data.error ? data.error : `Ошибка сервера (${res.status})`;
    throw new ServerError(msg, res.status);
  }
  return data as ServerAgentResult;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}