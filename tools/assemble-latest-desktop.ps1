$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = [IO.Path]::GetFullPath((Join-Path $root 'release'))
$target = [IO.Path]::GetFullPath((Join-Path $release '00-旅策协同-当前最新版'))
$stage = [IO.Path]::GetFullPath((Join-Path $root '.development/desktop-demo-x'))
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Assert-ChildPath([string]$candidate, [string]$parent, [string]$label) {
    $resolvedParent = [IO.Path]::GetFullPath($parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $resolvedCandidate = [IO.Path]::GetFullPath($candidate)
    if (-not $resolvedCandidate.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$label escaped its intended parent directory."
    }
}

function Get-Sha256([string]$file) {
    $stream = [IO.File]::OpenRead($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

Assert-ChildPath $target $release 'Latest folder'
Assert-ChildPath $stage (Join-Path $root '.development') 'Staging folder'
if ([IO.Path]::GetFileName($target) -ne '00-旅策协同-当前最新版') { throw 'Unexpected latest folder name.' }
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler unavailable.' }

& (Get-Command npm).Source run build
if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
& (Get-Command npm).Source run build:desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }

$required = @(
    'runtime/旅策协同.exe',
    'runtime/bin/node.exe',
    'runtime/bin/travel-window-host.exe',
    'runtime/plugins/travel-tools/openclaw.plugin.json',
    'runtime/plugins/travel-tools/index.js',
    'launcher.cjs',
    'dist/index-v4.js',
    'assets/travel.ico',
    'platform/openclaw-travel-tools.cjs',
    'tourism/tool-broker.cjs'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) { throw "Missing latest desktop file: $relative" }
}

$privateRuntime = @(Get-ChildItem -LiteralPath (Join-Path $root 'runtime') -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($root.Length + 1).Replace('\','/')
    $relative -match '(^|/)(?:logs|browser-profile|user-data|build-input)/' -or
    $_.Name -match '^(?:\.env(?:\..*)?|auth\.json|auth-profiles\.json|credentials\.json|Cookies|History)$' -or
    $_.Extension -eq '.log'
})
if ($privateRuntime.Count -gt 0) { throw "Private runtime file detected: $($privateRuntime[0].FullName)" }

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
[IO.Directory]::CreateDirectory($stage) | Out-Null
$runtimeTarget = Join-Path $stage 'runtime'
& robocopy (Join-Path $root 'runtime') $runtimeTarget /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "Runtime copy failed with robocopy exit code $LASTEXITCODE." }

foreach ($relative in @('launcher.cjs','README.md','THIRD_PARTY_NOTICES.md','package.json')) {
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $stage $relative)
}
foreach ($relative in @('dist/index-v4.js','assets/travel.ico','assets/travel-symbol.svg','assets/travel-wordmark.svg','assets/travel-icon.png')) {
    $destination = Join-Path $stage $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $destination
}
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $root 'platform') -File -Filter '*.cjs')) {
    $destination = Join-Path $stage "platform/$($file.Name)"
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
}
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $root 'tourism') -File -Recurse | Where-Object { @('.js','.cjs','.json','.html') -contains $_.Extension.ToLowerInvariant() })) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\','/')
    if ($relative -match '^tourism/(?:validation|evaluation|training|defense)/') { continue }
    $destination = Join-Path $stage $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
}

& (Get-Command node).Source (Join-Path $root 'tools/isolate-desktop-package.cjs') $stage
if ($LASTEXITCODE -ne 0) { throw 'Review profile isolation failed.' }

$launcherExe = Join-Path $stage 'TravelAI.exe'
$outArg = '/out:' + $launcherExe
$iconArg = '/win32icon:' + (Join-Path $root 'assets/travel.ico')
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 $outArg $iconArg /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $root 'tools/desktop-one-click-launcher.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcherExe)) { throw 'One-click desktop launcher compilation failed.' }

$vbs = @'
Option Explicit
Dim shell, fso, root, launcher
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(root, "TravelAI.exe")
If Not fso.FileExists(launcher) Then
  MsgBox "TravelAI.exe is missing. Please extract or copy the complete folder again.", 16, "Travel.AI"
  WScript.Quit 1
End If
shell.CurrentDirectory = root
shell.Run Chr(34) & launcher & Chr(34), 1, False
'@
[IO.File]::WriteAllText((Join-Path $stage '启动旅策协同.vbs'), $vbs, [Text.Encoding]::Unicode)

$guide = @(
    '旅策协同 · 当前最新版',
    ('整理时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
    '',
    '启动方法',
    '1. 保持本文件夹结构完整，不要单独移动内部文件。',
    '2. 双击“启动旅策协同.vbs”。',
    '3. 首次启动或冷启动通常需要几十秒，请等待主界面出现。',
    '4. 请在“模型设置”中填写使用者自己的模型服务；交付文件不含任何预置模型 Key。',
    '5. 高德与联网搜索在“基础工具与联网服务”中配置；交付文件不含开发者的高德 Key 或搜索凭据。',
    '',
    '关闭方法',
    '请从应用托盘菜单选择“退出”；仅关闭窗口可能缩小到托盘。',
    '',
    '安全说明',
    '本目录不包含用户配置、API Key、Cookie、浏览器 Profile、运行日志或 build-input/authorized-runtime.bin。',
    '所有联网结果仍需人工核实；系统不会自动预订、付款或发布。'
) -join [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $stage '使用说明.txt'), $guide, [Text.UTF8Encoding]::new($true))

$forbidden = @(Get-ChildItem -LiteralPath $stage -File -Recurse -Force | Where-Object {
    $relative = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
    $relative -match '(^|/)(?:build-input|logs|\.development|browser-profile|user-data)/' -or
    $_.Name -match '^(?:tr-ai-assist\.json|tr-ai-review\.json|auth\.json|credentials\.json|Cookies|History|\.env(?:\..*)?)$' -or
    $_.Extension -eq '.log'
})
if ($forbidden.Count -gt 0) { throw "Forbidden file entered latest folder: $($forbidden[0].FullName)" }

$critical = @('TravelAI.exe','启动旅策协同.vbs','launcher.cjs','runtime/旅策协同.exe','runtime/plugins/travel-tools/openclaw.plugin.json','runtime/plugins/travel-tools/index.js')
$artifacts = foreach ($relative in $critical) {
    $file = Join-Path $stage $relative
    if (-not (Test-Path -LiteralPath $file)) { throw "Latest folder is incomplete: $relative" }
    [ordered]@{ path=$relative; bytes=(Get-Item -LiteralPath $file).Length; sha256=(Get-Sha256 $file) }
}
$manifest = [ordered]@{
    product = '旅策协同'
    version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    assembledAt = Get-Date -Format o
    start = '启动旅策协同.vbs'
    modelApiKeyIncluded = $false
    amapApiKeyIncluded = $false
    protectedBuildInputIncluded = $false
    artifacts = $artifacts
}
[IO.File]::WriteAllText((Join-Path $stage '版本清单.json'), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $target) {
    Assert-ChildPath $target $release 'Latest folder'
    Remove-Item -LiteralPath $target -Recurse -Force
}
Move-Item -LiteralPath $stage -Destination $target

$files = Get-ChildItem -LiteralPath $target -File -Recurse
[ordered]@{
    folder = $target
    start = Join-Path $target '启动旅策协同.vbs'
    files = $files.Count
    bytes = ($files | Measure-Object Length -Sum).Sum
    version = $manifest.version
} | ConvertTo-Json -Depth 4
