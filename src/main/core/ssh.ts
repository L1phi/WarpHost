import { Client, ConnectConfig } from 'ssh2'

export interface SshConnectionOptions {
  host: string
  username?: string
  password: string
  port?: number
}

export class SshClient {
  private readonly client = new Client()
  private connected = false

  connect(options: SshConnectionOptions): Promise<void> {
    const config: ConnectConfig = {
      host: options.host,
      port: options.port ?? 22,
      username: options.username ?? 'root',
      password: options.password,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3
    }

    return new Promise((resolve, reject) => {
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timer)
        this.client.removeListener('ready', onReady)
        this.client.removeListener('error', onError)
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        this.connected = false
        cleanup()
        this.client.end()
        reject(err)
      }

      const onReady = (): void => {
        if (settled) return
        settled = true
        this.connected = true
        cleanup()
        resolve()
      }

      const onError = (err: Error): void => {
        fail(err)
      }

      const timer = setTimeout(() => {
        fail(new Error('SSH connection timed out.'))
      }, config.readyTimeout ?? 15000)

      this.client.once('ready', onReady).once('error', onError)

      try {
        this.client.connect(config)
      } catch (err) {
        fail(err instanceof Error ? err : new Error('SSH connection failed.'))
      }
    })
  }

  exec(command: string): Promise<string> {
    if (!this.connected) {
      return Promise.reject(new Error('SSH client is not connected.'))
    }

    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }

        let output = ''
        let errorOutput = ''

        stream
          .once('error', (err: Error) => {
            reject(err)
          })
          .on('close', (code: number) => {
            if (code === 0) {
              resolve(output.trim())
              return
            }

            reject(new Error(errorOutput.trim() || `Command exited with code ${code}.`))
          })
          .on('data', (data: Buffer) => {
            output += data.toString()
          })

        stream.stderr
          .once('error', (err: Error) => {
            reject(err)
          })
          .on('data', (data: Buffer) => {
            errorOutput += data.toString()
          })
      })
    })
  }

  disconnect(): void {
    this.client.end()
    this.connected = false
  }
}

export class SshExecutor {
  async connect(ip: string, username: string, password: string): Promise<string[]> {
    const ts = (): string => new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const client = new Client()

    return new Promise((resolve) => {
      client
        .once('ready', () => {
          client.end()
          resolve([`[${ts()}] SSH connected to ${username}@${ip}:22 — handshake verified.`])
        })
        .once('error', (err: Error) => {
          client.end()
          resolve([`[${ts()}] SSH connection failed: ${err.message}`])
        })
        .connect({
          host: ip,
          port: 22,
          username,
          password,
          readyTimeout: 10000
        })
    })
  }
}
