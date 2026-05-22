import { contextBridge, ipcRenderer } from 'electron'

export interface DeployServerPayload {
  host: string
  rootPassword: string
}

export interface DeployServerResult {
  ok: boolean
  logs: string[]
}

export interface SshPayload {
  host: string
  username: string
  password: string
}

export interface SshResult {
  ok: boolean
  logs: string[]
}

export interface GameBlueprint {
  name: string
  image: string
  hostPort: number
  containerPort: number
  envVars: Record<string, string>
  volumeMapping: string
}

export interface DeployGamePayload {
  host: string
  username: string
  password: string
  blueprint: GameBlueprint
}

export interface DeployLocalGamePayload {
  blueprint: GameBlueprint
}

export interface WarpHostInstance {
  id: string
  name: string
  image: string
  status: 'Up' | 'Exited' | 'Created' | 'Unknown'
  statusDetail: string
  ports: string
  createdAt: string
}

export interface FetchInstancesResult {
  ok: boolean
  instances: WarpHostInstance[]
}

export interface ControlInstancePayload {
  action: 'start' | 'stop' | 'remove'
  id: string
}

export interface EasytierStartPayload {
  networkName: string
  password: string
}

export interface FetchBlueprintsResult {
  ok: boolean
  blueprints: GameBlueprint[]
  warnings: string[]
}

type LogCallback = (line: string) => void
type VipCallback = (ip: string) => void
type GuideTopic = 'usage' | 'cloud' | 'local' | 'sdwan' | 'instances'

const api = {
  deployServer: (payload: DeployServerPayload): Promise<DeployServerResult> =>
    ipcRenderer.invoke('deploy:server', payload),

  testSsh: (payload: SshPayload): Promise<SshResult> => ipcRenderer.invoke('test-ssh', payload),

  checkEnvironment: (payload: SshPayload): Promise<SshResult> =>
    ipcRenderer.invoke('check-environment', payload),

  deployGame: (payload: DeployGamePayload): Promise<SshResult> =>
    ipcRenderer.invoke('deploy-game', payload),

  deployLocalGame: (payload: DeployLocalGamePayload): Promise<SshResult> =>
    ipcRenderer.invoke('deploy-local-game', payload),

  fetchInstances: (): Promise<FetchInstancesResult> => ipcRenderer.invoke('fetch-instances'),

  controlInstance: (payload: ControlInstancePayload): Promise<SshResult> =>
    ipcRenderer.invoke('control-instance', payload),

  startEasytier: (payload: EasytierStartPayload): Promise<SshResult> =>
    ipcRenderer.invoke('start-easytier', payload),

  stopEasytier: (): Promise<SshResult> => ipcRenderer.invoke('stop-easytier'),

  fetchBlueprints: (): Promise<FetchBlueprintsResult> => ipcRenderer.invoke('fetch-blueprints'),

  openGuide: (topic: GuideTopic): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-guide', topic),

  store: {
    get: <T = unknown>(key: string): Promise<T | undefined> =>
      ipcRenderer.invoke('store-get', key) as Promise<T | undefined>,
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('store-set', key, value)
  },

  onEasytierLog: (callback: LogCallback): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on('easytier:log', handler)
    return () => {
      ipcRenderer.removeListener('easytier:log', handler)
    }
  },

  onEasytierVirtualIp: (callback: VipCallback): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ip: string): void => callback(ip)
    ipcRenderer.on('easytier:vip', handler)
    return () => {
      ipcRenderer.removeListener('easytier:vip', handler)
    }
  }
}

const electron = {
  process: {
    versions: process.versions
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electron)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electron
  // @ts-ignore (define in dts)
  window.api = api
}
