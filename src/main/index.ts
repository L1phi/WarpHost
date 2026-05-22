import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { DockerService } from './core/docker'
import { SftpSyncService } from './core/sftp'
import { WorkspaceManager } from './utils/workspace'
import {
  registerTestSshHandler,
  registerCheckEnvironmentHandler,
  registerDeployGameHandler,
  registerDeployLocalGameHandler,
  registerFetchInstancesHandler,
  registerControlInstanceHandler,
  registerStartEasytierHandler,
  registerStopEasytierHandler,
  registerEasytierStatusHandler,
  registerInstallEasytierHandler,
  registerFetchBlueprintsHandler,
  registerStoreGetHandler,
  registerStoreSetHandler,
  registerOpenGuideHandler,
  disposeEasytier
} from './ipcEvents'

interface DeployServerPayload {
  host: string
  rootPassword: string
}

interface DeployServerResult {
  ok: boolean
  logs: string[]
}

const workspace = new WorkspaceManager()
const docker = new DockerService()
const sftp = new SftpSyncService()
let quitAfterCleanup = false

function isDeployServerPayload(payload: unknown): payload is DeployServerPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    typeof (payload as DeployServerPayload).host === 'string' &&
    typeof (payload as DeployServerPayload).rootPassword === 'string'
  )
}

function registerIpcHandlers(): void {
  registerTestSshHandler()
  registerCheckEnvironmentHandler()
  registerDeployGameHandler()
  registerDeployLocalGameHandler()
  registerFetchInstancesHandler()
  registerControlInstanceHandler()
  registerStartEasytierHandler()
  registerStopEasytierHandler()
  registerEasytierStatusHandler()
  registerInstallEasytierHandler()
  registerFetchBlueprintsHandler()
  registerStoreGetHandler()
  registerStoreSetHandler()
  registerOpenGuideHandler()

  ipcMain.handle('deploy:server', async (_event, payload: unknown): Promise<DeployServerResult> => {
    if (!isDeployServerPayload(payload)) {
      return {
        ok: false,
        logs: ['[error] Invalid deployment payload.']
      }
    }

    const host = payload.host.trim()

    if (!host) {
      return {
        ok: false,
        logs: ['[error] Missing target server IP.']
      }
    }

    if (!payload.rootPassword) {
      return {
        ok: false,
        logs: ['[error] Root password is required for the initial deployment handshake.']
      }
    }

    const syncPlan = sftp.createPlan(workspace.getBlueprintsPath(), '/opt/warphost/blueprints')

    return {
      ok: true,
      logs: [
        `[warp] Target locked: root@${host}:22`,
        `[workspace] Config path: ${workspace.getConfigPath()}`,
        `[sftp] ${syncPlan.localPath} -> ${syncPlan.remotePath}`,
        `[docker] Probe command queued: ${docker.buildInstallCheckCommand()}`,
        '[ssh] Handshake placeholder ready. Real command streaming lands in the next milestone.',
        '[deploy] Warp sequence completed in simulation mode.'
      ]
    }
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Ignore malformed external URLs.
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  app.setAppUserModelId('com.warphost.app')

  app.on('browser-window-created', (_, window) => {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  })

  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitAfterCleanup) return

  event.preventDefault()
  quitAfterCleanup = true
  void disposeEasytier().finally(() => {
    app.quit()
  })
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled rejection:', reason)
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
