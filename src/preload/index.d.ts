interface DeployServerPayload {
  host: string
  rootPassword: string
}

interface DeployServerResult {
  ok: boolean
  logs: string[]
}

interface SshPayload {
  host: string
  username: string
  password: string
}

interface SshResult {
  ok: boolean
  logs: string[]
}

interface GameBlueprint {
  name: string
  image: string
  hostPort: number
  containerPort: number
  envVars: Record<string, string>
  volumeMapping: string
}

interface DeployGamePayload {
  host: string
  username: string
  password: string
  blueprint: GameBlueprint
}

interface DeployLocalGamePayload {
  blueprint: GameBlueprint
}

interface WarpHostInstance {
  id: string
  name: string
  image: string
  status: 'Up' | 'Exited' | 'Created' | 'Unknown'
  statusDetail: string
  ports: string
  createdAt: string
}

interface FetchInstancesResult {
  ok: boolean
  instances: WarpHostInstance[]
}

interface ControlInstancePayload {
  action: 'start' | 'stop' | 'remove'
  id: string
}

interface EasytierStartPayload {
  networkName: string
  password: string
}

type LogCallback = (line: string) => void
type VipCallback = (ip: string) => void
type GuideTopic = 'usage' | 'cloud' | 'local' | 'sdwan' | 'instances'

interface FetchBlueprintsResult {
  ok: boolean
  blueprints: GameBlueprint[]
  warnings: string[]
}

interface WarpHostAPI {
  deployServer(payload: DeployServerPayload): Promise<DeployServerResult>
  testSsh(payload: SshPayload): Promise<SshResult>
  checkEnvironment(payload: SshPayload): Promise<SshResult>
  deployGame(payload: DeployGamePayload): Promise<SshResult>
  deployLocalGame(payload: DeployLocalGamePayload): Promise<SshResult>
  fetchInstances(): Promise<FetchInstancesResult>
  controlInstance(payload: ControlInstancePayload): Promise<SshResult>
  startEasytier(payload: EasytierStartPayload): Promise<SshResult>
  stopEasytier(): Promise<SshResult>
  fetchBlueprints(): Promise<FetchBlueprintsResult>
  openGuide(topic: GuideTopic): Promise<{ ok: boolean; error?: string }>
  store: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
  onEasytierLog(callback: LogCallback): () => void
  onEasytierVirtualIp(callback: VipCallback): () => void
}

declare global {
  interface Window {
    electron: {
      process: {
        versions: NodeJS.ProcessVersions
      }
    }
    api: WarpHostAPI
  }
}

export {}
