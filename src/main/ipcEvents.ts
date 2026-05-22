import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { SshExecutor } from './core/ssh'
import { EnvironmentManager, Deployer, GameBlueprint } from './core/docker'
import { SshClient } from './core/ssh'
import { LocalDeployer, WarpHostInstance } from './core/localEngine'
import { EasyTierWrapper } from './core/easytier'
import { BlueprintManager } from './core/blueprint'
import { StoreManager } from './core/store'
import {
  parseContainerControl,
  parseEasytierStart,
  parseGameBlueprint,
  parseSshPayload,
  safeErrorMessage
} from './utils/safety'

interface SshResult {
  ok: boolean
  logs: string[]
}

interface FetchInstancesResult {
  ok: boolean
  instances: WarpHostInstance[]
}

interface FetchBlueprintsResult {
  ok: boolean
  blueprints: GameBlueprint[]
  warnings: string[]
}

interface OpenGuideResult {
  ok: boolean
  error?: string
}

type GuideTopic = 'usage' | 'cloud' | 'local' | 'sdwan' | 'instances'

const GUIDE_FILES: Record<GuideTopic, string> = {
  usage: 'USAGE.md',
  cloud: 'guide-cloud.md',
  local: 'guide-local.md',
  sdwan: 'guide-sdwan.md',
  instances: 'guide-instances.md'
}

// Singletons — survive across IPC calls
const easytier = new EasyTierWrapper()
const blueprintManager = new BlueprintManager()
const storeManager = new StoreManager()

function getGuidePath(topic: GuideTopic): string {
  const docsRoot = app.isPackaged
    ? join(process.resourcesPath, 'docs')
    : join(app.getAppPath(), 'docs')

  return join(docsRoot, GUIDE_FILES[topic])
}

export function registerTestSshHandler(): void {
  ipcMain.handle('test-ssh', async (_event, payload: unknown): Promise<SshResult> => {
    const parsed = parseSshPayload(payload)
    if (!parsed.ok) return { ok: false, logs: [`[error] ${parsed.error}`] }

    const executor = new SshExecutor()
    const logs = await executor.connect(
      parsed.value.host,
      parsed.value.username,
      parsed.value.password
    )

    const ok = logs.some((line) => line.includes('connected'))
    return { ok, logs }
  })
}

export function registerCheckEnvironmentHandler(): void {
  ipcMain.handle('check-environment', async (_event, payload: unknown): Promise<SshResult> => {
    const parsed = parseSshPayload(payload)
    if (!parsed.ok) return { ok: false, logs: [`[error] ${parsed.error}`] }

    const logs = await EnvironmentManager.ensure({
      host: parsed.value.host,
      username: parsed.value.username,
      password: parsed.value.password
    })

    const ok = logs.some((line) => line.includes('Docker daemon responsive'))
    return { ok, logs }
  })
}

