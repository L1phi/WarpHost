import type { GameBlueprint } from '../core/docker'

const HOST_REGEX = /^[a-zA-Z0-9:._-]+$/
const BLUEPRINT_NAME_REGEX = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const IMAGE_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/
const ENV_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/
const CONTAINER_ID_REGEX = /^[a-f0-9]{12,64}$/i
const EASYTIER_NETWORK_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/
const ABSOLUTE_CONTAINER_PATH_REGEX = /^\/[a-zA-Z0-9._/-]*$/

export interface SshPayload {
  host: string
  username: string
  password: string
}

export interface ControlInstancePayload {
  action: 'start' | 'stop' | 'remove'
  id: string
}

export interface EasytierStartPayload {
  networkName: string
  password: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
}

export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'unknown error')
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/password[^\s]*/gi, 'password=***')
    .slice(0, 500)
}

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function parseSshPayload(
  payload: unknown
): { ok: true; value: SshPayload } | { ok: false; error: string } {
  if (!isRecord(payload)) return { ok: false, error: 'Invalid SSH payload.' }

  const host = asString(payload.host)?.trim()
  const username = (asString(payload.username)?.trim() || 'root').trim()
  const password = asString(payload.password)

  if (!host) return { ok: false, error: 'Missing target server IP.' }
  if (!HOST_REGEX.test(host) || host.length > 255)
    return { ok: false, error: 'Invalid target host.' }
  if (!username || !HOST_REGEX.test(username) || username.length > 64) {
    return { ok: false, error: 'Invalid SSH username.' }
  }
  if (!password) return { ok: false, error: 'Root password is required.' }

  return { ok: true, value: { host, username, password } }
}

export function parseGameBlueprint(
  value: unknown
): { ok: true; value: GameBlueprint } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'No game blueprint provided.' }

  const name = asString(value.name)?.trim()
  const image = asString(value.image)?.trim()
  const volumeMapping = asString(value.volumeMapping)?.trim()

  if (!name || !BLUEPRINT_NAME_REGEX.test(name))
    return { ok: false, error: 'Invalid blueprint name.' }
  if (!image || !IMAGE_REGEX.test(image) || image.includes('..')) {
    return { ok: false, error: 'Invalid Docker image reference.' }
  }
  if (!isPort(value.hostPort) || !isPort(value.containerPort)) {
    return { ok: false, error: 'Invalid container port mapping.' }
  }
  const hostPort = value.hostPort
  const containerPort = value.containerPort
  if (!volumeMapping) return { ok: false, error: 'Invalid volume mapping.' }

  const [hostPath, containerPath, ...rest] = volumeMapping.split(':')
  if (
    rest.length > 0 ||
    !hostPath ||
    !containerPath ||
    !ABSOLUTE_CONTAINER_PATH_REGEX.test(hostPath) ||
    !ABSOLUTE_CONTAINER_PATH_REGEX.test(containerPath)
  ) {
    return { ok: false, error: 'Volume mapping must be an absolute host path and container path.' }
  }

  if (!isRecord(value.envVars)) return { ok: false, error: 'Invalid environment variables.' }

  const envVars: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value.envVars)) {
    if (!ENV_KEY_REGEX.test(key)) return { ok: false, error: `Invalid environment key: ${key}` }
    if (typeof raw !== 'string')
      return { ok: false, error: `Invalid environment value for ${key}.` }
    if (raw.length > 512 || raw.includes('\0')) {
      return { ok: false, error: `Unsafe environment value for ${key}.` }
    }
    envVars[key] = raw
  }

  return {
    ok: true,
    value: {
      name,
      image,
      hostPort,
      containerPort,
      envVars,
      volumeMapping
    }
  }
}

export function parseContainerControl(
  payload: unknown
): { ok: true; value: ControlInstancePayload } | { ok: false; error: string } {
  if (!isRecord(payload)) return { ok: false, error: 'Invalid container action payload.' }

  const action = asString(payload.action)
  const id = asString(payload.id)?.trim()

  if (action !== 'start' && action !== 'stop' && action !== 'remove') {
    return { ok: false, error: 'Unknown container action.' }
  }
  if (!id || !CONTAINER_ID_REGEX.test(id)) return { ok: false, error: 'Invalid container ID.' }

  return { ok: true, value: { action, id } }
}

export function parseEasytierStart(
  payload: unknown
): { ok: true; value: EasytierStartPayload } | { ok: false; error: string } {
  if (!isRecord(payload)) return { ok: false, error: 'Invalid EasyTier payload.' }

  const networkName = asString(payload.networkName)?.trim()
  const password = asString(payload.password)

  if (!networkName || !EASYTIER_NETWORK_REGEX.test(networkName)) {
    return { ok: false, error: 'Invalid network name.' }
  }
  if (!password || password.length < 8 || password.length > 128 || /[\0\r\n]/.test(password)) {
    return { ok: false, error: 'Invalid network password.' }
  }

  return { ok: true, value: { networkName, password } }
}
