# Temu 自动化选品系统 v2 架构基线

## Day 1 状态

Day 1 只建立可恢复的重构地基，不改变现有 Playwright 采集行为。旧的 `src/crawler.mjs`、`src/database.mjs`、运营台和导表工具暂时保留；它们在后续日期按验收门逐步替换，避免一次性切换导致无法定位回归。

## 模块边界

```text
config.json（忽略提交）
  └─ src/config：默认值、加载、路径解析、字段验证
       ├─ src/shared：错误、ID、脱敏 JSONL 日志
       └─ src/db：SQLite 客户端、事务迁移器
            └─ db/migrations：只追加、带 SHA-256 校验的数据库版本

旧 temu_week1.db（只读） ── scripts/import-v1-data.mjs ──> temu_research_v2.db
config + 旧 DB ─────────── scripts/backup-local-data.mjs ──> backups/
```

## 数据身份和历史

- `products.goods_id` 是商品主身份并具有唯一约束，完整 URL 只作为来源与快照证据。
- `catalog_memberships` 表示商品在某次任务、类目和排序中的成员关系。
- `product_snapshots` 保存该次任务看到的价格、销量、评分等可变值。
- `crawl_jobs` / `crawl_events` 保存任务状态和事件；质量检查、错误和基础分类使用独立表。
- `v_current_products` 只提供每个商品最新成员关系和最新快照的读取视图，不覆盖历史。

## 迁移和恢复规则

- 迁移按文件名排序，逐个在 `BEGIN IMMEDIATE` 事务内执行。
- 已执行迁移记录 SHA-256；文件内容发生变化时立即失败，禁止静默改历史。
- v2 数据库是新文件，Day 1 不对旧库执行 `ALTER`、`DROP` 或写操作。
- 旧库导入前后计算文件哈希；哈希变化即失败。导入任务 ID 基于旧库哈希生成，可重复运行。
- 浏览器 profile 永远不进入备份脚本；数据库、profile、配置、输出、缓存、日志和备份均被 Git 忽略。

## 当前非目标

Day 1 不实现新的商品采集、Excel 导出、分类算法或 100/300/1000 稳定性跑数，也不实现 1688、AI 评论、自动上架、RAG、供应商聊天 Agent。
