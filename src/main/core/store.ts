import Store from 'electron-store'

interface WarpHostStore {
  cloud: {
    ip: string
    username: string
    password: string
  }
  sdwan: {
    networkName: string
    networkSecret: string
  }
  ui: {
    lastTab: string
    lastBlueprint: string
  }
}

export class StoreManager {
  private store: Store<WarpHostStore>

  constructor() {
    this.store = new Store<WarpHostStore>({
      name: 'warphost-user-preferences',
      defaults: {
        cloud: {
          ip: '',
          username: 'root',
          password: ''
        },
        sdwan: {
          networkName: 'warphost-net',
          networkSecret: ''
        },
        ui: {
          lastTab: 'cloud',
          lastBlueprint: 'minecraft'
        }
      }
    })
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value)
  }
}
