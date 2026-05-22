import { networkInterfaces } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { GameBlueprint } from './docker'
import { safeErrorMessage } from '../utils/safety'

const execFileAsync = promisify(execFile)

const VM_KEYWORDS = [
  'vmware',
  'virtualbox',
  'hyper-v',
  'wsl',
  'docker',
  'vpn',
  'tunnel',
  'loopback',
  'bluetooth',
  'teredo'
]

export interface WarpHostInstance {
  id: string
  name: string
  image: string
  status: 'Up' | 'Exited' | 'Created' | 'Unknown'
  statusDetail: string
  ports: string
  createdAt: string
}

export class LocalDeployer {
  private readonly ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })

  getLocalIPv6(): string {
    const interfaces = networkInterfaces()
    const candidates: string[] = []

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue

      const lowerName = name.toLowerCase()
      if (VM_KEYWORDS.some((kw) => lowerName.includes(kw))) continue

      for (const addr of addrs) {
        if (addr.family === 'IPv6' && !addr.internal) {
          const ip = addr.address
          if (!ip.toLowerCase().startsWith('fe80')) {
            candidates.push(ip)
          }
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error('未检测到公网 IPv6 地址，请检查路由器设置')
    }

    return candidates[0].split('%')[0]
  }

  async openFirewallPort(port: number): Promise<string[]> {
    const logs: string[] = []

    if (process.platform !== 'win32') {
      logs.push(
        `[${this.ts()}] Skipping Windows firewall — current platform is ${process.platform}`
      )
      return logs
    }

    const ruleName = `WarpHost Game Port ${port}`
    logs.push(`[${this.ts()}] Configuring Windows Firewall: opening TCP port ${port}...`)

    try {
      await execFileAsync(
        'netsh',
        ['advfirewall', 'firewall', 'delete', 'rule', `name=${ruleName}`],
        {
          timeout: 10000
        }
      )
    } catch {
      // rule may not exist, fine
    }

    try {
      await execFileAsync(
        'netsh',
        [
          'advfirewall',
          'firewall',
          'add',
          'rule',
          `name=${ruleName}`,
          'dir=in',
          'action=allow',
          'protocol=TCP',
          `localport=${port}`
        ],
        { timeout: 15000 }
      )
      logs.push(`[${this.ts()}] Firewall rule "${ruleName}" added successfully.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      if (
        message.includes('Access') ||
        message.includes('denied') ||
        message.includes('elevation') ||
        message.includes('administrator')
      ) {
        logs.push(
          `[${this.ts()}] Firewall permission denied — please run WarpHost as Administrator.`
        )
      } else {
        logs.push(`[${this.ts()}] Firewall rule failed: ${message}`)
      }
    }

    return logs
  }

  async deployLocalGame(blueprint: GameBlueprint): Promise<string[]> {
    const logs: string[] = []
    const containerName = `warphost-${blueprint.name}`
    const localDataDir = join(app.getPath('userData'), 'instances', blueprint.name)

    // 1. Check Docker Desktop
    logs.push(`[${this.ts()}] Checking local Docker daemon...`)
    try {
      await execFileAsync('docker', ['ps'], { timeout: 10000 })
      logs.push(`[${this.ts()}] Docker Desktop is running.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Docker Desktop not accessible: ${message}`)
      logs.push(`[${this.ts()}] Please start Docker Desktop and try again.`)
      return logs
    }

    // 2. Create local data directory
    logs.push(`[${this.ts()}] Creating local data directory: ${localDataDir}`)
    try {
      await mkdir(localDataDir, { recursive: true })
      logs.push(`[${this.ts()}] Data directory ready: ${localDataDir}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Failed to create directory: ${message}`)
      return logs
    }

    // 3. Pull image
    logs.push(`[${this.ts()}] Pulling image ${blueprint.image}...`)
    try {
      await execFileAsync('docker', ['pull', blueprint.image], { timeout: 180000 })
      logs.push(`[${this.ts()}] Image pulled: ${blueprint.image}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Image pull failed: ${message}`)
      return logs
    }

    // 4. Remove old container
    try {
      await execFileAsync('docker', ['rm', '-f', containerName], { timeout: 10000 })
    } catch {
      // container might not exist, non-fatal
    }

    // 5. Run container
    const runArgs = [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      `${blueprint.hostPort}:${blueprint.containerPort}`,
      '-v',
      `${localDataDir}:/data`
    ]

    for (const [key, value] of Object.entries(blueprint.envVars)) {
      runArgs.push('-e', `${key}=${value}`)
    }

    runArgs.push(blueprint.image)

    logs.push(`[${this.ts()}] Launching local container ${containerName}...`)
    try {
      const { stdout } = await execFileAsync('docker', runArgs, { timeout: 30000 })
      const containerId = stdout.trim().slice(0, 12)
      logs.push(`[${this.ts()}] Container spawned: ${containerId}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Container launch failed: ${message}`)
      return logs
    }

    // 6. Verify container status
    logs.push(`[${this.ts()}] Verifying container status...`)
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['ps', '--filter', `name=${containerName}`, '--format', '{{.Status}}', '--no-trunc'],
        { timeout: 10000 }
      )
      logs.push(`[${this.ts()}] Container ${containerName} status: ${stdout.trim()}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Container status check failed: ${message}`)
    }

    return logs
  }

  // ── Instance management ──────────────────────────────────────────

  async listInstances(): Promise<WarpHostInstance[]> {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        [
          'ps',
          '-a',
          '--filter',
          'name=warphost-',
          '--format',
          '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}'
        ],
        { timeout: 10000 }
      )

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.includes('|'))
        .map((line) => {
          const [id, name, image, rawStatus, ports, createdAt] = line.split('|')
          const statusText = rawStatus.trim()
          const status: WarpHostInstance['status'] = statusText.startsWith('Up')
            ? 'Up'
            : statusText.includes('Exited')
              ? 'Exited'
              : statusText.includes('Created')
                ? 'Created'
                : 'Unknown'

          return {
            id: id.trim(),
            name: name.trim(),
            image: image.trim(),
            status,
            statusDetail: statusText,
            ports: ports.trim(),
            createdAt: createdAt.trim()
          }
        })
    } catch {
      return []
    }
  }

  async startInstance(id: string): Promise<string[]> {
    const logs: string[] = []
    logs.push(`[${this.ts()}] Sending start command to container ${id.slice(0, 12)}...`)

    try {
      await execFileAsync('docker', ['start', id], { timeout: 15000 })
      logs.push(`[${this.ts()}] Container ${id.slice(0, 12)} started successfully.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Failed to start container: ${message}`)
    }

    return logs
  }

  async stopInstance(id: string): Promise<string[]> {
    const logs: string[] = []
    logs.push(`[${this.ts()}] Sending stop command to container ${id.slice(0, 12)}...`)

    try {
      await execFileAsync('docker', ['stop', id], { timeout: 15000 })
      logs.push(`[${this.ts()}] Container ${id.slice(0, 12)} stopped.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Failed to stop container: ${message}`)
    }

    return logs
  }

  async removeInstance(id: string): Promise<string[]> {
    const logs: string[] = []
    logs.push(`[${this.ts()}] Removing container ${id.slice(0, 12)}...`)

    try {
      await execFileAsync('docker', ['rm', '-f', id], { timeout: 15000 })
      logs.push(`[${this.ts()}] Container ${id.slice(0, 12)} destroyed.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Failed to remove container: ${message}`)
    }

    return logs
  }
}
