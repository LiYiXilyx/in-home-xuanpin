param([string]$Python='python')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
& $Python -m venv (Join-Path $root '.venv')
if($LASTEXITCODE -ne 0){throw 'Python环境创建失败'}
& (Join-Path $root '.venv\Scripts\python.exe') -m pip install -r (Join-Path $root 'requirements-lock.txt')
if($LASTEXITCODE -ne 0){throw '依赖安装失败，请检查网络及Python版本'}
& (Join-Path $root '.venv\Scripts\python.exe') -c 'import pyautogui,cv2,PIL; print("Dependencies OK")'
if($LASTEXITCODE -ne 0){throw '依赖校验失败'}