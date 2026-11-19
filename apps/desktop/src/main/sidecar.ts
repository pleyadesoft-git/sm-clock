import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

export interface SidecarStatus {
  running: boolean;
  pid: number | null;
  port: number;
  url: string;
  error: string | null;
  restarts: number;
}

export type LogListener = (entry: { timestamp: string; level: string; message: string }) => void;

export class SidecarManager {
  private process: ChildProcess | null = null;
  private port = 8085;
  private isShuttingDown = false;
  private restarts = 0;
  private lastError: string | null = null;
  private logListeners: LogListener[] = [];
  private logBuffer: Array<{ timestamp: string; level: string; message: string }> = [];
  private maxBufferedLogs = 500;

  constructor(port = 8085) {
    this.port = port;
  }

  public onLog(listener: LogListener): () => void {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  public getRecentLogs(): Array<{ timestamp: string; level: string; message: string }> {
    return [...this.logBuffer];
  }

  private appendLog(level: string, message: string) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: message.trim(),
    };
    if (this.logBuffer.length >= this.maxBufferedLogs) {
      this.logBuffer.shift();
    }
    this.logBuffer.push(entry);
    for (const listener of this.logListeners) {
      try {
        listener(entry);
      } catch {
        // Ignorar listener descolgado
      }
    }
  }

  private findBinaryOrScript(): { cmd: string; args: string[]; cwd: string } {
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'sm-clock-agent.exe' : 'sm-clock-agent';

    // 1. Probar en ruta de empaquetado Resources (producción)
    const packagedBinPath = path.join(process.resourcesPath || '', 'agent', binaryName);
    if (fs.existsSync(packagedBinPath)) {
      return {
        cmd: packagedBinPath,
        args: ['run', '--no-browser', '--port', String(this.port)],
        cwd: path.dirname(packagedBinPath),
      };
    }

    // 2. Probar en agent/dist/ (desarrollo con binario compilado)
    const projectRoot = path.resolve(app.getAppPath(), '..', '..');
    const localDistBin = path.join(projectRoot, 'agent', 'dist', binaryName);
    if (fs.existsSync(localDistBin)) {
      return {
        cmd: localDistBin,
        args: ['run', '--no-browser', '--port', String(this.port)],
        cwd: path.dirname(localDistBin),
      };
    }

    // 3. Fallback: Python venv del proyecto en desarrollo
    const venvPython = isWindows
      ? path.join(projectRoot, 'agent', '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'agent', '.venv', 'bin', 'python');

    const agentRunScript = path.join(projectRoot, 'agent', 'run.py');
    const agentCwd = path.join(projectRoot, 'agent');

    if (fs.existsSync(venvPython) && fs.existsSync(agentRunScript)) {
      return {
        cmd: venvPython,
        args: [agentRunScript, 'run', '--no-browser', '--port', String(this.port)],
        cwd: agentCwd,
      };
    }

    // 4. Fallback final al PATH del sistema
    return {
      cmd: isWindows ? 'python' : 'python3',
      args: [agentRunScript, 'run', '--no-browser', '--port', String(this.port)],
      cwd: agentCwd,
    };
  }

  public async start(): Promise<void> {
    if (this.process && !this.process.killed) {
      return;
    }

    this.isShuttingDown = false;
    const { cmd, args, cwd } = this.findBinaryOrScript();

    // Asegurar directorio de datos de usuario para la BD SQLite
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'agent.sqlite');
    const fullArgs = [...args, '--db', dbPath];

    this.appendLog('INFO', `Iniciando motor Python: ${cmd} ${fullArgs.join(' ')} (CWD: ${cwd})`);

    try {
      this.process = spawn(cmd, fullArgs, {
        cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          LOCAL_DIAGNOSTIC_PORT: String(this.port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString('utf8').split('\n');
        for (const line of lines) {
          if (line.trim()) {
            this.appendLog('INFO', line);
          }
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString('utf8').split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const isWarnOrErr = line.includes('ERROR') || line.includes('Traceback') ? 'ERROR' : 'WARN';
            this.appendLog(isWarnOrErr, line);
          }
        }
      });

      this.process.on('error', (err) => {
        this.lastError = err.message;
        this.appendLog('ERROR', `Error en proceso del agente: ${err.message}`);
      });

      this.process.on('close', (code) => {
        this.appendLog('WARN', `El proceso del agente finalizó con código ${code}`);
        this.process = null;

        if (!this.isShuttingDown) {
          this.restarts++;
          this.appendLog('INFO', `Reintentando arranque automático en 3 segundos (intento ${this.restarts})...`);
          setTimeout(() => {
            if (!this.isShuttingDown) {
              this.start().catch((err) => {
                this.appendLog('ERROR', `Fallo al autoreiniciar agente: ${err.message}`);
              });
            }
          }, 3000);
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.appendLog('ERROR', `No se pudo iniciar el agente: ${msg}`);
      throw err;
    }
  }

  public async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.process && !this.process.killed) {
      this.appendLog('INFO', 'Deteniendo proceso del agente...');
      const pid = this.process.pid;
      if (process.platform === 'win32' && pid) {
        try {
          const { execSync } = await import('child_process');
          execSync(`taskkill /pid ${pid} /T /F`);
        } catch {
          // Si el proceso ya cerró
        }
      } else {
        this.process.kill('SIGTERM');
      }
      const proc = this.process;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
          resolve();
        }, 3000);

        proc.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.process = null;
    }
  }

  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  public getStatus(): SidecarStatus {
    return {
      running: Boolean(this.process && !this.process.killed),
      pid: this.process?.pid ?? null,
      port: this.port,
      url: `http://127.0.0.1:${this.port}`,
      error: this.lastError,
      restarts: this.restarts,
    };
  }
}
