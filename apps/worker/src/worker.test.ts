import { describe, expect, it } from 'vitest';
import { createBossInstance, QUEUE_NAMES, WorkerEnvSchema } from './index';

describe('@sm-clock/worker — pg-boss skeleton', () => {
  it('validates worker environment variables with Zod', () => {
    const valid = WorkerEnvSchema.safeParse({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:54322/postgres',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.WORKER_SCHEMA).toBe('pgboss');
      const boss = createBossInstance(valid.data);
      expect(boss).toBeDefined();
    }

    const invalid = WorkerEnvSchema.safeParse({
      DATABASE_URL: 'not-a-url',
    });
    expect(invalid.success).toBe(false);
  });

  it('defines expected queue names for Fase 0 foundation', () => {
    expect(QUEUE_NAMES.EXPORT_LARGE_REPORT).toBe('export-large-report');
    expect(QUEUE_NAMES.PAYROLL_OUTBOX_DISPATCH).toBe('payroll-outbox-dispatch');
    expect(QUEUE_NAMES.BILLING_MONTHLY_CHARGES).toBe('billing-monthly-charges');
  });
});
