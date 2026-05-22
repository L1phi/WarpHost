import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

const VIP_REGEX = /10\.\d{1,3}\.\d{1,3}\.\d{1,3}/

export class EasyTierWrapper {
  private process: ChildProcess | null = null
  private _virtualIp: string | null = null

  private onLog: ((line: string) => void) | null = null
  private onVirtualIp: ((ip: string) => void) | null = null

  get virtualIp(): string | null {
    return this._virtualIp
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null && !this.process.killed
  }

  getBinaryPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'easytier-core.exe')
    }
    return join(app.getAppPath(), 'resources', 'easytier-core.exe')
  }

  setLogCallback(cb: (line: string) => void): void {
    this.onLog = cb
  }

  setVirtualIpCallback(cb: (ip: string) => void): void {
    this.onVirtualIp = cb
  }

  clearCallbacks(): void {
    this.onLog = null
    this.onVirtualIp = null
  }

  start(networkName: string, password: string): void {
    if (this.isRunning) {
      throw new Error('EasyTier is already running.')
    }

    const binPath = this.getBinaryPath()

    if (!existsSync(binPath)) {
      throw new Error(`EasyTier binary not found: ${binPath}`)
    }

    this._virtualIp = null

    const child = spawn(binPath, ['--network-name', networkName, '--network-secret', password], {
      windowsHide: true
    })

    this.process = child

    this.onLog?.('[easytier] Process spawned.')

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return

      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.onLog?.(`[easytier] ${trimmed}`)

        if (!this._virtualIp) {
          const match = trimmed.match(VIP_REGEX)
          if (match) {
            this._virtualIp = match[0]
            this.onVirtualIp?.(this._virtualIp)
          }
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return

      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.onLog?.(`[easytier:err] ${trimmed}`)
      }
    })

    child.once('close', (code) => {
      this.onLog?.(`[easytier] Process exited with code ${code ?? 'null'}.`)
      if (this.process === child) {
        this.process = null
        this._virtualIp = null
      }
    })

    child.once('error', (err) => {
      this.onLog?.(`[easytier] Fatal error: ${err.message}`)
      if (this.process === child) {
        this.process = null
        this._virtualIp = null
      }
    })
  }

  stop(): Promise<void> {
    const child = this.process

    if (!child || child.killed || child.exitCode !== null) {
      this.process = null
      this._virtualIp = null
      return Promise.resolve()
    }

    this.onLog?.('[easytier] Process termination requested.')

    return new Promise((resolve) => {
      let settled = false

      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(forceKillTimer)
        clearTimeout(resolveTimer)
        if (this.process === child) {
          this.process = null
          this._virtualIp = null
        }
        resolve()
      }

      const forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) {
          const signaled = child.kill('SIGKILL')
          this.onLog?.('[easytier] Process force-killed after shutdown timeout.')
          if (!signaled) {
            this.onLog?.('[easytier] Force-kill signal could not be delivered.')
          }
        }
      }, 5000)

      const resolveTimer = setTimeout(() => {
        this.onLog?.('[easytier] Process shutdown timed out; releasing wrapper state.')
        finish()
      }, 8000)

      child.once('close', finish)
      const signaled = child.kill('SIGTERM')
      if (!signaled) {
        this.onLog?.('[easytier] Termination signal could not be delivered.')
      }
    })
  }

  dispose(): Promise<void> {
    this.clearCallbacks()
    return this.stop()
  }
}
