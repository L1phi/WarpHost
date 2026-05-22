# 我的实例教程

我的实例用于管理 WarpHost 在本地 Docker 中创建的容器。

## 功能说明

实例列表会显示容器：

- 名称
- 镜像
- 运行状态
- 端口
- 容器 ID

WarpHost 默认筛选容器名包含：

```text
warphost-
```

## 操作按钮

| 按钮 | 作用 |
| --- | --- |
| Refresh | 立即刷新实例列表 |
| Start | 启动已停止容器 |
| Stop | 停止运行中容器 |
| Destroy | 强制删除容器 |

## 删除风险

Destroy 会执行强制删除。删除后容器状态不可恢复，相关数据也可能丢失。

建议只删除你明确不再需要的游戏实例。

## 常见问题

### 实例列表为空

检查 Docker Desktop 是否运行，以及是否已经通过 WarpHost 部署过本地实例。

### 操作失败

检查 Docker 是否响应：

```bash
docker ps
```

如果 Docker Desktop 没启动，实例管理也无法工作。
