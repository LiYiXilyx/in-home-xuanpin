@echo off
chcp 65001 >nul
cd /d "%~dp0\..\.."
echo 开发兜底：抓取下一批评论并导出 Excel。
call npm.cmd run reviews
if errorlevel 1 goto failed
call npm.cmd run export
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo 执行失败，请保留窗口信息。
pause
exit /b 1
