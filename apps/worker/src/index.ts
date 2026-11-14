import { PgBoss } from 'pg-boss';
import { z } from 'zod';

export const WorkerEnvSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL de Postgres válida'),
  WORKER_SCHEMA: z.string().min(1).default('pgboss'),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export const QUEUE_NAMES = {
  EXPORT_LARGE_REPORT: 'export-large-report',
  PAYROLL_OUTBOX_DISPATCH: 'payroll-outbox-dispatch',
  BILLING_MONTHLY_CHARGES: 'billing-monthly-charges',
} as const;

export function createBossInstance(env: WorkerEnv): PgBoss {
  return new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.WORKER_SCHEMA,
  });
}

export async function startWorker(rawEnv: Record<string, string | undefined>): Promise<PgBoss> {
  const parsed = WorkerEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    throw new Error(`Configuración inválida del worker: ${parsed.error.message}`);
  }

  const boss = createBossInstance(parsed.data);
  await boss.start();

  for (const queueName of Object.values(QUEUE_NAMES)) {
    await boss.createQueue(queueName);
  }

  return boss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker(process.env).catch((err: unknown) => {
    console.error('[worker] Error fatal al iniciar pg-boss:', err);
    process.exit(1);
  });
}
