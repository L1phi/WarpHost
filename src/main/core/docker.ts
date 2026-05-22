import { SshClient, SshConnectionOptions } from './ssh'
import { safeErrorMessage, shellEscape } from '../utils/safety'

export interface DockerDeploymentPlan {
  image: string
  containerName: string
  ports: string[]
  volumes: string[]
}

export interface GameBlueprint {
  name: string
  image: string
  hostPort: number
  containerPort: number
  envVars: Record<string, string>
  volumeMapping: string
}

export class DockerService {
  buildInstallCheckCommand(): string {
    return 'docker --version'
  }

  buildDeploymentCommands(plan: DockerDeploymentPlan): string[] {
    const image = shellEscape(plan.image)
    const containerName = shellEscape(plan.containerName)
    const portArgs = plan.ports.map((port) => `-p ${shellEscape(port)}`).join(' ')
    const volumeArgs = plan.volumes.map((volume) => `-v ${shellEscape(volume)}`).join(' ')

    return [
      `docker pull ${image}`,
      `docker rm -f ${containerName} || true`,
      `docker run -d --name ${containerName} ${portArgs} ${volumeArgs} ${image}`.trim()
    ]
  }
}

export class EnvironmentManager {
  private readonly ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })

  constructor(private client: SshClient) {}

  async checkDocker(): Promise<{ installed: boolean; logs: string[] }> {
    try {
      const version = await this.client.exec('docker --version')
      return {
        installed: true,
        logs: [`[${this.ts()}] Docker detected: ${version}`]
      }
    } catch (err) {
      const message = safeErrorMessage(err)
      return {
        installed: false,
        logs: [`[${this.ts()}] Docker not detected (${message})`]
      }
    }
  }

  async installDocker(): Promise<string[]> {
    const logs: string[] = []
    logs.push(`[${this.ts()}] Docker not found — initiating one-click install via Aliyun mirror...`)

    try {
      await this.client.exec('curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun')
      logs.push(`[${this.ts()}] Docker installation completed successfully.`)
    } catch (err) {
      const message = safeErrorMessage(err)

      logs.push(
        `[${this.ts()}] Official script failed (${message}), retrying with Aliyun static binary...`
      )

      try {
        await this.client.exec(
          'curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/static/stable/x86_64/docker-27.5.1.tgz -o /tmp/docker.tgz && ' +
            'tar xzf /tmp/docker.tgz -C /usr/local/bin/ --strip-components=1 && ' +
            'rm -f /tmp/docker.tgz'
        )
        logs.push(`[${this.ts()}] Docker static binary installed via Aliyun mirror.`)
      } catch (retryErr) {
        const retryMsg = safeErrorMessage(retryErr)
        logs.push(`[${this.ts()}] Docker installation failed: ${retryMsg}`)
      }
    }

    return logs
  }

  async startDocker(): Promise<string[]> {
    const logs: string[] = []

    try {
      await this.client.exec('systemctl start docker')
      logs.push(`[${this.ts()}] Docker service started (systemctl).`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] systemctl start failed (${message}), trying service command...`)

      try {
        await this.client.exec('service docker start')
        logs.push(`[${this.ts()}] Docker service started (service).`)
      } catch (retryErr) {
        const retryMsg = safeErrorMessage(retryErr)
        logs.push(`[${this.ts()}] Docker service start failed: ${retryMsg}`)
      }
    }

    try {
      await this.client.exec('systemctl enable docker 2>/dev/null || true')
      logs.push(`[${this.ts()}] Docker enabled for auto-start on boot.`)
    } catch {
      // enable is best-effort, non-fatal
    }

    try {
      await this.client.exec('docker ps')
      logs.push(`[${this.ts()}] Docker daemon responsive — root user ready.`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Docker daemon check failed: ${message}`)
    }

    return logs
  }

  static async ensure(options: SshConnectionOptions): Promise<string[]> {
    const allLogs: string[] = []
    const client = new SshClient()
    const ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })

    try {
      await client.connect(options)
      allLogs.push(
        `[${ts()}] Environment check started for ${options.username ?? 'root'}@${options.host}.`
      )

      const manager = new EnvironmentManager(client)
      const { installed, logs: checkLogs } = await manager.checkDocker()
      allLogs.push(...checkLogs)

      if (!installed) {
        const installLogs = await manager.installDocker()
        allLogs.push(...installLogs)
      }

      const startLogs = await manager.startDocker()
      allLogs.push(...startLogs)
    } catch (err) {
      const message = safeErrorMessage(err)
      allLogs.push(`[${ts()}] Environment setup error: ${message}`)
    } finally {
      client.disconnect()
      allLogs.push(`[${ts()}] Environment check completed.`)
    }

    return allLogs
  }
}

