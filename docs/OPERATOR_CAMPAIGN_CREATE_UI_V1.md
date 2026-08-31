# Operator Campaign Create UI V1

## 用途

本页面用于创建一个明确绑定 Category Profile 的 `MANUAL_BIND_PASSIVE_CAPTURE` Campaign。运营人员不需要输入 CLI，也不需要复制或填写 `campaign_id`。

本功能当前范围仅为 Germany / English / EUR + Multi-Category。创建按钮不会打开或切换 Temu 页面，不会滚动、翻页、点击 See more、处理 CAPTCHA、绑定页面或自动采集。

## 启动

在隔离 worktree 中执行：

```bash
cd /private/tmp/temu-multi-category-safety-v1
npm run dashboard
```

浏览器打开：

```text
http://127.0.0.1:37821/
```

## 正常运营流程

1. 在 localhost 运营台的“新建采集任务”区域选择经过验证的 Category 和 Category Profile。
2. 确认页面显示当前 Category 的 Active Pool 数量。
3. 输入“本次新增目标数量”和任务名称。Campaign Target 由页面预览，但最终必须由服务器按 `Active Pool count + requested new count` 重新计算。
4. 点击“创建采集任务”。
5. 在“当前采集任务”卡片确认 Category、Campaign Name、Baseline、Target、Current Unique、Remaining、Status，以及 `等待页面绑定 · UNBOUND`。
6. 人工打开使用指定 Chrome Profile 的健康 Temu 页面；人工确认 Germany、English、EUR、正确 Category 和 Top Sales。
7. 在 Temu 页面上的浏览器扩展中依次点击“检测当前页面”、“绑定当前页面”、“采集当前页面”。三步必须分开执行。
8. 页面 Category、sort、URL context、country、language 或 currency 改变后，旧 binding 自动失效。重新执行检测和绑定后，才可再次采集。

## 安全行为

- 未绑定时采集被阻止，数据库 0 writes。
- active queue conflict 显示 `CATALOG_RPA_CLAIM_CONFLICT` 并停止；系统不会取消、删除或恢复任何旧 Campaign。
- `request_id` 只用于同一组创建参数的幂等重放，不用于选择 latest Campaign 或隐式 resume。
- Resume 仍要求显式 Campaign，并保留 CLI 作为开发和诊断入口。
- Extension 只消费服务器返回的明确 current context。
- localhost 创建表单没有 Campaign ID 输入框。
- 影刀导出仅预留 integration seam，本版本没有实现完整 YingDao Task Export。

## 常见错误

- `INITIAL_ACTIVE_POOL_REQUIRED`：所选 Category 尚无正数 Active Pool；本版本不负责初始建池。
- `CATALOG_BASELINE_INCONSISTENT`：Active Pool 与该 Category 的完整 membership scope 不一致；停止并审计。
- `CATEGORY_PROFILE_NOT_FOUND` / `CATEGORY_PROFILE_VERSION_MISMATCH`：刷新 Profile 列表并重新选择。
- `CATALOG_TARGET_INVALID`：新增数量无效或计算后的 target 超出 Profile 上限。
- `CAMPAIGN_NAME_CONFLICT`：更换任务名；不要复用同名旧 Campaign。
- `OPERATOR_CREATE_IDEMPOTENCY_CONFLICT`：同一 request ID 的字段发生变化；停止并刷新表单。
- `CATALOG_RPA_CLAIM_CONFLICT` / `CATALOG_RPA_CONTEXT_AMBIGUOUS`：停止操作并检查现有队列，不做自动修复。

## 禁止事项

不要用该页面恢复 paused 1208/2000 Campaign，不要在生产 SQLite 上运行测试，不要通过清队列或取消旧 Campaign 来绕过冲突，也不要把 localhost 的“验证当前页面”误当成扩展里的 Manual Bind “检测当前页面”。
