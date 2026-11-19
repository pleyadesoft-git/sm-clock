export interface AgentStatus {
  bind: string;
  version: string;
  agente_id: string | null;
  tenant_id: string | null;
  server_url: string;
  zona_horaria: string;
  sqlite_journal_mode: string;
  cola_pendiente: number;
  cola_total: number;
  ts_utc: string;
  ultimo_latido_ts: string | null;
  desvio_reloj_segundos: number;
  alerta_desvio_reloj: boolean;
  relojes_locales_count: number;
  session?: {
    email: string;
    nombre: string;
    rol: string;
    tenant_id: string | null;
  } | null;
}

export interface ClockRecord {
  id: string;
  nombre: string;
  tipo: 'ZKTECO' | 'HIKVISION' | 'TACLOUD';
  ip: string;
  puerto: number;
  comm_key: number;
  usuario?: string | null;
  has_password?: boolean;
  activo: boolean;
  sucursal_id?: string | null;
  clave?: string | null;
  consecutivo_sucursal?: number | null;
  ultimo_ping?: string | null;
  ultimo_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  mensaje: string;
  latencia_ms: number;
}

export interface TestReadRecordsResult {
  ok: boolean;
  mensaje: string;
  total_registros: number;
  registros: Array<{
    codigo_empleado?: string;
    ts_local?: string;
    tipo_marca?: string;
    metodo?: string;
  }>;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  logger: string;
  message: string;
  traceback?: string | null;
}

export interface LogsResponse {
  ok: boolean;
  counts: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  logs: LogEntry[];
}

export interface QueuedPunchItem {
  id: number;
  fuente_id: string;
  codigo_empleado: string;
  ts_utc: string;
  ts_dispositivo_local: string;
  ambigua: boolean;
  tipo_marca: string;
  tipo_verificacion: string;
  sincronizado: boolean;
}

export interface QueueResponse {
  pendientes_count: number;
  total_count: number;
  checadas: QueuedPunchItem[];
}

const BASE_URL = 'http://127.0.0.1:8085';

async function agentFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    let errorDetail = `Error ${res.status}: ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.detail) errorDetail = data.detail;
      else if (data?.mensaje) errorDetail = data.mensaje;
    } catch {
      // Ignorar si no es JSON
    }
    throw new Error(errorDetail);
  }

  return res.json() as Promise<T>;
}

export interface AgentUserData {
  email: string;
  nombre?: string;
  nombre_completo?: string;
  rol: 'SUPER_ADMIN' | 'ADMIN_EMPRESA' | 'OPERADOR';
  tenant_id: string | null;
}

export interface LatidoResponse {
  ok: boolean;
  latencia_ms?: number;
  desvio_segundos?: number;
  mensaje?: string;
}

export interface EnrollResponse {
  ok: boolean;
  agente_id?: string;
  mensaje?: string;
}

export interface TriggeredNotificationItem {
  id: number;
  mensaje_id: string;
  codigo_empleado: string;
  nombre_empleado: string;
  tipo_marca: 'ENTRADA' | 'SALIDA' | 'CHECADA';
  titulo: string;
  mensaje: string;
  texto_voz: string;
  reproducir_audio: boolean;
  canal_utilizado: string;
  estatus_entrega: string;
  whatsapp_web_url?: string | null;
  ts_utc: string;
  leida: boolean;
  created_at: string;
}

export interface RecentNotificationsResponse {
  ok: boolean;
  no_leidas_count: number;
  notificaciones: TriggeredNotificationItem[];
}

export const agentApi = {
  getStatus: () => agentFetch<AgentStatus>('/api/status'),

  getQueue: (limit = 50) => agentFetch<QueueResponse>(`/api/queue?limit=${limit}`),

  getRecentNotifications: (limit = 20, soloNoLeidas = false) =>
    agentFetch<RecentNotificationsResponse>(
      `/api/mensajes/recientes?limit=${limit}&solo_no_leidas=${soloNoLeidas ? 'true' : 'false'}`,
    ),

  markNotificationRead: (id: number) =>
    agentFetch<{ ok: boolean; id: number }>('/api/mensajes/marcar-leida', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  simulateNotification: (payload?: {
    codigo_empleado?: string;
    nombre_empleado?: string;
    tipo_marca?: 'ENTRADA' | 'SALIDA';
    titulo?: string;
    mensaje?: string;
    texto_voz_personalizado?: string;
  }) =>
    agentFetch<{ ok: boolean; id: number; notificacion: TriggeredNotificationItem | null }>(
      '/api/mensajes/simular',
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
    ),

  getLogs: (level?: string, search?: string, limit = 100) => {
    const params = new URLSearchParams();
    if (level) params.append('level', level);
    if (search) params.append('search', search);
    params.append('limit', String(limit));
    return agentFetch<LogsResponse>(`/api/logs?${params.toString()}`);
  },

  clearLogs: () => agentFetch<{ ok: boolean; mensaje: string }>('/api/logs/clear', { method: 'POST' }),

  listRelojes: () => agentFetch<ClockRecord[]>('/api/relojes'),

  saveReloj: (reloj: Partial<ClockRecord> & { password?: string }) =>
    agentFetch<{ ok: boolean; id: string; mensaje: string }>('/api/relojes', {
      method: 'POST',
      body: JSON.stringify(reloj),
    }),

  deleteReloj: (id: string) =>
    agentFetch<{ ok: boolean; mensaje: string }>(`/api/relojes/${id}`, {
      method: 'DELETE',
    }),

  testConnection: (payload: {
    id?: string;
    tipo: string;
    ip: string;
    puerto: number;
    comm_key?: number;
    usuario?: string;
    password?: string;
  }) => agentFetch<TestConnectionResult>('/api/relojes/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  testReadRecords: (payload: {
    id?: string;
    tipo: string;
    ip: string;
    puerto: number;
    comm_key?: number;
    usuario?: string;
    password?: string;
  }) => agentFetch<TestReadRecordsResult>('/api/relojes/test-read', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  login: (payload: { email?: string; password?: string; pin_emergencia?: string; server_url?: string }) =>
    agentFetch<{ ok: boolean; token: string; usuario: AgentUserData }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMe: () => agentFetch<{ authenticated: boolean; usuario: AgentUserData | null }>('/api/auth/me'),

  logout: () => agentFetch<{ ok: boolean; mensaje: string }>('/api/auth/logout', { method: 'POST' }),

  triggerSync: () => agentFetch<{ ok: boolean; mensaje: string }>('/api/sync/manual', { method: 'POST' }),

  triggerReconciliation: () =>
    agentFetch<{ ok: boolean; mensaje: string }>('/api/sync/reconciliar', { method: 'POST' }),

  testLatido: (serverUrl?: string) =>
    agentFetch<LatidoResponse>('/api/diagnostico/test-latido', {
      method: 'POST',
      body: JSON.stringify({ server_url: serverUrl }),
    }),

  enroll: (code: string, name?: string, serverUrl?: string) =>
    agentFetch<EnrollResponse>('/api/diagnostico/enrolar', {
      method: 'POST',
      body: JSON.stringify({
        codigo_enrolamiento: code,
        nombre_agente: name || 'Agente Local',
        server_url: serverUrl,
      }),
    }),

  reportAlert: (payload: {
    tipo_error: string;
    mensaje: string;
    detalle?: string | null;
    dispositivo?: string | null;
    fuente_id?: string | null;
    force?: boolean;
  }) =>
    agentFetch<{ ok: boolean; mensaje: string }>('/api/alertas/reportar', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
