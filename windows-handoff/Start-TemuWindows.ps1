param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$base=Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $base 'environment.ps1')
$node=(Get-Command node.exe -ErrorAction Stop).Source
$log=Join-Path $base 'state\launcher-logs'
New-Item -ItemType Directory -Path $log -Force | Out-Null
function Ready($url){try{ $null=Invoke-RestMethod $url -TimeoutSec 3;return $true }catch{return $false}}
$mutex=New-Object System.Threading.Mutex($false,'Local\TemuWindowsOperatorLauncher')
if(-not $mutex.WaitOne(0)){throw '启动器已在运行，请稍候'}
try{
 foreach($service in @(@{port=37821;url='http://127.0.0.1:37821/api/health';file=(Join-Path $base 'runtime\src\server\index.mjs');cwd=(Join-Path $base 'runtime');name='dashboard'},@{port=37822;url='http://127.0.0.1:37822/auto/status';file=(Join-Path $base 'integration\search-pilot\server.mjs');cwd=(Join-Path $base 'integration\search-pilot');name='search-pilot'})){
  if(Ready $service.url){continue}
  if(Get-NetTCPConnection -LocalPort $service.port -State Listen -ErrorAction SilentlyContinue){throw "端口 $($service.port) 已占用且服务检查失败，请查看日志。"}
  Start-Process $node -ArgumentList ('"'+$service.file+'"') -WorkingDirectory $service.cwd -WindowStyle Hidden -RedirectStandardOutput (Join-Path $log ($service.name+'.out.log')) -RedirectStandardError (Join-Path $log ($service.name+'.err.log')) | Out-Null
  $ok=$false
  for($i=0;$i -lt 30;$i++){if(Ready $service.url){$ok=$true;break};Start-Sleep -Milliseconds 500}
  if(-not $ok){throw "服务 $($service.name) 启动失败，日志目录：$log"}
 }
 '运营台和截图服务已就绪；未启动采集或绑定浏览器。'
 if(-not $NoOpen){Start-Process 'http://127.0.0.1:37821/'}
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
