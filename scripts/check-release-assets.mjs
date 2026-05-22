import { existsSync } from 'node:fs'
import { join } from 'node:path'

const requiredFiles = [
  join('resources', 'easytier-core.exe'),
  join('docs', 'USAGE.md'),
  join('docs', 'guide-cloud.md'),
  join('docs', 'guide-local.md'),
  join('docs', 'guide-sdwan.md'),
  join('docs', 'guide-instances.md')
]

const missing = requiredFiles.filter((file) => !existsSync(file))

if (missing.length > 0) {
  console.error('[release-assets] Missing required release assets:')
  for (const file of missing) {
    console.error(`  - ${file}`)
  }
  console.error('')
  console.error('Put easytier-core.exe under resources/ before building the Windows installer.')
  process.exit(1)
}

console.log('[release-assets] All required release assets are present.')
