Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
cdpPort = "9223"
cdpVersionUrl = "http://127.0.0.1:" & cdpPort & "/json/version"
operatorProfile = fso.BuildPath(projectDir, "browser-profile-operator-chrome")

If BrowserReady() Then
  MsgBox "Temu Operator Chrome is already running on CDP " & cdpPort & ".", 64, "Temu Operator Chrome"
  WScript.Quit 0
End If

chromePath = FindChrome()
If chromePath = "" Then
  MsgBox "Google Chrome was not found. Please install Chrome and try again.", 16, "Temu Operator Chrome"
  WScript.Quit 1
End If

' This profile is intentionally separate from daily Chrome and never copied from another profile.
' It opens a neutral page only; the operator navigates Temu and completes login or CAPTCHA manually.
quote = Chr(34)
chromeCommand = quote & chromePath & quote & " --remote-debugging-port=" & cdpPort & " --remote-debugging-address=127.0.0.1 --user-data-dir=" & quote & operatorProfile & quote & " --lang=en-DE --no-first-run --no-default-browser-check --new-window about:blank"
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
