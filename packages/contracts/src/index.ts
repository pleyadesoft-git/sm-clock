import { z } from 'zod';

// Configurar Zod en modo jitless para entornos con Content-Security-Policy estricto (sin 'unsafe-eval')
z.config({ jitless: true });

export * from './sanitize';
export * from './auth';
export * from './tenant';
export * from './agent';
export * from './empleado';
export * from './usuarios';
export * from './mensajes';
export * from './fuentes';
export * from './db.types';
