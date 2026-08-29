[CmdletBinding()]
param(
  [string]$StartUrl = 'about:blank',
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ChromeExecutable = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$UserDataDir = 'C:\Users\Administrator\AppData\Local\Google\Chrome\User Data'
$ProfileDirectory = 'Profile 10'
$ProfileName = 'Temu1' + [char]0x5E97
$CaptureMode = 'MANUAL_NAVIGATION_PASSIVE_CAPTURE'
$LocalServerEndpoint = 'http://127.0.0.1:37821'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$SessionFile = Join-Path $RepositoryRoot 'runtime\temu-controlled-chrome-session.json'

function Test-LocalServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$LocalServerEndpoint/api/catalog-rpa/current-context" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-FixedSessionMarker {
  if (-not (Test-Path -LiteralPath $SessionFile -PathType Leaf)) { return $false }
  try {
    $marker = Get-Content -Raw -LiteralPath $SessionFile | ConvertFrom-Json
    $markerProcess = Get-Process -Id ([int]$marker.process_id) -ErrorAction Stop
    return (
      $markerProcess.Path -eq $ChromeExecutable -and
      $marker.capture_mode -eq $CaptureMode -and
      $marker.cdp_required -eq $false -and
      $marker.extension_passive_required -eq $true -and
      $marker.local_server_endpoint -eq $LocalServerEndpoint -and
      $marker.user_data_dir -eq $UserDataDir -and
      $marker.profile_directory -eq $ProfileDirectory
    )
  } catch { return $false }
}

if (-not (Test-Path -LiteralPath $ChromeExecutable -PathType Leaf)) { throw "FIXED_CHROME_EXECUTABLE_NOT_FOUND: $ChromeExecutable" }
if (-not (Test-Path -LiteralPath $UserDataDir -PathType Container)) { throw "FIXED_USER_DATA_DIR_NOT_FOUND: $UserDataDir" }
if (-not (Test-Path -LiteralPath (Join-Path $UserDataDir $ProfileDirectory) -PathType Container)) { throw "FIXED_PROFILE_DIRECTORY_NOT_FOUND: $ProfileDirectory" }

$launchArguments = @(
  "--user-data-dir=`"$UserDataDir`""
  "--profile-directory=`"$ProfileDirectory`""
  '--lang=en-DE'
  '--no-first-run'
  '--no-default-browser-check'
  '--new-window'
  "`"$StartUrl`""
)

if ($DryRun) {
  [pscustomobject]@{
    status = 'DRY_RUN'; profile_name = $ProfileName; chrome_executable = $ChromeExecutable
    user_data_dir = $UserDataDir; profile_directory = $ProfileDirectory; capture_mode = $CaptureMode
    cdp_required = $false; extension_passive_required = $true; local_server_endpoint = $LocalServerEndpoint
    session_file = $SessionFile; command = '"{0}" {1}' -f $ChromeExecutable, ($launchArguments -join ' ')
  } | ConvertTo-Json -Depth 3
  exit 0
}

if (-not (Test-LocalServer)) {
  [pscustomobject]@{ status = 'MANUAL_REQUIRED'; reason = 'LOCAL_EXTENSION_SERVER_UNAVAILABLE'; local_server_endpoint = $LocalServerEndpoint
    message = 'Start the localhost extension server before opening the fixed Temu profile.' } | ConvertTo-Json -Depth 3
  exit 5
}

$runningChrome = @(Get-Process -Name chrome -ErrorAction SilentlyContinue)
if ($runningChrome.Count -gt 0) {
  if (Test-FixedSessionMarker) {
    [pscustomobject]@{ status = 'ALREADY_RUNNING'; profile_name = $ProfileName; profile_directory = $ProfileDirectory
      capture_mode = $CaptureMode; cdp_required = $false; extension_passive_required = $true; local_server_endpoint = $LocalServerEndpoint
      message = 'The fixed Temu extension-passive profile is already running; no additional Chrome was started.' } | ConvertTo-Json -Depth 3
    exit 0
  }
  [pscustomobject]@{ status = 'MANUAL_REQUIRED'; reason = 'UNVERIFIED_CHROME_ALREADY_RUNNING'; profile_name = $ProfileName
    profile_directory = $ProfileDirectory; message = 'Close every Chrome window manually, then run the fixed launcher again. No fallback profile was started.' } | ConvertTo-Json -Depth 3
  exit 2
}

$process = Start-Process -FilePath $ChromeExecutable -ArgumentList $launchArguments -PassThru
Start-Sleep -Milliseconds 1200
if ($process.HasExited -and @(Get-Process -Name chrome -ErrorAction SilentlyContinue).Count -eq 0) { throw 'FIXED_PROFILE_START_FAILED' }

$browserProcess = if (-not $process.HasExited) { $process } else { Get-Process -Name chrome -ErrorAction Stop | Sort-Object StartTime | Select-Object -First 1 }
$sessionDirectory = Split-Path -Parent $SessionFile
New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null
[pscustomobject]@{
  schema_version = 2; process_id = $browserProcess.Id; started_at = (Get-Date).ToUniversalTime().ToString('o')
  chrome_executable = $ChromeExecutable; user_data_dir = $UserDataDir; profile_directory = $ProfileDirectory; profile_name = $ProfileName
  capture_mode = $CaptureMode; cdp_required = $false; extension_passive_required = $true; local_server_endpoint = $LocalServerEndpoint
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $SessionFile -Encoding utf8

[pscustomobject]@{
  status = 'STARTED'; process_id = $browserProcess.Id; profile_name = $ProfileName; chrome_executable = $ChromeExecutable
  user_data_dir = $UserDataDir; profile_directory = $ProfileDirectory; capture_mode = $CaptureMode
  cdp_required = $false; extension_passive_required = $true; local_server_endpoint = $LocalServerEndpoint
  session_file = $SessionFile; message = 'The fixed Temu operating profile is ready for manual navigation and extension passive capture.'
} | ConvertTo-Json -Depth 3
