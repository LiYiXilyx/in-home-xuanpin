# 影刀 RPA + 1688 官方采购助手 V1

本流程只测试 `yingdao-input.xlsx` 中的 3 个商品。不要增加到 20 个或处理全部 2,135 个 Active Pool 商品。

## 影刀流程搭建

1. Excel「读取工作表」：打开 `outputs/1688-sourcing-v1/yingdao-input.xlsx`，工作表选择「任务」，逐行读取 `temu_goods_id`、`temu_title`、`temu_image_path` 与 `status`；只处理 `PENDING`。
2. 浏览器「连接已打开的 Chrome」：连接用户真实 Chrome，不新建无登录状态的隐身浏览器；人工确认 1688 官方采购助手扩展已安装且可见。
3. 安全门：检测到登录、短信、滑块、图片验证码、安全验证或账号确认时，把当前任务状态写为 `WAITING_FOR_HUMAN`，暂停流程，等待用户手工完成后从当前商品继续。禁止识别、绕过或读取 Cookie/Token。
4. 打开采购助手：用可拾取元素打开「1688 官方采购助手」并进入「找同款/以图搜款」。
5. 上传图片：从当前行取得 `temu_image_path`，使用文件上传元素上传；不要复制上一行路径。上传后把当前 goods_id 和页面上显示的预览图人工对照一次。
6. 触发搜索并等待：点击找同款，等待结果区出现、明确无结果或超时。不要调用隐藏接口。
7. Level A 采集：如果候选卡元素可拾取，循环前 5 张卡片，读取商品 ID、标题、价格、MOQ、店铺、商品 URL、图片 URL；`candidate_rank` 按界面顺序写 1–5。
8. Level B 采集：如果卡片不可拾取，依次尝试官方界面的复制、导出或「打开商品页」，从可访问页面记录同样字段。
9. Level C 安全降级：如果仍不能可靠取得候选，写 `search_status=MANUAL_CAPTURE_REQUIRED`，不要用固定坐标猜标题、价格、链接或图片。
10. 写输出：打开 `outputs/1688-sourcing-v1/yingdao-output.xlsx` 的「1688候选」。按相同 `run_id + temu_goods_id + candidate_rank` 填入候选；成功候选写 `SEARCH_SUCCESS`、真实 `captured_at` 和人工复核标记。没有使用的预留行保持 `PENDING`。
11. 下一商品：关闭或清空当前搜索结果，回到输入循环；再次从当前 Excel 行取 goods_id 和图片路径，避免沿用上一商品。
12. 人工复核后导入：先运行 `node scripts/1688/import-yingdao-results.mjs --dry-run`，确认通过后再去掉 `--dry-run`。SQLite 是最终权威来源；相同 `run_id` 不允许再次写入。

V1 图片相似度尚未实现，因此导入后 `image_similarity=NULL`、`image_similarity_status=NOT_IMPLEMENTED`、`overall_similarity=NULL`，并强制进入人工确认。第一名候选不会自动成为最终供应商。
