import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, '../..');
  const baseEnv = loadEnv(mode, rootDir, ['VITE_', 'NEXT_PUBLIC_']);

  // .env.local siempre debe tener máxima prioridad (emulando la regla de Next.js)
  const rootLocalEnv = parseEnvFile(path.resolve(rootDir, '.env.local'));
  const desktopLocalEnv = parseEnvFile(path.resolve(__dirname, '.env.local'));

  const mergedEnv: Record<string, string> = {
    ...baseEnv,
  };

  for (const [k, v] of Object.entries({ ...rootLocalEnv, ...desktopLocalEnv })) {
    if (k.startsWith('VITE_') || k.startsWith('NEXT_PUBLIC_')) {
      mergedEnv[k] = v;
    }
  }

  // En CI/CD (GitHub Actions), las variables vienen inyectadas en process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (v && (k.startsWith('VITE_') || k.startsWith('NEXT_PUBLIC_'))) {
      mergedEnv[k] = v;
    }
  }

  const defineEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(mergedEnv)) {
    defineEnv[`import.meta.env.${k}`] = JSON.stringify(v);
  }

  return {
    plugins: [react()],
    base: './',
    root: path.resolve(__dirname, 'src/renderer'),
    envDir: rootDir,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: defineEnv,
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer/src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});

