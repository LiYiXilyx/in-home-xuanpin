Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
dashboardUrl = "http://127.0.0.1:37821"
cdpVersionUrl = "http://127.0.0.1:9222/json/version"
shell.CurrentDirectory = projectDir
If Not fso.FolderExists(fso.BuildPath(projectDir, "logs")) Then fso.CreateFolder(fso.BuildPath(projectDir, "logs"))

isDashboardReady = DashboardReady()
If Not isDashboardReady Then
  shell.Run "cmd.exe /d /s /c ""node.exe src/server/index.mjs >> logs\dashboard.log 2>&1""", 0, False
End If

For attempt = 1 To 30
  If isDashboardReady Then Exit For
  WScript.Sleep 500
  isDashboardReady = DashboardReady()
Next

If isDashboardReady Then
  If BrowserReady() Then connected = ConnectBrowser()
  shell.Run dashboardUrl, 1, False
Else
  MsgBox "Temu Operations Console did not start. Check logs\dashboard.log.", 16, "Temu Operations Console"
End If

Function BrowserReady()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "GET", cdpVersionUrl, False
  request.Send
  BrowserReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

Function DashboardReady()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "GET", dashboardUrl & "/api/health", False
  request.Send
  DashboardReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

Function ConnectBrowser()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "POST", dashboardUrl & "/api/browser/connect", False
  request.setRequestHeader "Content-Type", "application/json"
  request.Send "{}"
  ConnectBrowser = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function
