@echo off
chcp 65001 >nul
cd /d "%~dp0\..\.."
echo 开发兜底：刷新 Top Sales 商品池并导出 Excel。
call npm.cmd run refresh
if errorlevel 1 goto failed
call npm.cmd run export
if errorlevel 1 goto failed
echo 已完成。运营人员请使用根目录“启动Temu运营台.vbs”。
pause
exit /b 0
:failed
echo 执行失败，旧商品池不会被清空。
pause
exit /b 1
