$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$shellObject = New-Object -ComObject WScript.Shell
$brandName = -join ([char[]](0x65C5,0x7B56,0x534F,0x540C))
$agentName = $brandName + (-join ([char[]](0x6587,0x65C5))) + 'Agent.vbs'
$link = $shellObject.CreateShortcut((Join-Path $projectRoot ($brandName + '.lnk')))
$link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$link.Arguments = '"' + (Join-Path $projectRoot $agentName) + '"'
$link.WorkingDirectory = $projectRoot
$link.IconLocation = (Join-Path $projectRoot 'assets\travel.ico') + ',0'
$link.Description = $brandName
$link.Save()
Write-Output ('Created ' + $brandName + '.lnk in this project. Re-run after moving the portable folder.')
