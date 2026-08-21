Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectDir
If Not fso.FolderExists(fso.BuildPath(projectDir, "logs")) Then fso.CreateFolder(fso.BuildPath(projectDir, "logs"))

ready = DashboardReady()
If Not ready Then
  shell.Run "cmd.exe /d /s /c ""node.exe src/server/index.mjs >> logs\dashboard.log 2>&1""", 0, False
End If

For attempt = 1 To 30
  If ready Then Exit For
  WScript.Sleep 500
  ready = DashboardReady()
Next

If ready Then
  shell.Run "http://127.0.0.1:37821", 1, False
Else
  MsgBox "Temu Operations Console did not start. Check logs\dashboard.log.", 16, "Temu Operations Console"
End If

Function DashboardReady()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "GET", "http://127.0.0.1:37821/api/health", False
  request.Send
  DashboardReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function
