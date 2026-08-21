@echo off
chcp 65001 >nul
cd /d "%~dp0\..\.."
echo 开发兜底：重试评论失败项并导出 Excel。
call npm.cmd run reviews:retry
if errorlevel 1 goto failed
call npm.cmd run export
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo 执行失败，请保留窗口信息。
pause
exit /b 1
