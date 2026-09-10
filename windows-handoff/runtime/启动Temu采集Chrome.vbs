Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
cdpVersionUrl = "http://127.0.0.1:9222/json/version"

If BrowserReady() Then
  MsgBox "Temu External Chrome is already running on CDP 9222.", 64, "Temu External Chrome"
  WScript.Quit 0
End If

chromePath = FindChrome()
If chromePath = "" Then
  MsgBox "Google Chrome was not found. Please install Chrome and try again.", 16, "Temu External Chrome"
  WScript.Quit 1
End If

chromeCommand = """" & chromePath & """ --remote-debugging-port=9222 --user-data-dir=""C:\TemuExternalChrome"""
shell.Run chromeCommand, 1, False

Function FindChrome()
  candidates = Array( _
    "C:\Program Files\Google\Chrome\Application\chrome.exe", _
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", _
    shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe") _
  )
  FindChrome = ""
  For Each candidate In candidates
    If fso.FileExists(candidate) Then
      FindChrome = candidate
      Exit Function
    End If
  Next
End Function

Function BrowserReady()
  On Error Resume Next
  Set request = CreateObject("MSXML2.XMLHTTP")
  request.Open "GET", cdpVersionUrl, False
  request.Send
  BrowserReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function
