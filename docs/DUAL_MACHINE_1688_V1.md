# 1688 双机寻源 V1 操作手册

## 1. 架构边界

- `DEVELOPMENT`：编写与测试代码、只读选择 Temu 商品、生成输入包、审计执行机返回包。禁止正式运行 1688。
- `1688_RUNNER`：连接固定的真实 Chrome 与已登录的 1688 官方能力，执行图片搜索并保存证据。禁止修改 Temu 数据、提升商品池或执行 Temu 生产迁移。
- `data/temu_research_v2.db` 是 Temu 权威库；`data/1688_sourcing.db` 是独立的 1688 权威库。两者只通过 `temu_goods_id` 关联。
- 代码经 Git 交付；数据库、Chrome Profile、运行目录、日志、截图和结果 ZIP 不进 Git。

本版本不调用隐藏接口、不读取 Cookie/Token、不识别或绕过登录、短信、滑块、图片验证码、安全验证和账号确认。

## 2. 两台机器的环境配置

复制 `config/machine-role.example.env` 为本机 `.env`，不得把 `.env` 提交到 Git。

开发机：

```text
MACHINE_ROLE=DEVELOPMENT
SOURCING_DB_PATH=./data/1688_sourcing.db
```

执行机：

```text
MACHINE_ROLE=1688_RUNNER
TEMU_DB_PATH=./data/temu_research_v2.db
SOURCING_DB_PATH=./data/1688_sourcing.db
CHROME_CDP_ENDPOINT=http://127.0.0.1:9222
CHROME_PROFILE_DIR=<固定真实 Chrome Profile 的绝对路径>
```

每台机器先运行：

```powershell
npm run machine:audit
```

确认机器角色正确、Git 提交明确、Temu 数据库以 `READ_ONLY` 检查且 Active Pool 与 active memberships 都是 2135。执行机还要先运行 `npm run sourcing:1688:init-db` 初始化独立库，并在正式运行前保持 Git 工作区干净。

## 3. 开发机生成输入包

先提交本轮代码并确认工作区干净，再显式给出本轮商品 ID。不要使用全池参数：

```powershell
npm run sourcing:1688:prepare -- --run-id 1688-v1-YYYYMMDD-001 --goods-id id1,id2,id3,id4,id5
```

程序只读 Temu 主库，验证商品属于当前 2135 Active Pool，复制已校验本地主图，并生成：

```text
runtime/1688/input/<run_id>/
  manifest.json
  goods.jsonl
  images/
```

`manifest.json` 保存 `run_id`、创建时间、Git commit、输入数量及 JSONL 摘要；每张图片保存 SHA-256。目录已存在时拒绝覆盖。将整个 `<run_id>` 输入目录安全复制到执行机相同路径，不通过 Git 提交图片或数据库。

## 4. 执行机预检和启动

人工启动固定 Profile 的真实 Chrome，确认 1688 已登录且官方找同款能力可用。先只预检：

```powershell
npm run sourcing:1688:v1 -- --run-id 1688-v1-YYYYMMDD-001 --target 5 --preflight-only
```

预检依次验证：机器角色、target 为 1–20、Git 工作区干净、manifest 与当前 commit 相同、JSONL 数量和唯一性、每张图片存在且摘要匹配、Temu 库完整且 Active Pool=2135、独立 sourcing 库完整、run_id 从未执行、运行锁和输出目录不存在、真实 Chrome CDP 可连接。

全部通过后初始化正式运行：

```powershell
npm run sourcing:1688:v1 -- --run-id 1688-v1-YYYYMMDD-001 --target 5
```

该命令创建不可重复的运行记录、`runtime/1688/locks/<run_id>.lock` 和证据目录。锁包含 run、机器、PID、开始时间和 Git commit。异常退出保留锁，禁止直接重跑；调查后只能在执行机显式运行 `npm run sourcing:1688:unlock -- --run-id <run_id>`。解除锁不会删除历史数据库记录，因此相同 run_id 仍不能再次写入。

## 5. 真实 Chrome 中的逐商品步骤

1. 从 `goods.jsonl` 读取当前商品，状态从 `PENDING` 改为 `RUNNING`。
2. 每次重新取当前行的 `temu_goods_id` 和包内图片，不复用上一商品路径。
3. 打开 1688 官方采购助手的找同款/以图搜款，上传当前图片，并人工核对预览图与标题。
4. 等待结果、明确无结果或超时；不得调用隐藏接口。
5. 优先读取可识别的候选卡元素；其次使用官方复制、导出或打开商品页；仍不可靠就记录 `MANUAL_CAPTURE_REQUIRED`，不得用固定坐标猜字段。
6. 最多保存前 5 个候选。`candidate_rank` 只代表页面顺序，不代表最终供应商。标题、价格、MOQ、店铺、URL、图片 URL 等无法取得时保存 `null`，不得编造。
7. 截图保存为 `screenshots/<goods_id>-result.png`，禁止覆盖；页面和错误证据分别放 `pages/`、`errors/`。
8. 每个日志事件为一行 JSON，至少包含 `timestamp/run_id/goods_id/step/status/error`，不得写凭据。
9. 遇到登录、短信、滑块、图片验证码、安全验证或账号确认，立即设为 `WAITING_FOR_HUMAN` 并暂停，由人完成后从当前商品继续。

本仓库提供运行边界、数据结构、锁、日志和审计框架；官方采购助手中的元素拾取流程仍需在执行机的影刀/人工流程中按上述步骤配置。本轮未实际执行 1688 搜图，不应把初始化成功描述成搜索成功。

## 6. 状态与结果文件

合法状态只有 `PENDING/RUNNING/WAITING_FOR_HUMAN/COMPLETED/PARTIAL/FAILED/CANCELLED`。输出目录：

```text
outputs/1688-sourcing/<run_id>/
  run-summary.json
  candidates.jsonl
  runner.log
  screenshots/
  pages/
  errors/
```

每个候选使用 `run_id + temu_goods_id + candidate_rank` 唯一标识，rank 仅 1–5。独立 SQLite 是最终权威来源，文件是交接和审计证据。

## 7. 结果打包与开发机审计

执行机打包：

```powershell
npm run sourcing:1688:pack -- --run-id <run_id>
```

生成 `handoff/<run_id>-result.zip`。ZIP 使用排序文件名、固定时间戳和固定存储方式，同一输入可复现相同 SHA-256；只允许摘要、候选、日志、截图、页面和错误证据，拒绝数据库、Profile 或疑似凭据。

开发机审计：

```powershell
npm run sourcing:1688:audit -- handoff/<run_id>-result.zip
```

审计检查 ZIP 路径、CRC、白名单、敏感信息、摘要 JSON、候选 JSONL、rank 范围和候选重复。审计本身不写 Temu 生产库。

## 8. 放量规则

先稳定完成 5 个样本，逐商品确认图片无串图、搜索结果真实、候选字段可追溯、等待人工机制有效、ZIP 审计通过，再由人决定是否创建新的 20 条输入包。任何条件未满足均为 `BLOCKED` 或 `PARTIAL`，不得自动扩到 20，更不得处理全部 2135 条。
