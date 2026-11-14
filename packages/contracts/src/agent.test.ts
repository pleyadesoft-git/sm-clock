import { describe, expect, it } from 'vitest';
import {
  AgentChecadasBatchSchema,
  AgentEnrollRequestSchema,
  AgentHeartbeatSchema,
  AgentSignedHeadersSchema,
  getAgentContractsJsonSchema,
  resolveDeviceTimestampToUtc,
} from './agent';

describe('Agent Contracts & America/Tijuana DST Resolution', () => {
  it('validates enrollment request and rejects short enrollment codes', () => {
    const valid = AgentEnrollRequestSchema.safeParse({
      codigo_enrolamiento: 'ENROL-TIJ001-98A7B6C5D4E3',
      nombre_agente: 'SRV-OTAY-AGENT01',
      version: '1.0.0',
      hostname: 'WIN-OTAY-01',
    });
    expect(valid.success).toBe(true);

    const invalid = AgentEnrollRequestSchema.safeParse({
      codigo_enrolamiento: 'SHORT',
      nombre_agente: 'A',
      version: '',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates punch batches up to 500 items and rejects empty batches', () => {
    const validBatch = AgentChecadasBatchSchema.safeParse({
      lote_id: 'batch-2026-11-01-001',
      checadas: [
        {
          fuente_id: '11111111-0003-4000-8000-000000000001',
          codigo_empleado: '1001',
          ts_utc: '2026-11-01T08:30:00.000Z',
          ts_dispositivo_local: '2026-11-01 01:30:00',
          ambigua: true,
          tipo_marca: 'ENTRADA',
          tipo_verificacion: 'HUELLA',
        },
      ],
    });
    expect(validBatch.success).toBe(true);

    const emptyBatch = AgentChecadasBatchSchema.safeParse({
      lote_id: 'batch-empty',
      checadas: [],
    });
    expect(emptyBatch.success).toBe(false);
  });

  it('detects the repeated autumn DST hour in America/Tijuana (ambigua = true) and distinguishes fold 0 vs fold 1', () => {
    // Primer domingo de noviembre 2026 (2026-11-01): a las 02:00 PDT (UTC-7) el reloj vuelve a 01:00 PST (UTC-8)
    const fold0 = resolveDeviceTimestampToUtc(
      '2026-11-01 01:30:00',
      'America/Tijuana',
      0,
    );
    const fold1 = resolveDeviceTimestampToUtc(
      '2026-11-01 01:30:00',
      'America/Tijuana',
      1,
    );

    expect(fold0.ambigua).toBe(true);
    expect(fold1.ambigua).toBe(true);
    expect(fold0.ts_utc).toBe('2026-11-01T08:30:00.000Z'); // UTC-7 (PDT)
    expect(fold1.ts_utc).toBe('2026-11-01T09:30:00.000Z'); // UTC-8 (PST)
  });

  it('resolves normal standard and daylight timestamps in America/Tijuana with ambigua = false', () => {
    const winter = resolveDeviceTimestampToUtc(
      '2026-01-15 08:00:00',
      'America/Tijuana',
    );
    expect(winter.ambigua).toBe(false);
    expect(winter.ts_utc).toBe('2026-01-15T16:00:00.000Z'); // UTC-8

    const summer = resolveDeviceTimestampToUtc(
      '2026-07-15 08:00:00',
      'America/Tijuana',
    );
    expect(summer.ambigua).toBe(false);
    expect(summer.ts_utc).toBe('2026-07-15T15:00:00.000Z'); // UTC-7
  });

  it('validates heartbeat and HMAC signed headers and exports JSON Schema', () => {
    const hb = AgentHeartbeatSchema.safeParse({
      version: '1.0.0',
      ts_local_agente: '2026-11-13T09:00:00-08:00',
      cola_pendiente: 12,
      fuentes_estado: [
        {
          fuente_id: '11111111-0003-4000-8000-000000000001',
          conectado: true,
          ultimo_error: null,
        },
      ],
    });
    expect(hb.success).toBe(true);

    const headers = AgentSignedHeadersSchema.safeParse({
      'x-agent-id': '11111111-0004-4000-8000-000000000001',
      'x-agent-timestamp': '1763053200',
      'x-agent-nonce': 'nonce_0123456789abcdef',
      'x-agent-signature': 'a'.repeat(64),
    });
    expect(headers.success).toBe(true);

    const schema = getAgentContractsJsonSchema();
    expect(schema).toHaveProperty('definitions');
  });
});
