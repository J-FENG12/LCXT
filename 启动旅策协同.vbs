Option Explicit
Dim shell, fso, root, nodePath, launcherPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(root, "runtime\bin\node.exe")
launcherPath = fso.BuildPath(root, "launcher.cjs")

If Not fso.FileExists(nodePath) Or Not fso.FileExists(launcherPath) Then
  MsgBox "Required startup files are missing. Keep the LCXT_V2 folder intact.", 16, "Travel.AI"
  WScript.Quit 1
End If

shell.CurrentDirectory = root
shell.Environment("PROCESS")("TRAVEL_SUBMISSION_MODE") = "0"
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34)
shell.Run command, 0, False
