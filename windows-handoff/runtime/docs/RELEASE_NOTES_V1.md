# Temu 选品运营台 V1 Release Notes

发布日期：2026-08-21
状态：Release Candidate / Partial Pass

## 已交付

- v2 SQLite 是唯一正式数据源，支持迁移校验、备份和历史保留。
- 商品以 `platform + goods_id` 稳定去重；URL、标题或排名变化不创建新商品。
- 类目成员关系、任务快照、图片、质量检查、任务项和事件日志分离存储。
- 当前商品池采用安全事务切换；低数量、空页面或质量失败不覆盖旧池。
- 独立 Chrome/CDP、页面健康检查、人工登录与验证码关卡。
- Dashboard 支持开始、暂停、继续、取消、失败重试、导出和故障恢复。
- Excel 包含 300 个当前商品、300 张本地图、完整可点击 URL、质量、任务和字段说明，并保护人工备注。
- 初步规则分类包含 10 个分类，可解释、可版本化，低置信度进入人工复核。

## Day 7 分类版本

- taxonomy：`week1-motorcycle-accessories`
- rule_version：`week1-rule-v1`
- 规则配置：`config/category-rules.example.json`
- 当前已分类：300/300
- 当前需人工复核：165/300

## 已知限制

- 独立 Chrome fresh profile 当前仍返回 `SEARCH_NO_RESULTS`，真实约 1000 条任务未运行。
- 历史 300 商品没有原始 `source_url`，Excel 按设计回退到 `canonical_url`；新采集会保存真实列表 href。
- 页面国家检测当前显示 `UNKNOWN`，即使语言和币种可识别；开始任务仍要求完整 `READY`。
- 旧评论/开发工具仍引用兼容单体，暂未删除。

## 安全说明

- 不绕过验证码、登录或访问控制。
- 不复制日常 Chrome profile。
- 不自动猜测类目或 Top Sales。
- 不使用历史数据或假数据补足约 1000 条。
- 不删除旧数据库、历史快照、inactive membership 或浏览器 profile。

## 后续放行

真实列表恢复并通过页面健康门后，执行约 1000 条基础商品任务、来源贡献统计、最终分类和 Excel QA，V1 才可从 Partial Pass 升级为正式 Pass。
