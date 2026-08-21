@echo off
chcp 65001 >nul
cd /d "%~dp0\..\.."
echo 开发兜底：从 v2 SQLite 重新生成运营 Excel。
call npm.cmd run export
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo 导出失败，请保留窗口信息。
pause
exit /b 1
