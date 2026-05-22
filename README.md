<div align="center">

# WarpHost

### Cyberpunk Game Server Control Plane

**一个安装包，三套开服引擎。**

![Electron](https://img.shields.io/badge/Electron-39-9FEAF9?style=for-the-badge&logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)
![EasyTier](https://img.shields.io/badge/EasyTier-Bundled-39FF14?style=for-the-badge)
![Security](https://img.shields.io/badge/IPC-Hardened-FF2BD6?style=for-the-badge)

WarpHost 是一款赛博朋克风格的 Electron 桌面开服面板。它把云服务器、本地 IPv6、SD-WAN 虚拟局域网三种开服路径整合进一个控制台，让玩家和服主可以用同一套蓝图启动、管理、联机游戏服务器。

</div>

---

## 核心定位

WarpHost 的目标不是让用户折腾环境，而是让用户安装后直接进入开服流程：

```text
下载 WarpHost-setup.exe
安装
打开 WarpHost
选择蓝图
选择网络模式
部署游戏服务器
```

安装包内置：

- WarpHost 桌面应用
- EasyTier SD-WAN 核心 `easytier-core.exe`
- 本地教程文档
- 默认图标与运行资源

Docker Desktop 不会被强行静默安装。WarpHost 会在本地开服时检测 Docker 状态，并在未就绪时给出明确提示。

---

## 三引擎架构

| 引擎 | 面向场景 | 能力 |
| --- | --- | --- |
| 云端跃迁 | 有 VPS / 云服务器 | 基于 `ssh2` 远程连接服务器，检查 Docker，拉取镜像并启动游戏容器 |
| 本地机房 | 家宽公网 IPv6 | 自动抓取本机公网 IPv6，打开 Windows 防火墙端口，启动本地 Docker 容器 |
| SD-WAN | 无公网 IP / NAT / P2P 联机 | 内置 EasyTier，创建虚拟局域网，让玩家通过 `10.x.x.x` 虚拟 IP 联机 |

---

## 主要特性

### 三阶段流水线

WarpHost 将开服过程拆成稳定、可观察的三阶段：

1. **环境探测**：SSH、Docker、本机 IPv6、防火墙、EasyTier 二进制。
2. **部署执行**：拉取镜像、创建数据目录、开放端口、启动容器。
3. **运行观测**：日志回流、实例列表、启动/停止/删除、SD-WAN 虚拟 IP 展示。

### 动态蓝图

游戏服务由 JSON 蓝图描述，不写死在代码里：

```json
{
  "name": "minecraft",
  "image": "itzg/minecraft-server:latest",
  "hostPort": 25565,
  "containerPort": 25565,
  "volumeMapping": "/opt/warphost/minecraft:/data",
  "envVars": {
    "EULA": "TRUE",
    "MEMORY": "2G"
  }
}
```

### 内置教程

安装包会分发 `docs/` 下的本地教程。应用内不同功能区可以直接打开对应文档：

- 云端跃迁教程
- 本地机房教程
- SD-WAN 教程
- 我的实例教程
- 完整使用手册

---

## 安装包方案

Windows 安装包由 Electron Builder + NSIS 生成。

关键配置：

```yaml
extraResources:
  - from: resources
    to: .
    filter:
      - easytier-core.exe
  - from: docs
    to: docs
    filter:
      - '*.md'
```

生产环境中 EasyTier 路径为：

```text
process.resourcesPath/easytier-core.exe
```

教程路径为：

```text
process.resourcesPath/docs/*.md
```

---

## 快速开始

### 开发运行

```bash
npm install
npm run dev
```

### 类型检查与构建

```bash
npm run typecheck
npm run lint
npm run build
```

### 准备 Windows 安装包资源

打包前必须放入 EasyTier：

```text
resources/easytier-core.exe
```

项目会在 Windows 打包前检查：

```bash
npm run check:release-assets
```

### 生成 Windows 安装包

```bash
npm run build:win
```

国内网络环境：

```bash
npm run build:win:cn
```

产物位于：

```text
dist/
```

常见文件名：

```text
warphost-1.0.0-setup.exe
```

---

## 使用方式

### 云服务器开服

1. 打开 WarpHost。
2. 进入 **云端跃迁**。
3. 填写服务器 IP、root 密码。
4. 选择游戏蓝图。
5. 点击一键跃迁。
6. 等待日志输出连接地址。

### 本地 IPv6 开服

1. 启动 Docker Desktop。
2. 打开 WarpHost。
3. 进入 **本地机房**。
4. 选择游戏蓝图。
5. 点击本地部署。
6. WarpHost 自动检测公网 IPv6 并尝试开放防火墙端口。

### SD-WAN 联机

1. 打开 WarpHost。
2. 进入 **本地机房**。
3. 输入网络名称和网络密钥。
4. 点击连接 SD-WAN。
5. 将虚拟 IP 和游戏端口发给玩家。

更多细节见 [完整使用手册](docs/USAGE.md)。

---

## 目录结构

```text
WarpHost
├─ docs
│  ├─ USAGE.md              # 完整使用手册
│  ├─ guide-cloud.md        # 云端跃迁教程
│  ├─ guide-local.md        # 本地机房教程
│  ├─ guide-sdwan.md        # SD-WAN 教程
│  └─ guide-instances.md    # 实例管理教程
├─ resources
│  ├─ icon.png
│  └─ easytier-core.exe     # 打包前放入
├─ scripts
│  └─ check-release-assets.mjs
├─ src
│  ├─ main
│  │  ├─ index.ts
│  │  ├─ ipcEvents.ts
│  │  ├─ core
│  │  │  ├─ docker.ts
│  │  │  ├─ easytier.ts
│  │  │  ├─ localEngine.ts
│  │  │  ├─ ssh.ts
│  │  │  └─ blueprint.ts
│  │  └─ utils
│  │     └─ safety.ts
│  ├─ preload
│  │  ├─ index.ts
│  │  └─ index.d.ts
│  └─ renderer
│     └─ src
│        └─ App.tsx
├─ electron-builder.yml
└─ package.json
```

---

## 安全设计

WarpHost 的安全底座集中在主进程：

- 渲染进程不直接访问 Node.js。
- preload 只暴露受控 API。
- IPC payload 进入执行层前经过严格校验。
- 本地系统命令使用 `execFile`，不经过 shell。
- 远程 SSH 动态参数使用 shell escaping。
- EasyTier 子进程由主进程托管，退出时主动清理。
- 教程打开 IPC 仅允许固定主题，不能打开任意路径。

---

## 发布前检查

发布 Windows 安装包前确认：

- `resources/easytier-core.exe` 存在。
- `docs/*.md` 教程存在。
- `npm run lint` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- `npm run build:win` 通过。
- 在干净 Windows 机器上验证安装、启动、SD-WAN、Docker 检测、教程打开。

---

## 致谢

WarpHost 的 SD-WAN / P2P 虚拟局域网能力由 EasyTier 提供底层技术支持。

---

## License

MIT License

Copyright (c) 2026 Philip Zhao

<div align="center">

**WarpHost**

_Deploy the server. Bend the network. Start the game._

</div>
