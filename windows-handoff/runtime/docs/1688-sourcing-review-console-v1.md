# 1688 Sourcing Review Console V1 运营入口

1. 双击项目目录下的 `启动Temu运营台.command`（macOS），或 `启动Temu运营台.vbs`（Windows）。
2. 访问 `http://127.0.0.1:37821/`，在“影刀 Random5 导入”区域点击“1688候选人工复核”。
3. Review Console V1 固定显示 run `yingdao_random5_v1_20260831_001`；不会因后续新 run 自动切换。
4. 筛选、上一个/下一个和打开1688链接为读取操作。设为/取消最终候选、排除/恢复和人工备注只写入 `data/1688_sourcing.db`。
5. 页面不会写回 Sheet05，不会重新 Random5，不会重新下载已成功的图片。

页面直接地址：`http://127.0.0.1:37821/sourcing-review.html`
