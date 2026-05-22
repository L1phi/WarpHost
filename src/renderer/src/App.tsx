import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

type Tab = 'cloud' | 'local' | 'instances'
type GuideTopic = 'usage' | 'cloud' | 'local' | 'sdwan' | 'instances'

const NAV_ITEMS: { key: Tab; label: string }[] = [
  { key: 'cloud', label: '云端跃迁' },
  { key: 'local', label: '本地机房' },
  { key: 'instances', label: '我的实例' }
]

const MAX_LOG_LINES = 600

function ts(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

interface BlueprintInfo {
  name: string
  image: string
  hostPort: number
  containerPort: number
  envVars: Record<string, string>
  volumeMapping: string
}

interface EasyTierStatus {
  bundled: boolean
  installed: boolean
  bundledPath: string
  installedPath: string
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('cloud')
  const [host, setHost] = useState('')
  const [rootPassword, setRootPassword] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [logs, setLogs] = useState<string[]>([
    '[system] WarpHost console online.',
    '[system] Awaiting target coordinates.'
  ])

  const [blueprints, setBlueprints] = useState<BlueprintInfo[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedBlueprint = blueprints[selectedIndex] ?? null

  const [instances, setInstances] = useState<
    {
      id: string
      name: string
      image: string
      status: string
      statusDetail: string
      ports: string
      createdAt: string
    }[]
  >([])
  const [destroyTarget, setDestroyTarget] = useState<string | null>(null)

  const [etNetworkName, setEtNetworkName] = useState('warphost-net')
  const [etPassword, setEtPassword] = useState('')
  const [etRunning, setEtRunning] = useState(false)
  const [etVirtualIp, setEtVirtualIp] = useState<string | null>(null)
  const [copyTip, setCopyTip] = useState(false)
  const [easytierStatus, setEasytierStatus] = useState<EasyTierStatus | null>(null)

  const persistReady = useRef(false)
  const persistBlueprintName = useRef<string | null>(null)
  const etCleanupRef = useRef<(() => void) | null>(null)
  const copyTipTimerRef = useRef<number | null>(null)

  const pushLogs = useCallback(
    (...lines: string[]): void => setLogs((c) => [...c, ...lines].slice(-MAX_LOG_LINES)),
    []
  )

  const saveStore = useCallback((key: string, value: unknown): void => {
    if (persistReady.current) {
      void window.api.store.set(key, value)
    }
  }, [])

  // ── On mount: load persisted state ─────────────────────────────────

  useEffect(() => {
    void (async () => {
      const [cloudIp, cloudPass, netName, netSecret, lastTab, lastBp] = await Promise.all([
        window.api.store.get<string>('cloud.ip'),
        window.api.store.get<string>('cloud.password'),
        window.api.store.get<string>('sdwan.networkName'),
        window.api.store.get<string>('sdwan.networkSecret'),
        window.api.store.get<string>('ui.lastTab'),
        window.api.store.get<string>('ui.lastBlueprint')
      ])

      if (typeof cloudIp === 'string') setHost(cloudIp)
      if (typeof cloudPass === 'string') setRootPassword(cloudPass)
      if (typeof netName === 'string') setEtNetworkName(netName)
      if (typeof netSecret === 'string') setEtPassword(netSecret)

      if (
        typeof lastTab === 'string' &&
        (lastTab === 'cloud' || lastTab === 'local' || lastTab === 'instances')
      ) {
        setActiveTab(lastTab as Tab)
      }

      if (typeof lastBp === 'string') {
        persistBlueprintName.current = lastBp
      }

      persistReady.current = true
    })()
  }, [])

  // ── Dynamic blueprints ──────────────────────────────────────────────

  useEffect(() => {
    window.api.fetchBlueprints().then((result) => {
      if (result.ok) {
        setBlueprints(result.blueprints)
        pushLogs(...result.warnings)

        // Apply persisted blueprint selection
        if (persistBlueprintName.current) {
          const idx = result.blueprints.findIndex((bp) => bp.name === persistBlueprintName.current)
          if (idx !== -1) setSelectedIndex(idx)
          persistBlueprintName.current = null
        }
      } else {
        pushLogs(...result.warnings, '[error] Failed to load blueprints.')
      }
    })
  }, [pushLogs])

  useEffect(() => {
    const unsubLog = window.api.onEasytierLog((line: string) => {
      setLogs((c) => [...c, `[${ts()}] ${line}`])
    })
    const unsubVip = window.api.onEasytierVirtualIp((ip: string) => {
      setEtVirtualIp(ip)
      setLogs((c) => [...c, `[${ts()}] SD-WAN virtual IP assigned: ${ip}`])
    })
    etCleanupRef.current = () => {
      unsubLog()
      unsubVip()
    }
    return () => {
      unsubLog()
      unsubVip()
      if (copyTipTimerRef.current !== null) {
        window.clearTimeout(copyTipTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    window.api
      .getEasytierStatus()
      .then((result) => {
        if (cancelled) return
        if (result.ok && result.status) {
          setEasytierStatus(result.status)
        } else {
          pushLogs(`[easytier] ${result.error ?? 'Failed to inspect EasyTier status.'}`)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
        pushLogs(`[easytier] ${message}`)
      })

    return () => {
      cancelled = true
    }
  }, [pushLogs])

  const sshPayload = { host, username: 'root', password: rootPassword }

  // ── Persist on change ─────────────────────────────────────────────

  // Save tab & blueprint changes
  useEffect(() => {
    saveStore('ui.lastTab', activeTab)
  }, [activeTab, saveStore])

  useEffect(() => {
    if (selectedBlueprint && persistReady.current) {
      saveStore('ui.lastBlueprint', selectedBlueprint.name)
    }
  }, [selectedBlueprint, saveStore])

  // ── Poll instances when tab is active ──────────────────────────────

  const refreshInstances = useCallback(async () => {
    try {
      const result = await window.api.fetchInstances()
      if (result.ok) setInstances(result.instances)
    } catch {
      // Docker may not be running — silently ignore
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'instances') return
    const refreshTimer = window.setTimeout(() => {
      void refreshInstances()
    }, 0)
    const interval = window.setInterval(refreshInstances, 5000)
    return () => {
      window.clearTimeout(refreshTimer)
      window.clearInterval(interval)
    }
  }, [activeTab, refreshInstances])

  // ── Cloud deploy ───────────────────────────────────────────────────

  const handleCloudDeploy = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!selectedBlueprint) return

    setIsDeploying(true)
    pushLogs(`[${ts()}] SSH probe dispatched to ${host || 'unknown'}`)

    try {
      const sshResult = await window.api.testSsh(sshPayload)

      pushLogs(
        ...sshResult.logs,
        sshResult.ok ? '[status] connectivity verified.' : '[status] handshake rejected.'
      )

      if (!sshResult.ok) return

      pushLogs(`[${ts()}] Connectivity confirmed — scanning remote environment...`)

      const envResult = await window.api.checkEnvironment(sshPayload)

      pushLogs(
        ...envResult.logs,
        envResult.ok
          ? '[status] environment ready.'
          : '[status] environment check completed with warnings.'
      )

      pushLogs(`[${ts()}] Initiating game server deployment...`)

      const deployResult = await window.api.deployGame({
        ...sshPayload,
        blueprint: selectedBlueprint
      })

      pushLogs(
        ...deployResult.logs,
        deployResult.ok
          ? '[status] deployment successful — game server is live.'
          : '[status] deployment completed with warnings.'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[fatal] ${message}`)
    } finally {
      setIsDeploying(false)
    }
  }

  // ── Local deploy ───────────────────────────────────────────────────

  const handleLocalDeploy = async (): Promise<void> => {
    if (!selectedBlueprint) return

    setIsDeploying(true)
    pushLogs(`[${ts()}] Local IPv6 engine engaged.`)

    try {
      const result = await window.api.deployLocalGame({ blueprint: selectedBlueprint })

      pushLogs(
        ...result.logs,
        result.ok
          ? '[status] local deployment successful — friends can connect now.'
          : '[status] local deployment completed with warnings.'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[fatal] ${message}`)
    } finally {
      setIsDeploying(false)
    }
  }

  // ── EasyTier toggle ────────────────────────────────────────────────

  const handleToggleEasytier = async (): Promise<void> => {
    setIsBusy(true)

    if (etRunning) {
      try {
        const result = await window.api.stopEasytier()
        pushLogs(...result.logs)
        setEtRunning(false)
        setEtVirtualIp(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
        pushLogs(`[fatal] ${message}`)
      } finally {
        setIsBusy(false)
      }
      return
    }

    if (!etPassword) {
      pushLogs('[easytier] Password is required to start the SD-WAN network.')
      setIsBusy(false)
      return
    }

    if (!easytierStatus?.installed) {
      pushLogs('[easytier] EasyTier is not installed. Install it before connecting SD-WAN.')
      setIsBusy(false)
      return
    }

    pushLogs(`[${ts()}] Starting EasyTier SD-WAN engine...`)

    try {
      const result = await window.api.startEasytier({
        networkName: etNetworkName || 'warphost-net',
        password: etPassword
      })

      pushLogs(...result.logs)

      if (result.ok) {
        setEtRunning(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[fatal] ${message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleInstallEasytier = async (): Promise<void> => {
    setIsBusy(true)
    pushLogs(`[${ts()}] Installing embedded EasyTier SD-WAN component...`)

    try {
      const result = await window.api.installEasytier()
      if (result.ok && result.status) {
        setEasytierStatus(result.status)
        pushLogs('[easytier] EasyTier installed. You can connect SD-WAN now.')
      } else {
        pushLogs(`[easytier] ${result.error ?? 'Failed to install EasyTier.'}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[fatal] ${message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleCopyVip = async (): Promise<void> => {
    if (!etVirtualIp) return
    try {
      await navigator.clipboard.writeText(etVirtualIp)
      setCopyTip(true)
      if (copyTipTimerRef.current !== null) {
        window.clearTimeout(copyTipTimerRef.current)
      }
      copyTipTimerRef.current = window.setTimeout(() => {
        setCopyTip(false)
        copyTipTimerRef.current = null
      }, 1800)
    } catch {
      // clipboard may fail in some environments
    }
  }

  const handleOpenGuide = async (topic: GuideTopic): Promise<void> => {
    try {
      const result = await window.api.openGuide(topic)
      if (!result.ok) {
        pushLogs(`[guide] ${result.error ?? 'Failed to open guide.'}`)
        return
      }
      pushLogs(`[guide] Opened ${topic} guide.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[guide] ${message}`)
    }
  }

  // ── Instance actions ───────────────────────────────────────────────

  const handleInstanceAction = async (
    action: 'start' | 'stop' | 'remove',
    id: string
  ): Promise<void> => {
    setIsBusy(true)
    pushLogs(`[${ts()}] Dispatch: ${action} → container ${id.slice(0, 12)}`)

    try {
      const result = await window.api.controlInstance({ action, id })
      pushLogs(...result.logs)
      await refreshInstances()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown IPC failure.'
      pushLogs(`[fatal] ${message}`)
    } finally {
      setIsBusy(false)
    }
  }

  const confirmDestroy = (id: string): void => {
    setDestroyTarget(id)
  }

  const executeDestroy = async (): Promise<void> => {
    if (!destroyTarget) return
    const id = destroyTarget
    setDestroyTarget(null)
    await handleInstanceAction('remove', id)
  }

  // ── Shared blueprint selector UI ───────────────────────────────────

  const blueprintSelector = (
    <div className="flex items-center gap-4 rounded-md border border-cyan-300/15 bg-slate-950/50 px-4 py-3">
      <span className="shrink-0 text-sm font-semibold text-cyan-300">蓝图选择</span>

      <select
        value={selectedIndex}
        onChange={(e) => setSelectedIndex(Number(e.target.value))}
        disabled={blueprints.length === 0}
        className="h-9 min-w-36 rounded border border-cyan-300/20 bg-slate-950 px-3 font-mono text-sm text-cyan-100 outline-none transition focus:border-cyan-300 focus:shadow-cyan-glow disabled:opacity-40"
      >
        {blueprints.length === 0 ? (
          <option value={0}>Loading...</option>
        ) : (
          blueprints.map((bp, i) => (
            <option key={bp.name} value={i}>
              {bp.name}
            </option>
          ))
        )}
      </select>

      {selectedBlueprint && (
        <div className="flex flex-1 items-center gap-6 font-mono text-xs text-slate-300">
          <span className="text-slate-500">{selectedBlueprint.image}</span>
          <span className="ml-auto text-green-400">
            :{selectedBlueprint.hostPort} → :{selectedBlueprint.containerPort}
          </span>
        </div>
      )}
    </div>
  )

  // ── Header config ──────────────────────────────────────────────────

  const headerContent = {
    cloud: {
      eybrow: 'cloud jump protocol',
      title: '云端跃迁',
      badge: 'SSH / SFTP / DOCKER'
    },
    local: {
      eybrow: 'local ipv6 engine',
      title: '本地机房',
      badge: 'IPv6 / FIREWALL / DOCKER / SD-WAN'
    },
    instances: {
      eybrow: 'fleet dashboard',
      title: '我的实例',
      badge: `${instances.length} CONTAINER(S)`
    }
  }[activeTab]

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <main className="flex h-screen bg-slate-950 text-slate-100">
      {/* ═══════════════ SIDEBAR ═══════════════ */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-cyan-400/15 bg-black/55 px-5 py-6">
        <div className="mb-10">
          <div className="text-xs uppercase tracking-[0.42em] text-cyan-300/70">WarpHost</div>
          <div className="mt-3 text-2xl font-black tracking-normal text-white">跃迁控制台</div>
        </div>

        <nav className="space-y-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full rounded-md border px-4 py-3 text-left text-sm font-semibold transition ${
                activeTab === item.key
                  ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100 shadow-cyan-glow'
                  : 'border-white/5 bg-white/[0.03] text-slate-400 hover:border-cyan-300/30 hover:text-cyan-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-md border border-green-400/20 bg-green-400/5 p-4 font-mono text-xs text-green-300">
          <div>CORE: READY</div>
          <div>IPC: SECURE BRIDGE</div>
          <div>
            MODE:{' '}
            {activeTab === 'local'
              ? 'LOCAL IPv6'
              : activeTab === 'instances'
                ? 'FLEET MGMT'
                : 'LIVE SSH'}
          </div>
        </div>
      </aside>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <section className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_34%),linear-gradient(135deg,#020617_0%,#06111f_48%,#020617_100%)] px-10 py-8">
        <header className="mb-8 flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.34em] text-green-300">
              {headerContent.eybrow}
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-normal text-white">
              {headerContent.title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleOpenGuide(activeTab)}
              className="rounded-md border border-green-300/30 bg-green-300/10 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-green-200 transition hover:bg-green-300/20"
            >
              打开教程
            </button>
            <button
              onClick={() => handleOpenGuide('usage')}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
            >
              完整手册
            </button>
            <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 font-mono text-xs text-cyan-100">
              {headerContent.badge}
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-6">
          {/* ═══════ 云端跃迁 Form ═══════ */}
          {activeTab === 'cloud' && (
            <form
              onSubmit={handleCloudDeploy}
              className="flex flex-col gap-4 rounded-lg border border-white/10 bg-black/35 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur"
            >
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">
                    目标服务器 IP
                  </span>
                  <input
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                    onBlur={() => saveStore('cloud.ip', host)}
                    placeholder="203.0.113.42"
                    className="h-12 w-full rounded-md border border-cyan-300/20 bg-slate-950/80 px-4 font-mono text-cyan-50 outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:shadow-cyan-glow"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-300">Root 密码</span>
                  <input
                    value={rootPassword}
                    onChange={(event) => setRootPassword(event.target.value)}
                    onBlur={() => saveStore('cloud.password', rootPassword)}
                    type="password"
                    placeholder="••••••••••••"
                    className="h-12 w-full rounded-md border border-cyan-300/20 bg-slate-950/80 px-4 font-mono text-cyan-50 outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:shadow-cyan-glow"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isDeploying || !selectedBlueprint}
                  className="h-16 min-w-56 rounded-md border border-green-300/60 bg-green-400 px-8 text-base font-black uppercase tracking-normal text-slate-950 shadow-green-glow transition hover:-translate-y-0.5 hover:bg-cyan-300 hover:shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeploying ? '跃迁中...' : '一键跃迁 (Deploy)'}
                </button>
              </div>

              {blueprintSelector}
            </form>
          )}

          {/* ═══════ 本地机房 Forms ═══════ */}
          {activeTab === 'local' && (
            <div className="flex flex-col gap-4">
              {/* ── SD-WAN Card ── */}
              <div className="rounded-lg border border-white/10 bg-black/35 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
                <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">
                    虚拟局域网 (SD-WAN)
                  </h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleOpenGuide('sdwan')}
                      className="rounded border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-cyan-200 transition hover:bg-cyan-300/20"
                    >
                      SD-WAN 教程
                    </button>
                    <span
                      className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                        etRunning ? 'text-green-400' : 'text-slate-500'
                      }`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          etRunning
                            ? 'animate-pulse bg-green-400 shadow-green-glow'
                            : 'bg-slate-600'
                        }`}
                      />
                      {etRunning ? 'PEERING' : 'IDLE'}
                    </span>
                  </div>
                </div>

                {!easytierStatus?.installed && (
                  <div className="mb-4 rounded-md border border-yellow-300/25 bg-yellow-300/10 px-4 py-3">
                    <div className="flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-yellow-200">
                          EasyTier 未安装
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          只有在无公网 IP、NAT、宿舍网、校园网或朋友 P2P 联机时才需要安装
                          EasyTier。云服务器开服和公网 IPv6 开服可以暂时不启用。
                        </p>
                        {easytierStatus && !easytierStatus.bundled && (
                          <p className="mt-1 font-mono text-xs text-red-300">
                            Missing bundled binary: {easytierStatus.bundledPath}
                          </p>
                        )}
                      </div>

                      <button
                        onClick={handleInstallEasytier}
                        disabled={isBusy || easytierStatus?.bundled === false}
                        className="h-11 min-w-40 rounded-md border border-yellow-300/40 bg-yellow-300/20 px-5 font-mono text-xs font-black uppercase tracking-wider text-yellow-100 transition hover:bg-yellow-300/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        安装 EasyTier
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-4">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-slate-400">
                      网络名称
                    </span>
                    <input
                      value={etNetworkName}
                      onChange={(e) => setEtNetworkName(e.target.value)}
                      onBlur={() => saveStore('sdwan.networkName', etNetworkName)}
                      disabled={etRunning || !easytierStatus?.installed}
                      placeholder="warphost-net"
                      className="h-11 w-full rounded-md border border-cyan-300/20 bg-slate-950/80 px-4 font-mono text-sm text-cyan-50 outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:shadow-cyan-glow disabled:opacity-50"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold text-slate-400">
                      网络密钥
                    </span>
                    <input
                      value={etPassword}
                      onChange={(e) => setEtPassword(e.target.value)}
                      onBlur={() => saveStore('sdwan.networkSecret', etPassword)}
                      disabled={etRunning || !easytierStatus?.installed}
                      type="password"
                      placeholder="最少 8 位"
                      className="h-11 w-full rounded-md border border-cyan-300/20 bg-slate-950/80 px-4 font-mono text-sm text-cyan-50 outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:shadow-cyan-glow disabled:opacity-50"
                    />
                  </label>

                  <button
                    onClick={handleToggleEasytier}
                    disabled={isBusy || !easytierStatus?.installed}
                    className={`h-11 min-w-44 rounded-md border px-6 text-sm font-black uppercase tracking-wider transition disabled:opacity-50 ${
                      etRunning
                        ? 'border-red-400/50 bg-red-400/20 text-red-200 hover:bg-red-400/30'
                        : 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25 shadow-cyan-glow'
                    }`}
                  >
                    {etRunning ? '断开 (Disconnect)' : '连接 (Connect)'}
                  </button>
                </div>

                {/* Virtual IP display */}
                {etVirtualIp && (
                  <div className="mt-4 flex items-center gap-3 rounded-md border border-green-400/25 bg-green-400/5 px-4 py-3">
                    <span className="font-mono text-xs text-slate-400">V-IP:</span>
                    <span className="font-mono text-lg font-bold tracking-wider text-green-300">
                      {etVirtualIp}
                    </span>
                    <button
                      onClick={handleCopyVip}
                      className="ml-auto flex items-center gap-1 rounded border border-green-400/30 bg-green-400/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-green-300 transition hover:bg-green-400/20"
                    >
                      {copyTip ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Game Deploy Card ── */}
              <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-black/35 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
                <div className="flex items-center gap-4">
                  <div className="flex-1 rounded-md border border-green-400/20 bg-green-400/5 px-4 py-3 font-mono text-sm text-green-300">
                    <span className="text-slate-500">Target: </span>
                    <span className="text-green-200">Local Machine (IPv6 Engine)</span>
                  </div>

                  <button
                    onClick={handleLocalDeploy}
                    disabled={isDeploying || !selectedBlueprint}
                    className="h-16 min-w-56 rounded-md border border-green-300/60 bg-green-400 px-8 text-base font-black uppercase tracking-normal text-slate-950 shadow-green-glow transition hover:-translate-y-0.5 hover:bg-cyan-300 hover:shadow-cyan-glow disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeploying ? '部署中...' : '一键部署 (Local)'}
                  </button>
                </div>

                {blueprintSelector}
              </div>
            </div>
          )}

          {/* ═══════ 我的实例 Dashboard ═══════ */}
          {activeTab === 'instances' && (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {/* Toolbar */}
              <div className="flex items-center gap-3">
                <button
                  onClick={refreshInstances}
                  disabled={isBusy}
                  className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 font-mono text-xs text-cyan-200 transition hover:bg-cyan-300/20 disabled:opacity-50"
                >
                  REFRESH
                </button>
                <span className="ml-auto font-mono text-xs text-slate-500">
                  auto-refresh: 5s &middot; filter: warphost-*
                </span>
              </div>

              {/* Card grid */}
              {instances.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-white/5 bg-black/25">
                  <div className="text-center font-mono">
                    <div className="mb-3 text-5xl text-slate-800">{}</div>
                    <div className="text-sm text-slate-500">No WarpHost containers found</div>
                    <div className="mt-2 text-xs text-slate-600">
                      Deploy a game server to see it here
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid auto-rows-max grid-cols-1 gap-3 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                  {instances.map((inst) => (
                    <div
                      key={inst.id}
                      className="group flex flex-col gap-3 rounded-lg border border-white/10 bg-black/45 p-4 transition hover:border-cyan-300/20 hover:bg-black/60"
                    >
                      {/* Status bar */}
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span
                            className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                              inst.status === 'Up' ? 'animate-ping bg-green-400' : 'bg-red-500'
                            }`}
                          />
                          <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                              inst.status === 'Up' ? 'bg-green-400 shadow-green-glow' : 'bg-red-500'
                            }`}
                          />
                        </span>
                        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-cyan-200">
                          {inst.name}
                        </span>
                        <span
                          className={`ml-auto font-mono text-[10px] uppercase ${
                            inst.status === 'Up' ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {inst.status}
                        </span>
                      </div>

                      {/* Details */}
                      <div className="space-y-1 font-mono text-[11px] text-slate-400">
                        <div className="flex justify-between">
                          <span className="text-slate-600">IMAGE</span>
                          <span className="truncate pl-4 text-slate-300">{inst.image}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">PORTS</span>
                          <span className="text-green-400/80">{inst.ports || '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">ID</span>
                          <span className="text-slate-500">{inst.id.slice(0, 12)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 border-t border-white/5 pt-3">
                        {inst.status !== 'Up' && (
                          <button
                            disabled={isBusy}
                            onClick={() => handleInstanceAction('start', inst.id)}
                            className="flex-1 rounded border border-green-400/30 bg-green-400/10 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-green-300 transition hover:bg-green-400/20 disabled:opacity-40"
                          >
                            Start
                          </button>
                        )}
                        {inst.status === 'Up' && (
                          <button
                            disabled={isBusy}
                            onClick={() => handleInstanceAction('stop', inst.id)}
                            className="flex-1 rounded border border-yellow-400/30 bg-yellow-400/10 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-yellow-300 transition hover:bg-yellow-400/20 disabled:opacity-40"
                          >
                            Stop
                          </button>
                        )}
                        <button
                          disabled={isBusy}
                          onClick={() => confirmDestroy(inst.id)}
                          className="rounded border border-red-400/25 bg-red-400/10 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-red-300 transition hover:bg-red-400/20 disabled:opacity-40"
                        >
                          Destroy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════ Terminal Log ═══════ */}
          <section className="min-h-0 rounded-lg border border-green-400/20 bg-black p-5 shadow-2xl shadow-black/50">
            <div className="mb-4 flex items-center justify-between border-b border-green-400/10 pb-3">
              <h2 className="font-mono text-sm font-bold uppercase tracking-[0.28em] text-green-300">
                terminal log
              </h2>
              <span className="font-mono text-xs text-green-400/70">stream reserved</span>
            </div>
            <div className="h-full overflow-auto pb-10 font-mono text-sm leading-7 text-green-400">
              {logs.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
              <div className="animate-pulse text-green-300">_</div>
            </div>
          </section>
        </div>
      </section>

      {/* ═══════════════ DESTROY CONFIRMATION MODAL ═══════════════ */}
      {destroyTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setDestroyTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-red-400/40 bg-slate-950 p-6 shadow-2xl shadow-red-950/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 font-mono text-xs uppercase tracking-[0.3em] text-red-400">
              &gt; CRITICAL OPERATION
            </div>
            <h3 className="mb-4 font-mono text-xl font-black text-red-300">DESTROY INSTANCE?</h3>

            <div className="mb-6 space-y-2 rounded border border-red-400/15 bg-red-400/5 p-3 font-mono text-xs text-red-300/80">
              <div>&gt; target_id = {destroyTarget.slice(0, 12)}</div>
              <div>&gt; action = rm -f (FORCE DELETE)</div>
              <div>&gt; recovery = IMPOSSIBLE</div>
            </div>

            <p className="mb-6 text-sm text-slate-400">
              This action is <span className="font-bold text-red-300">IRREVERSIBLE</span>. All
              container data, saved worlds, and configuration will be permanently erased from the
              filesystem.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setDestroyTarget(null)}
                className="flex-1 rounded border border-white/15 bg-white/5 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={executeDestroy}
                className="flex-1 rounded border border-red-400/50 bg-red-500/20 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-red-200 transition hover:bg-red-500/30 hover:shadow-red-glow"
              >
                Confirm Destroy
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