export function registerDeployGameHandler(): void {
  ipcMain.handle('deploy-game', async (_event, payload: unknown): Promise<SshResult> => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, logs: ['[error] Invalid deployment payload.'] }
    }

    const record = payload as Record<string, unknown>
    const ssh = parseSshPayload(record)
    if (!ssh.ok) return { ok: false, logs: [`[error] ${ssh.error}`] }

    const blueprint = parseGameBlueprint(record.blueprint)
    if (!blueprint.ok) return { ok: false, logs: [`[error] ${blueprint.error}`] }

    const ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const client = new SshClient()
    const logs: string[] = []

    try {
      await client.connect({
        host: ssh.value.host,
        username: ssh.value.username,
        password: ssh.value.password
      })

      logs.push(`[${ts()}] Deploy sequence initiated for blueprint: ${blueprint.value.name}`)

      const deployer = new Deployer(client)
      const deployLogs = await deployer.deployGame(blueprint.value)
      logs.push(...deployLogs)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${ts()}] Deploy failed: ${message}`)
    } finally {
      client.disconnect()
    }

    const ok = logs.some((line) => line.includes('Game server accessible at'))
    return { ok, logs }
  })
}

export function registerDeployLocalGameHandler(): void {
  ipcMain.handle('deploy-local-game', async (_event, payload: unknown): Promise<SshResult> => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, logs: ['[error] Invalid local deployment payload.'] }
    }

    const blueprint = parseGameBlueprint((payload as Record<string, unknown>).blueprint)
    if (!blueprint.ok) return { ok: false, logs: [`[error] ${blueprint.error}`] }

    const ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const deployer = new LocalDeployer()
    const logs: string[] = []

    // Step 1: Detect IPv6
    logs.push(`[${ts()}] Scanning network interfaces for public IPv6 address...`)
    let ipv6: string
    try {
      ipv6 = deployer.getLocalIPv6()
      logs.push(`[${ts()}] Public IPv6 detected: ${ipv6}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${ts()}] ${message}`)
      return { ok: false, logs }
    }

    try {
      const fwLogs = await deployer.openFirewallPort(blueprint.value.hostPort)
      logs.push(...fwLogs)

      logs.push(`[${ts()}] Initiating local container deployment...`)
      const deployLogs = await deployer.deployLocalGame(blueprint.value)
      logs.push(...deployLogs)

      const ok = logs.some((line) => line.includes('Container spawned'))
      if (ok) {
        const address = `[${ipv6}]:${blueprint.value.hostPort}`
        logs.push(`[${ts()}] Local game server is live — direct connect: ${address}`)
      }
      return { ok, logs }
    } catch (err) {
      logs.push(`[${ts()}] Local deployment failed: ${safeErrorMessage(err)}`)
      return { ok: false, logs }
    }
  })
}

export function registerFetchInstancesHandler(): void {
  ipcMain.handle('fetch-instances', async (): Promise<FetchInstancesResult> => {
    const deployer = new LocalDeployer()
    try {
      const instances = await deployer.listInstances()
      return { ok: true, instances }
    } catch {
      return { ok: false, instances: [] }
    }
  })
}

export function registerControlInstanceHandler(): void {
  ipcMain.handle('control-instance', async (_event, payload: unknown): Promise<SshResult> => {
    const parsed = parseContainerControl(payload)
    if (!parsed.ok) return { ok: false, logs: [`[error] ${parsed.error}`] }

    const deployer = new LocalDeployer()
    let logs: string[]

    switch (parsed.value.action) {
      case 'start':
        logs = await deployer.startInstance(parsed.value.id)
        break
      case 'stop':
        logs = await deployer.stopInstance(parsed.value.id)
        break
      case 'remove':
        logs = await deployer.removeInstance(parsed.value.id)
        break
      default:
        return { ok: false, logs: ['[error] Unknown action.'] }
    }

    const ok = logs.some(
      (line) => line.includes('started') || line.includes('stopped') || line.includes('destroyed')
    )
    return { ok, logs }
  })
}

export function registerStartEasytierHandler(): void {
  ipcMain.handle('start-easytier', (event, payload: unknown): SshResult => {
    const parsed = parseEasytierStart(payload)
    if (!parsed.ok) return { ok: false, logs: [`[error] ${parsed.error}`] }

    if (easytier.isRunning) {
      return { ok: false, logs: ['[error] EasyTier is already running.'] }
    }

    const sender = event.sender
    sender.once('destroyed', () => {
      easytier.clearCallbacks()
    })

    easytier.setLogCallback((line: string) => {
      try {
        if (!sender.isDestroyed()) sender.send('easytier:log', line)
      } catch {
        // webContents may be destroyed
      }
    })

    easytier.setVirtualIpCallback((ip: string) => {
      try {
        if (!sender.isDestroyed()) sender.send('easytier:vip', ip)
      } catch {
        // webContents may be destroyed
      }
    })

    try {
      easytier.start(parsed.value.networkName, parsed.value.password)
      return { ok: true, logs: ['[easytier] SD-WAN engine launched.'] }
    } catch (err) {
      easytier.clearCallbacks()
      const message = safeErrorMessage(err)
      return { ok: false, logs: [`[easytier] ${message}`] }
    }
  })
}

export function registerStopEasytierHandler(): void {
  ipcMain.handle('stop-easytier', async (): Promise<SshResult> => {
    if (!easytier.isRunning) {
      return { ok: false, logs: ['[easytier] No active EasyTier process.'] }
    }

    await easytier.stop()
    return { ok: true, logs: ['[easytier] SD-WAN engine stopped.'] }
  })
}

export function registerFetchBlueprintsHandler(): void {
  ipcMain.handle('fetch-blueprints', async (): Promise<FetchBlueprintsResult> => {
    try {
      const result = await blueprintManager.getAllBlueprints()
      return { ok: true, blueprints: result.blueprints, warnings: result.warnings }
    } catch {
      return { ok: false, blueprints: [], warnings: ['[blueprint] Failed to load blueprints.'] }
    }
  })
}

export function registerStoreGetHandler(): void {
  ipcMain.handle('store-get', (_event, key: unknown) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) return undefined
    return storeManager.get(key)
  })
}

export function registerStoreSetHandler(): void {
  ipcMain.handle('store-set', (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) return
    storeManager.set(key, value)
  })
}

export function registerOpenGuideHandler(): void {
  ipcMain.handle('open-guide', async (_event, topic: unknown): Promise<OpenGuideResult> => {
    if (
      topic !== 'usage' &&
      topic !== 'cloud' &&
      topic !== 'local' &&
      topic !== 'sdwan' &&
      topic !== 'instances'
    ) {
      return { ok: false, error: 'Unknown guide topic.' }
    }

    const guidePath = getGuidePath(topic)
    if (!existsSync(guidePath)) {
      return { ok: false, error: `Guide not found: ${guidePath}` }
    }

    const error = await shell.openPath(guidePath)
    if (error) return { ok: false, error }

    return { ok: true }
  })
}

export function disposeEasytier(): Promise<void> {
  return easytier.dispose()
}