export class Deployer {
  private readonly ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })

  constructor(private client: SshClient) {}

  async deployGame(blueprint: GameBlueprint): Promise<string[]> {
    const logs: string[] = []
    const containerName = `warphost-${blueprint.name}`

    const [hostVolumePath] = blueprint.volumeMapping.split(':')

    // 1. Create remote work directory
    logs.push(`[${this.ts()}] Creating remote directory ${hostVolumePath}...`)
    try {
      await this.client.exec(`mkdir -p -- ${shellEscape(hostVolumePath)}`)
      logs.push(`[${this.ts()}] Remote directory ready: ${hostVolumePath}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Failed to create directory: ${message}`)
      return logs
    }

    // 2. Pull Docker image
    logs.push(`[${this.ts()}] Pulling image ${blueprint.image}...`)
    try {
      const pullOutput = await this.client.exec(`docker pull ${shellEscape(blueprint.image)}`)
      logs.push(`[${this.ts()}] Image pulled: ${blueprint.image}`)
      const lastLine = pullOutput.split('\n').pop() || ''
      if (lastLine) logs.push(`[${this.ts()}] Digest: ${lastLine.trim()}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Image pull failed: ${message}`)
      return logs
    }

    // 3. Remove existing container with same name (if any)
    try {
      await this.client.exec(`docker rm -f ${shellEscape(containerName)} 2>/dev/null || true`)
    } catch {
      // container might not exist, non-fatal
    }

    // 4. Build and execute docker run command
    const envArgs = Object.entries(blueprint.envVars)
      .map(([k, v]) => `-e ${shellEscape(`${k}=${v}`)}`)
      .join(' ')

    const runCmd = [
      'docker run -d',
      `--name ${shellEscape(containerName)}`,
      `-p ${blueprint.hostPort}:${blueprint.containerPort}`,
      envArgs,
      `-v ${shellEscape(blueprint.volumeMapping)}`,
      shellEscape(blueprint.image)
    ]
      .filter(Boolean)
      .join(' ')

    logs.push(`[${this.ts()}] Launching container ${containerName}...`)
    try {
      const containerId = await this.client.exec(runCmd)
      logs.push(`[${this.ts()}] Container spawned: ${containerId.slice(0, 12)}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Container launch failed: ${message}`)
      return logs
    }

    // 5. Verify container status
    logs.push(`[${this.ts()}] Verifying container status...`)
    try {
      const status = await this.client.exec(
        `docker ps --filter ${shellEscape(`name=${containerName}`)} --format "{{.Status}}" --no-trunc`
      )
      logs.push(`[${this.ts()}] Container ${containerName} status: ${status}`)
    } catch (err) {
      const message = safeErrorMessage(err)
      logs.push(`[${this.ts()}] Container status check failed: ${message}`)
      return logs
    }

    // 6. Report accessible address
    try {
      const host = await this.client.exec("hostname -I | awk '{print $1}'")
      const address = `${host.trim()}:${blueprint.hostPort}`
      logs.push(`[${this.ts()}] Game server accessible at: ${address}`)
    } catch {
      logs.push(`[${this.ts()}] Game server port: ${blueprint.hostPort}`)
    }

    return logs
  }
}
