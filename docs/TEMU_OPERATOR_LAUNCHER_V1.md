# Temu Operator Launcher V1 运维说明

## 运营人员启动

当前 macOS V1 的入口是：

```text
/private/tmp/temu-multi-category-safety-v1/启动 Temu 运营台.app
```

在 Finder 使用“前往文件夹”打开 `/private/tmp/temu-multi-category-safety-v1`，然后双击“启动 Temu 运营台”。正常成功流程不会显示 Terminal，也不需要输入命令。启动器会：

1. 检查固定 worktree 和固定 config；
2. 在 Finder 环境中显式解析并验证 Node/npm；
3. 若 `127.0.0.1:37821` 已是经过身份验证的 Temu 运营台，则不重复启动；
4. 否则仅在端口空闲时后台启动 Dashboard；
5. 等待 `/api/health` 返回明确 Temu service identity；
6. 健康验证通过后，使用系统默认浏览器打开 `http://127.0.0.1:37821/`。

```text
TEMPORARY_DEPLOYMENT_PATH = YES
```

`/private/tmp` 可能被系统清理，这不是长期正式部署路径。如果目录或 config 不存在，启动器会 HARD FAIL，不会寻找主工作区、其它仓库或其它 config。

当前环境绑定：

```text
WORKTREE = /private/tmp/temu-multi-category-safety-v1
CONFIG = /Users/chuangyangdianzi/Desktop/选品上架-家里版本/temu选品/config.json
URL = http://127.0.0.1:37821/
HEALTH = http://127.0.0.1:37821/api/health
```

## 首次打开与 Gatekeeper

本地未签名 `.app` 首次打开时，macOS 可能显示 Gatekeeper 提示。允许的人工处理方式是：在 Finder 中右键应用，选择“打开”，再按本机安全策略确认。

启动器不会运行 `xattr`、`spctl`，不会修改系统安全设置，也不会自动关闭 Gatekeeper。如果本机策略不允许打开，应交给维护人员处理，不要降低系统安全级别。

## 启动失败

失败时会显示“Temu 运营台启动失败”及明确错误。Dashboard 日志：

```text
/private/tmp/temu-multi-category-safety-v1/logs/operator-dashboard.log
```

常见错误：

- `OPERATOR_WORKTREE_NOT_FOUND`：临时运行目录不存在；不会 fallback。
- `OPERATOR_CONFIG_NOT_FOUND`：固定 config 不存在；不会选择其它 config。
- `NODE_RUNTIME_NOT_FOUND` / `NPM_RUNTIME_NOT_FOUND`：Finder 环境无法验证对应运行时。
- `PORT_OCCUPIED_BY_OTHER_SERVICE`：37821 被非 Temu 服务占用；启动器不会停止对方。
- `DASHBOARD_START_FAILED` / `DASHBOARD_HEALTH_TIMEOUT`：Dashboard 未正常启动或未通过身份健康检查；浏览器不会打开假页面。

日志在新启动前超过 5 MiB 时轮换为 `operator-dashboard.log.1`。V1 只保留一个历史文件，不压缩；多代保留与集中日志属于后续 technical debt。

## 当前业务 Blocker 不会被启动器修复

启动器只负责启动 Dashboard。当前正式状态仍应显示并阻止创建任务：

```text
Active Pool = 2135
Active Memberships = 1149
Intersection = 1149
baseline_consistency = false
Profile available = false
创建采集任务 = BLOCKED
```

启动器不会 repair Active Pool、修改 membership、创建或恢复 Campaign，也不会启动 Chrome、Temu、Extension、页面绑定、滚动或采集。

## 维护人员：查看与停止

以下命令只供开发/维护使用，运营人员正常启动不需要 Terminal。

查看真实监听 PID：

```bash
lsof -nP -iTCP:37821 -sTCP:LISTEN
```

先确认服务身份：

```bash
curl -fsS http://127.0.0.1:37821/api/health
```

必须确认响应包含：

```json
{"ok":true,"service":"temu-operator-dashboard","apiVersion":1}
```

确认 PID 与身份后，维护人员才可手动停止该精确 PID：

```bash
kill <已人工确认的精确PID>
```

不要根据 `logs/operator-dashboard.pid` 单独判断或停止进程。PID 文件仅供诊断；真实状态始终以 `port + verified health identity` 为准。

## 数据库语义

```text
LAUNCHER_DIRECT_DB_WRITES = 0
DASHBOARD_STARTUP_RECOVERY_WRITES = POSSIBLE_EXISTING_BEHAVIOR
```

Launcher 不导入数据库模块、不运行 repair，也不修改 migration/checksum。Dashboard 自身启动时仍可能合法执行既有 migration/recoverInterrupted；Launcher 不改变或掩盖该语义。如果发生 checksum mismatch，启动失败并记录日志，不自动修复。
