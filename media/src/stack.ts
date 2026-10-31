/**
 * Brings up a private, throwaway copy of the product for the capture: the
 * backend in local mode on a fresh data directory, and a production build of
 * the frontend served by `vite preview`, which proxies `/api` to that backend.
 *
 * Nothing here touches the developer's own data, ports or builds: the data
 * directory is temporary, the ports are free ones picked at start-up, and the
 * frontend is built into `media/.build/` rather than `frontend/dist/`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { paths } from './paths.js'

export interface Stack {
  appUrl: string
  apiUrl: string
  apiKey: string
  stop(): Promise<void>
}

function log(message: string): void {
  process.stderr.write(`[stack] ${message}\n`)
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not pick a free port'))
      })
    })
  })
}

/** Runs a command to completion, streaming its output only when it fails. */
export async function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; label: string }
): Promise<void> {
  log(`${options.label}...`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${options.label} failed (exit ${code}):\n${output.slice(-4000)}`))
    })
  })
}

function startDaemon(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; label: string; logFile: string[] }
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so stopping it also stops whatever npm spawned.
    detached: true,
  })
  const keep = (chunk: Buffer) => {
    options.logFile.push(chunk.toString())
    if (options.logFile.length > 400) options.logFile.splice(0, options.logFile.length - 400)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  return child
}

async function stopDaemon(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000).unref())
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

async function waitFor(url: string, label: string, child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited (code ${child.exitCode}) before it was ready:\n${logs.join('').slice(-4000)}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} was not ready at ${url} after 90s:\n${logs.join('').slice(-4000)}`)
}

export async function buildProduct(): Promise<void> {
  await run('npm', ['run', 'build'], { cwd: paths.timeline, label: 'Building the backend' })
  await run(
    'npx',
    ['vite', 'build', '--outDir', paths.frontendBuild, '--emptyOutDir'],
    {
      cwd: paths.frontend,
      label: 'Building the frontend',
      env: {
        ...process.env,
        // Same-origin API, proxied by `vite preview` to the private backend.
        VITE_API_BASE_URL: '/api',
        // Never bake a developer's key (from frontend/.env.local) into this
        // build; the tour hands the app its key at run time.
        VITE_API_KEY: '',
      },
    }
  )
}

export async function startStack(): Promise<Stack> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'althistory-media-'))
  const apiPort = await freePort()
  const appPort = await freePort()
  const apiKey = `ak_${randomBytes(32).toString('hex')}`
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const appUrl = `http://127.0.0.1:${appPort}`

  const backendLogs: string[] = []
  const backend = startDaemon('npm', ['start'], {
    cwd: paths.timeline,
    label: 'backend',
    logFile: backendLogs,
    env: {
      ...process.env,
      // The process environment beats timeline/.env.local, so these hold even
      // when a developer's local config says otherwise.
      NODE_ENV: 'production',
      LOCAL_EXECUTION_ENABLED: 'true',
      LOCAL_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      ADMIN_API_KEY: apiKey,
      // No language model: ingestion falls back to the deterministic pattern
      // extractor, so the pictures do not change from run to run and a
      // capture never spends money.
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    },
  })
  log(`backend on ${apiUrl} (data in ${dataDir})`)

  const frontendLogs: string[] = []
  const frontend = startDaemon(
    'npx',
    ['vite', 'preview', '--outDir', paths.frontendBuild, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'],
    {
      cwd: paths.frontend,
      label: 'frontend',
      logFile: frontendLogs,
      env: { ...process.env, BACKEND_PROXY_URL: apiUrl },
    }
  )
  log(`frontend on ${appUrl}`)

  const stop = async () => {
    await Promise.all([stopDaemon(frontend), stopDaemon(backend)])
    // npm exits before the backend has finished its last flush to the data
    // directory, so the first attempt can race a write.
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }

  try {
    // Not /health: it answers 503 until the lazily-built services have been
    // used once. The OpenAPI document is served as soon as the routers mount.
    await waitFor(`${apiUrl}/api/openapi.json`, 'backend', backend, backendLogs)
    await waitFor(appUrl, 'frontend', frontend, frontendLogs)
  } catch (err) {
    await stop()
    throw err
  }

  return { appUrl, apiUrl, apiKey, stop }
}
