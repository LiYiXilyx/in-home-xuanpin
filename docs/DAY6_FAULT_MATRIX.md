# Day 6 故障测试矩阵

测试日期：2026-08-21。真实数据库：`data/temu_research_v2.db`。真实暂停恢复任务：`job_a854e947fb4c434fbe0e5f33a27d4d70`。

| 编号 | 场景与操作步骤 | 预期状态 | 实际状态 | 错误码 | UI 提示 | 数据保留 | 可恢复 | 结果 |
|---|---|---|---|---|---|---|---|---|
| A | 启动 `src/server/index.mjs`，访问健康检查和首页 | server 正常、SQLite 数据可见 | 300 active、15/15 质量、100% 图片和历史任务可见 | — | 任务已完成，可导出 Excel | 是 | 是 | PASS |
| B | 点击打开独立 Chrome；已打开时再次点击 | CDP 9237 可连接且不重复启动 | 返回 `connected=true, alreadyOpen=true` | — | 采集 Chrome 已经打开 | 是 | 是 | PASS |
| C | 在真实摩托配件 Top Sales 页面开始 300 | 页面通过验证并开始滚动 | 产生 `browser_connected`、`page_validated` 事件 | — | 当前 Temu 类目和 Top Sales 页面验证通过 | 是 | 是 | PASS |
| D | 使用非 Temu URL 运行页面验证器 | 拒绝开始 | 被稳定拒绝 | `WRONG_SITE` | 当前页面不是 Temu | 是 | 是 | PASS |
| E | Temu 页面不含摩托配件证据 | 拒绝开始 | 被稳定拒绝 | `CATEGORY_NOT_CONFIRMED` | 请进入摩托配件类目 | 是 | 是 | PASS |
| F | 摩托配件页面未选择 Top Sales | 拒绝开始 | 被稳定拒绝 | `SORT_NOT_CONFIRMED` | 请选择 Top Sales 后重试 | 是 | 是 | PASS |
| G | 真实 job 运行中点击暂停 | 下一个批次边界写 checkpoint 后暂停 | 第 1 轮 40 条处写入 checkpoint，转 `paused` | `JOB_PAUSED` | 将在安全批次边界生效 | 是 | 是 | PASS |
| H | 暂停后按原 job_id 继续；处理真实验证码后再次继续 | resume_count 增加，原 checkpoint 可用 | `resume_count=2`，从 40 条恢复并最终完成 300/300 | `CAPTCHA_OR_LOGIN`（人工关卡期间） | 请人工完成安全验证后继续 | 是 | 是 | PASS |
| I | job 暂停后关闭并重启 server | 状态、checkpoint、事件仍在 | 原 job、40 条 checkpoint、暂停事件全部恢复 | — | 检测到原暂停任务 | 是 | 是 | PASS |
| J | 精确关闭专用 CDP 9237 Chrome，再重新打开 | 连接状态变离线，任务数据不丢，Chrome 可重开 | `connected=false` 时 job 仍 paused/40；重开后 `connected=true` | `CDP_UNREACHABLE` | 重新打开 Chrome 后继续原任务 | 是 | 是 | PASS |
| K | 模拟网络超时/连接重置 | 运营文案，不泄露 stack | ECONNRESET/Timeout 映射为网络/VPN检查提示 | `ECONNRESET` | 检查公司网络或 VPN 后重试 | 是 | 是 | PASS |
| L | 真实 Temu Security Verification 出现 | 不绕过，进入人工关卡 | job 转 `paused`，记录 `manual_gate_waiting` | `CAPTCHA_OR_LOGIN` | 人工处理验证码后点击继续 | 是 | 是 | PASS |
| M | 仅得到少量商品并尝试切换 active pool | 拒绝切换，原 300 保持 | 集成安全门测试通过 | `CATALOG_POOL_SAFETY_REJECTED` | 原商品池已保留 | 是 | 是 | PASS |
| N | 锁定固定 Excel 后从 Dashboard 导出 | 自动时间戳另存 | 生成 `Temu运营商品池-20260821-030246-705.xlsx` | — | Excel 已导出 | 是 | 是 | PASS |
| O | 一个 NETWORK_ERROR 失败项和一个 permanent 失败项分别重试 | 只接受 retriable | 网络失败进入 retry；永久失败返回拒绝 | `NO_RETRIABLE_ITEMS` | 永久错误需人工修正 | 是 | 是 | PASS |
| P | 原 catalog job paused 时再开始第二个任务 | 第二个任务不创建/不运行 | HTTP 409，原 job 不变 | `BROWSER_JOB_CONFLICT` | 请先继续、取消或完成当前任务 | 是 | 是 | PASS |

## 核心数据前后

- products：312（本次真实页面有 12 个商品更替，稳定身份历史保留）
- active catalog memberships：300
- product snapshots：1200（新完成 job 新增 300 条，同 job 无重复）
- completed local images coverage：300/300
- Excel 回归：300 行、300 图片、300 链接、3/3 人工备注，`export:qa` PASS

验证码属于人工关卡，不作为自动化失败处理；程序未绕过验证，任务和 checkpoint 均保留。人工完成验证后，原 job 已恢复并完成。
