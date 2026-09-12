Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & fso.BuildPath(root, "runtime\bin\node.exe") & Chr(34) & " " & Chr(34) & fso.BuildPath(root, "tourism\agent-server.cjs") & Chr(34)
shell.CurrentDirectory = root
shell.Run command, 0, False
