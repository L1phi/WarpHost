export interface SyncPlan {
  localPath: string
  remotePath: string
  ignored?: string[]
}

export class SftpSyncService {
  createPlan(localPath: string, remotePath: string): SyncPlan {
    return {
      localPath,
      remotePath,
      ignored: ['node_modules', '.git', 'dist', 'out']
    }
  }

  async syncDirectory(plan: SyncPlan): Promise<string[]> {
    return [
      `Prepared sync from ${plan.localPath} to ${plan.remotePath}`,
      `Ignored entries: ${(plan.ignored ?? []).join(', ')}`
    ]
  }
}
