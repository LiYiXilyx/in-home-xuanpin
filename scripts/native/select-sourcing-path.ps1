param(
  [Parameter(Mandatory=$true)][ValidateSet('RAW_DIRECTORY','IMAGE_CACHE_DIRECTORY','ANALYSIS_WORKBOOK')][string]$Kind,
  [string]$CurrentPath=''
)
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=$utf8
$OutputEncoding=$utf8
Add-Type -AssemblyName System.Windows.Forms
if ($Kind -eq 'ANALYSIS_WORKBOOK') {
  $dialog=New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title='选择现有分析工作簿'
  $dialog.Filter='Excel 工作簿 (*.xlsx)|*.xlsx'
  $dialog.CheckFileExists=$true
  $dialog.CheckPathExists=$true
  if ($CurrentPath) { $dialog.FileName=$CurrentPath }
} else {
  $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description=if ($Kind -eq 'RAW_DIRECTORY') {'选择1688原始导出目录'} else {'选择1688图片缓存目录'}
  $dialog.ShowNewFolderButton=$true
  if ($CurrentPath -and (Test-Path -LiteralPath $CurrentPath -PathType Container)) { $dialog.SelectedPath=$CurrentPath }
}
$result=$dialog.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
if ($Kind -eq 'ANALYSIS_WORKBOOK') { [Console]::Out.WriteLine($dialog.FileName) } else { [Console]::Out.WriteLine($dialog.SelectedPath) }
