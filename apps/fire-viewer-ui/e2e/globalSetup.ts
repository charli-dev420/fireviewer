import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { FullConfig } from '@playwright/test';

const execFileAsync = promisify(execFile);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(currentDirectory, '..');
const repositoryRoot = resolve(uiRoot, '..', '..');
const backendRoot = resolve(repositoryRoot, 'services', 'fire-viewer-backend');

const UI_ORIGIN = 'http://localhost:5173';
const API_ORIGIN = 'http://localhost:8000';
const startupTimeoutMs = 15_000;

interface ManagedProcess {
  readonly child: ChildProcess;
  readonly label: string;
  output: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function appendOutput(processInfo: ManagedProcess, chunk: Buffer): void {
  processInfo.output = `${processInfo.output}${chunk.toString()}`.slice(-12_000);
}

function startProcess(
  label: string,
  command: string,
  argumentsList: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(command, argumentsList, {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const processInfo: ManagedProcess = { child, label, output: '' };
  child.stdout?.on('data', (chunk: Buffer) => appendOutput(processInfo, chunk));
  child.stderr?.on('data', (chunk: Buffer) => appendOutput(processInfo, chunk));
  child.once('error', (error) => {
    appendOutput(processInfo, Buffer.from(`${label} failed to start: ${error.message}\n`));
  });
  return processInfo;
}

async function runCommand(
  label: string,
  command: string,
  argumentsList: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const processInfo = startProcess(label, command, argumentsList, cwd, environment);
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    processInfo.child.once('exit', (code) => resolveExit(code));
    processInfo.child.once('error', rejectExit);
  });
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.\n${processInfo.output}`);
  }
}

async function waitForHttp(url: string, processInfo: ManagedProcess): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = 'No response received.';
  while (Date.now() < deadline) {
    if (processInfo.child.exitCode !== null) {
      throw new Error(
        `${processInfo.label} exited before becoming ready.\n${processInfo.output}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(
    `${processInfo.label} did not become ready at ${url}: ${lastError}\n${processInfo.output}`,
  );
}

async function assertPortAvailable(port: number, label: string): Promise<void> {
  await new Promise<void>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', (error) => {
      rejectPort(new Error(`${label} requires 127.0.0.1:${port}, but the port is unavailable: ${error.message}`));
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort();
      });
    });
  });
}

async function stopProcess(processInfo: ManagedProcess | undefined): Promise<void> {
  if (!processInfo || processInfo.child.exitCode !== null || processInfo.child.pid === undefined) return;

  try {
    processInfo.child.kill();
  } catch {
    return;
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => processInfo.child.once('exit', () => resolveExit(true))),
    sleep(2_000).then(() => false),
  ]);
  if (exited || processInfo.child.exitCode !== null) return;

  // `taskkill /T` only receives the PID returned by our own spawn above, so it cannot
  // target an unrelated process. It is required on Windows when Vite leaves a child alive.
  await execFileAsync('taskkill', ['/PID', String(processInfo.child.pid), '/T', '/F']).catch(
    () => undefined,
  );
}

function assertSafeTemporaryDirectory(temporaryDirectory: string): void {
  const temporaryRoot = resolve(tmpdir());
  const resolvedDirectory = resolve(temporaryDirectory);
  const pathFromTemporaryRoot = relative(temporaryRoot, resolvedDirectory);
  if (
    pathFromTemporaryRoot.length === 0 ||
    pathFromTemporaryRoot.startsWith('..') ||
    isAbsolute(pathFromTemporaryRoot) ||
    !basename(resolvedDirectory).startsWith('fire-viewer-e2e-')
  ) {
    throw new Error(`Refusing to remove a non-E2E temporary directory: ${resolvedDirectory}`);
  }
}

async function removeTemporaryDirectory(temporaryDirectory: string): Promise<void> {
  assertSafeTemporaryDirectory(temporaryDirectory);
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function resolveBackendPython(): Promise<string> {
  const configured = process.env.FV_E2E_BACKEND_PYTHON;
  const defaultPython =
    process.platform === 'win32'
      ? join(backendRoot, '.venv', 'Scripts', 'python.exe')
      : join(backendRoot, '.venv', 'bin', 'python');
  const python = configured ?? defaultPython;
  await access(python);
  return python;
}

async function resolveSeedCommand(): Promise<string> {
  const command =
    process.platform === 'win32'
      ? join(backendRoot, '.venv', 'Scripts', 'fire-viewer-seed.exe')
      : join(backendRoot, '.venv', 'bin', 'fire-viewer-seed');
  await access(command);
  return command;
}

function sqliteUrl(databasePath: string): string {
  return `sqlite:///${databasePath.replace(/\\/g, '/')}`;
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  await assertPortAvailable(8000, 'Uvicorn E2E API');
  await assertPortAvailable(5173, 'Vite E2E UI');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'fire-viewer-e2e-'));
  const databasePath = join(temporaryDirectory, 'fire_viewer_e2e.sqlite');
  const zoneUploadStorageDirectory = join(temporaryDirectory, 'zone_uploads');
  const databaseUrl = sqliteUrl(databasePath);
  const backendEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    FV_ENVIRONMENT: 'test',
    FV_AUTH_MODE: 'disabled',
    FV_DATABASE_URL: databaseUrl,
    // Les archives E2E doivent rester dans le répertoire temporaire qui sera
    // détruit à la fin du run, jamais dans data/ du dépôt développeur.
    FV_ZONE_UPLOAD_STORAGE_DIR: zoneUploadStorageDirectory,
    FV_CORS_ORIGINS: JSON.stringify([UI_ORIGIN]),
    FV_TRUSTED_HOSTS: JSON.stringify(['localhost', '127.0.0.1']),
  };
  const uiEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_USE_MOCKS: 'false',
    VITE_API_BASE_URL: API_ORIGIN,
    VITE_E2E_TEST_MODE: 'true',
  };

  let backend: ManagedProcess | undefined;
  let vite: ManagedProcess | undefined;
  try {
    const python = await resolveBackendPython();
    const seedCommand = await resolveSeedCommand();
    await runCommand(
      'Alembic E2E migration',
      python,
      [
        join(currentDirectory, 'prepare_backend.py'),
        '--backend-root',
        backendRoot,
        '--database-path',
        databasePath,
        '--database-url',
        databaseUrl,
      ],
      backendRoot,
      backendEnvironment,
    );
    await runCommand('fire-viewer-seed', seedCommand, [], backendRoot, backendEnvironment);

    backend = startProcess(
      'Uvicorn E2E API',
      python,
      ['-m', 'uvicorn', 'fire_viewer.main:app', '--host', '127.0.0.1', '--port', '8000'],
      backendRoot,
      backendEnvironment,
    );
    await waitForHttp(`${API_ORIGIN}/readyz`, backend);

    vite = startProcess(
      'Vite E2E UI',
      process.execPath,
      [join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      uiRoot,
      uiEnvironment,
    );
    await waitForHttp(`${UI_ORIGIN}/incident/FR-83-00042`, vite);
  } catch (error) {
    await stopProcess(vite);
    await stopProcess(backend);
    await removeTemporaryDirectory(temporaryDirectory);
    throw error;
  }

  return async () => {
    await stopProcess(vite);
    await stopProcess(backend);
    await removeTemporaryDirectory(temporaryDirectory);
  };
}
