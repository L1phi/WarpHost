import { app } from 'electron'
import { join } from 'path'

export class WorkspaceManager {
  private readonly rootPath: string

  constructor(rootPath = join(app.getPath('userData'), 'workspace')) {
    this.rootPath = rootPath
  }

  getRootPath(): string {
    return this.rootPath
  }

  getBlueprintsPath(): string {
    return join(this.rootPath, 'blueprints')
  }

  getConfigPath(): string {
    return join(this.rootPath, 'warphost.config.json')
  }
}
