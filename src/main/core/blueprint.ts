import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import type { GameBlueprint } from './docker'
import { parseGameBlueprint } from '../utils/safety'

const DEFAULT_BLUEPRINTS: Record<string, GameBlueprint> = {
  minecraft: {
    name: 'minecraft',
    image: 'itzg/minecraft-server:latest',
    hostPort: 25565,
    containerPort: 25565,
    envVars: { EULA: 'TRUE', MEMORY: '2G', VERSION: '1.21' },
    volumeMapping: '/opt/warphost/minecraft/data:/data'
  },
  cs2: {
    name: 'cs2',
    image: 'joedwards32/cs2:latest',
    hostPort: 27015,
    containerPort: 27015,
    envVars: { CS2_SERVERNAME: 'WarpHost CS2 Server', CS2_CHEATS: '0' },
    volumeMapping: '/opt/warphost/cs2/data:/data'
  }
}

export class BlueprintManager {
  private dir: string

  constructor() {
    this.dir = join(app.getPath('userData'), 'warphost-blueprints')
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  async initDefaultBlueprints(): Promise<string[]> {
    await this.ensureDir()
    const logs: string[] = []

    for (const [name, blueprint] of Object.entries(DEFAULT_BLUEPRINTS)) {
      const filePath = join(this.dir, `${name}.json`)
      if (!existsSync(filePath)) {
        await writeFile(filePath, JSON.stringify(blueprint, null, 2), 'utf-8')
        logs.push(`[blueprint] Created default: ${name}.json`)
      }
    }

    return logs
  }

  async getAllBlueprints(): Promise<{
    blueprints: GameBlueprint[]
    warnings: string[]
  }> {
    await this.ensureDir()
    await this.initDefaultBlueprints()

    const warnings: string[] = []
    const blueprints: GameBlueprint[] = []

    let files: string[]
    try {
      files = await readdir(this.dir)
    } catch {
      return { blueprints: [], warnings: ['[blueprint] Failed to read blueprints directory.'] }
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      const filePath = join(this.dir, file)

      try {
        const content = await readFile(filePath, 'utf-8')
        const raw: unknown = JSON.parse(content)
        const parsed = parseGameBlueprint(raw)

        if (parsed.ok) {
          blueprints.push(parsed.value)
        } else {
          warnings.push(`[blueprint] Skipped ${file}: ${parsed.error}`)
        }
      } catch {
        warnings.push(`[blueprint] Skipped ${file}: invalid JSON`)
      }
    }

    return { blueprints, warnings }
  }
}
