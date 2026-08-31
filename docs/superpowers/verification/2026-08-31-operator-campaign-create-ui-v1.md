# Operator Campaign Create UI V1 Verification

日期：2026-08-31

分支：`codex/multi-category-safety-v1`

Worktree：`/private/tmp/temu-multi-category-safety-v1`

## Scope

- 所有写测试使用 temporary SQLite 和 temporary Profile fixtures。
- 未写生产数据库，未启动真实 Temu 采集，未 push。
- 保留 `platform + goods_id` product identity、category-scoped membership、explicit Campaign 和 Manual Bind Gate。
- YingDao Export V1 不在本次实现范围。

## Verification Results

### NEW_FEATURE_TESTS

命令覆盖 Category Profile Registry、Operator service/API/UI、CLI、Manual Bind 与 server binding gate。

```text
tests = 30
pass = 30
fail = 0
NEW_FEATURE_TESTS = PASS
```

### RELATED_REGRESSION_TESTS

命令覆盖 Catalog API/Campaign/RPA/Expansion/Refresh/Resume、Multi-Category isolation、Profile/scope/selection 与 extension。

```text
tests = 34
pass = 34
fail = 0
RELATED_REGRESSION_TESTS = PASS
```

### Static Verification

```text
npm run check = PASS
npm run check:opportunity = PASS
git diff --check = PASS
forbidden global membership mutation / latest Campaign scan = 0 matches
```

扫描范围：`src tools ui browser-extension`。

### FULL_SUITE

```text
tests = 304
pass = 297
fail = 7
cancelled = 0
skipped = 0
KNOWN_BASELINE_FAILURES = exactly 7
NEW_FAILURES = 0
```

失败身份逐项核对：

1. `test/integration/server-jobs.test.mjs` — `clear Excel requires confirmation and archives the workbook without touching SQLite` — HTTP assertion `400 !== 200`。
2. `test/integration/server-jobs.test.mjs` — `test mode reset clears only isolated test data and creates an empty workbook` — HTTP assertion `400 !== 200`。
3. `test/unit/catalog-parser.test.mjs` — `image cache validates HTTP, MIME, signature and minimum bytes without blocking failures` — actual `IMAGE_INVALID_CONTENT`，expected `IMAGE_SIGNATURE_INVALID`。
4. `test/unit/image-cache.test.mjs` — `invalid content-type is rejected` — actual `IMAGE_INVALID_CONTENT`，expected `IMAGE_MIME_INVALID`。
5. `test/unit/image-cache.test.mjs` — `missing content-type is rejected for a network response` — actual `IMAGE_INVALID_CONTENT`，expected `IMAGE_MIME_INVALID`。
6. `test/unit/image-cache.test.mjs` — `too-small image is rejected` — actual `IMAGE_INVALID_CONTENT`，expected `IMAGE_TOO_SMALL`。
7. `test/unit/image-cache.test.mjs` — `existing valid cache is reused without a network request` — actual `failed`，expected `completed`。

该集合与批准的 2 个 Excel cleanup/reset 失败和 5 个 image-cache 错误码/缓存断言失败完全一致。本次没有修改这些模块，也没有顺手修复基线问题。

### Safety Evidence

- 临时 SQLite 触发器在 source insert 阶段强制失败后，Campaign、baseline、audit、source、queue 和 source run 计数全部回滚。
- active queue conflict 前后数据库 fingerprint 完全一致；构造的 paused `1208/2000` Full Refresh Campaign 字段完全不变。
- 同一 request ID + 同一字段返回相同 Campaign；字段变化 hard fail；不同 request ID 遇到 active queue hard fail。
- API 忽略客户端 `target_count` 和 `profile_path`，只用 Registry 精确 key/version，并由服务器计算 target。
- 未绑定 capture 0 submits / 0 writes；页面上下文变化使 binding 失效；重复人工 capture 使用确定性 batch ID 并幂等。
- UI 创建处理器源码不包含 capture、resume、cancel、scroll、See more 或 legacy job start 调用。
- CLI 普通 create 通过真实子进程和临时 SQLite 验证复用原子服务；显式 resume 仍调用 `validateResumeCampaign()`。

## Acceptance Gates

```text
OPERATOR_CAN_CREATE_WITHOUT_CLI = YES
OPERATOR_NEVER_ENTERS_CAMPAIGN_ID = YES
TARGET_IS_SERVER_CALCULATED = YES
CREATE_AND_CLAIM_IS_ATOMIC = YES
CONFLICT_ZERO_WRITES = YES
NO_IMPLICIT_RESUME = YES
MANUAL_BIND_GATE_PRESERVED = YES
NEW_FEATURE_TESTS = PASS
RELATED_REGRESSION_TESTS = PASS
KNOWN_BASELINE_FAILURES = exactly 7
NEW_FAILURES = 0
SAFE_FOR_SECOND_CATEGORY_10_ROW_DRY_RUN = YES
SAFE_FOR_OPERATOR_MANUAL_CAPTURE = YES
```

## Operational Boundaries

Final Gate 表示代码与隔离 fixture 的安全验证已通过，不表示已经进行真实 Temu capture。首次第二类目 10-row dry run 仍必须使用显式新 Profile、新 Campaign、健康页面检测和人工绑定，并在隔离/受控环境执行。
