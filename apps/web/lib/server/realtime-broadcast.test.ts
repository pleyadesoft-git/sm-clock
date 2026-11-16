import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  broadcastAdminEvent,
  broadcastTenantEvent,
} from './realtime-broadcast';
import * as supabaseAdmin from './supabase-admin';

describe('realtime-broadcast utility', () => {
  const mockSend = vi.fn().mockResolvedValue('ok');
  const mockRemoveChannel = vi.fn().mockResolvedValue('ok');
  const mockChannel = vi.fn().mockReturnValue({
    send: mockSend,
  });

  const mockAdminClient = {
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(supabaseAdmin, 'createSupabaseAdminClient').mockReturnValue(
      mockAdminClient as unknown as ReturnType<typeof supabaseAdmin.createSupabaseAdminClient>,
    );
  });

  it('broadcastTenantEvent emite evento al canal primario del tenant y al legacy si es nueva_checada', async () => {
    await broadcastTenantEvent('tenant-123', 'nueva_checada', { count: 5 });

    expect(mockChannel).toHaveBeenCalledWith('tenant:tenant-123', {
      config: { broadcast: { ack: false } },
    });
    expect(mockChannel).toHaveBeenCalledWith('tenant:tenant-123:checadas', {
      config: { broadcast: { ack: false } },
    });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'nueva_checada',
        payload: expect.objectContaining({
          tenant_id: 'tenant-123',
          count: 5,
        }),
      }),
    );
  });

  it('broadcastTenantEvent emite únicamente al canal principal para otros eventos', async () => {
    await broadcastTenantEvent('tenant-123', 'empleados_changed', { empleado_id: 'emp-1' });

    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith('tenant:tenant-123', {
      config: { broadcast: { ack: false } },
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'empleados_changed',
        payload: expect.objectContaining({
          empleado_id: 'emp-1',
        }),
      }),
    );
  });

  it('broadcastAdminEvent emite evento al canal admin:events', async () => {
    await broadcastAdminEvent('agentes_changed', { agente_id: 'ag-1' });

    expect(mockChannel).toHaveBeenCalledWith('admin:events', {
      config: { broadcast: { ack: false } },
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'agentes_changed',
        payload: expect.objectContaining({
          agente_id: 'ag-1',
        }),
      }),
    );
  });

  it('no arroja error si el cliente de supabase falla en realtime', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error on broadcast'));

    await expect(
      broadcastTenantEvent('tenant-123', 'empleados_changed'),
    ).resolves.toBeUndefined();
  });
});
