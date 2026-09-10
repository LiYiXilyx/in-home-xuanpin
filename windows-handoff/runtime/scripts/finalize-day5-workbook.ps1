param(
  [Parameter(Mandatory=$true)][string]$WorkbookPath,
  [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
$resolved=[System.IO.Path]::GetFullPath($WorkbookPath)
if (-not (Test-Path -LiteralPath $resolved)) { throw "Workbook does not exist: $resolved" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Read-ZipEntry([string]$archivePath,[string]$entryName) {
  $archive=[System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $entry=$archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $entryName } | Select-Object -First 1
    if ($null -eq $entry) { throw "Missing workbook entry: $entryName" }
    $reader=[System.IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
}

if ($CheckOnly) {
  $sheetXml=Read-ZipEntry $resolved 'xl/worksheets/sheet1.xml'
  $workbookXml=Read-ZipEntry $resolved 'xl/workbook.xml'
  [ordered]@{
    frozenHeader=[bool]($sheetXml -match '<x:pane[^>]*ySplit="1"[^>]*state="frozen"')
    fullCalculation=[bool]($workbookXml -match '<x:calcPr[^>]*fullCalcOnLoad="1"[^>]*forceFullCalc="1"')
  } | ConvertTo-Json -Compress
  exit 0
}

$archive=[System.IO.Compression.ZipFile]::Open($resolved,[System.IO.Compression.ZipArchiveMode]::Update)
try {
  $sheetEntry=$archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'xl/worksheets/sheet1.xml' } | Select-Object -First 1
  $workbookEntry=$archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'xl/workbook.xml' } | Select-Object -First 1
  if ($null -eq $sheetEntry -or $null -eq $workbookEntry) { throw 'Workbook XML entries are missing.' }
  $sheetReader=[System.IO.StreamReader]::new($sheetEntry.Open())
  try { $sheetXml=$sheetReader.ReadToEnd() } finally { $sheetReader.Dispose() }
  $workbookReader=[System.IO.StreamReader]::new($workbookEntry.Open())
  try { $workbookXml=$workbookReader.ReadToEnd() } finally { $workbookReader.Dispose() }
  if ($sheetXml -notmatch '<x:pane[^>]*state="frozen"') {
    if ($sheetXml -match '<x:sheetView[^>]*/>') {
      $sheetXml=[regex]::Replace($sheetXml,'<x:sheetView([^>]*)\s*/>','<x:sheetView$1><x:pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" /><x:selection pane="bottomLeft" activeCell="A2" sqref="A2" /></x:sheetView>',1)
    } else {
      $sheetXml=$sheetXml.Replace('</x:sheetView>','<x:pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" /><x:selection pane="bottomLeft" activeCell="A2" sqref="A2" /></x:sheetView>')
    }
  }
  $workbookXml=[regex]::Replace($workbookXml,'<x:calcPr[^>]*/>','')
  $workbookXml=$workbookXml.Replace('</x:workbook>','<x:calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" /></x:workbook>')
  $sheetEntry.Delete()
  $newSheetEntry=$archive.CreateEntry('xl/worksheets/sheet1.xml',[System.IO.Compression.CompressionLevel]::Optimal)
  $sheetWriter=[System.IO.StreamWriter]::new($newSheetEntry.Open(),[System.Text.UTF8Encoding]::new($false))
  try { $sheetWriter.Write($sheetXml) } finally { $sheetWriter.Dispose() }
  $workbookEntry.Delete()
  $newWorkbookEntry=$archive.CreateEntry('xl/workbook.xml',[System.IO.Compression.CompressionLevel]::Optimal)
  $workbookWriter=[System.IO.StreamWriter]::new($newWorkbookEntry.Open(),[System.Text.UTF8Encoding]::new($false))
  try { $workbookWriter.Write($workbookXml) } finally { $workbookWriter.Dispose() }
} finally { $archive.Dispose() }
