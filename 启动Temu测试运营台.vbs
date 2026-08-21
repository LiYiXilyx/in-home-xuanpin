Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectDir
If Not fso.FolderExists(fso.BuildPath(projectDir, "logs")) Then fso.CreateFolder(fso.BuildPath(projectDir, "logs"))

Set processEnvironment = shell.Environment("PROCESS")
processEnvironment("TEMU_CONFIG_PATH") = fso.BuildPath(projectDir, "config.test.json")
processEnvironment("TEMU_DASHBOARD_PORT") = "37822"

ready = TestDashboardReady()
If Not ready Then
  shell.Run "cmd.exe /d /s /c ""node.exe src/server/index.mjs >> logs\test-dashboard.log 2>&1""", 0, False
End If

For attempt = 1 To 40
  If ready Then Exit For
  WScript.Sleep 500
  ready = TestDashboardReady()
Next

If ready Then
  shell.Run "http://127.0.0.1:37822", 1, False
Else
  MsgBox "Temu Test Console did not start. Check logs\test-dashboard.log.", 16, "Temu Test Console"
End If

Function TestDashboardReady()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "GET", "http://127.0.0.1:37822/api/health", False
  request.Send
  TestDashboardReady = (Err.Number = 0 And request.Status = 200 And InStr(request.responseText, """testMode"":true") > 0)
  Err.Clear
  On Error GoTo 0
End Function
