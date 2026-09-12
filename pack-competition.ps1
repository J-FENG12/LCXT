$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$releaseDir = Join-Path $projectRoot 'release'
[IO.Directory]::CreateDirectory($releaseDir) | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$brand = -join ([char[]](0x65C5,0x7B56,0x534F,0x540C))

& (Get-Command node).Source (Join-Path $projectRoot 'build-app.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Source-only build failed' }
& (Get-Command node).Source (Join-Path $projectRoot 'tools/anonymity-audit.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Anonymity audit failed' }

function Get-TreeFiles([string]$relativeRoot, [string[]]$extensions = @()) {
    $base = Join-Path $projectRoot $relativeRoot
    if (-not (Test-Path -LiteralPath $base)) { return @() }
    @(Get-ChildItem -LiteralPath $base -File -Recurse | Where-Object {
        $rel = $_.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
        $allowed = $extensions.Count -eq 0 -or $extensions -contains $_.Extension.ToLowerInvariant()
        $allowed -and $rel -notmatch '(^|/)(?:validation/(?:desktop-results|native-brand-results|package-audit|brand-audit)\.json|validation/.*\.png)$'
    } | ForEach-Object FullName)
}
function Resolve-Files([string[]]$relativeFiles) {
    @($relativeFiles | ForEach-Object { Join-Path $projectRoot $_ } | Where-Object { Test-Path -LiteralPath $_ })
}
function Assert-Safe([string[]]$selected, [string]$kind) {
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $selected) {
        $full = [IO.Path]::GetFullPath($file)
        if (-not $full.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "$kind file escaped project root" }
        $rel = $full.Substring($projectRoot.Length + 1).Replace('\','/')
        if (-not $seen.Add($rel)) { throw "$kind file list has duplicate: $rel" }
        if ($rel -match '(^|/)(?:build-input|node_modules|\.development|logs|release|browser-profile[^/]*)/' -or $rel -match '(?:\.env|assist\.json|auth\.json|auth-profiles\.json|\.log|\.lnk)$') { throw "$kind contains private/development path: $rel" }
        if ($rel -eq 'runtime/旅策协同.exe') { throw "$kind unexpectedly contains desktop runtime" }
    }
}
function Add-Package([string]$target, [string[]]$selected) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    $archive = [IO.Compression.ZipFile]::Open($target, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in ($selected | Sort-Object)) {
            $entryName = $file.Substring($projectRoot.Length + 1).Replace('\','/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $entryName, [IO.Compression.CompressionLevel]::Fastest) | Out-Null
        }
    } finally { $archive.Dispose() }
}
function Verify-Package([string]$target, [string[]]$selected, [string[]]$required) {
    $zip = [IO.Compression.ZipFile]::OpenRead($target)
    try {
        $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($file in $selected) { [void]$expected.Add($file.Substring($projectRoot.Length + 1).Replace('\','/')) }
        if ($zip.Entries.Count -ne $expected.Count) { throw 'ZIP entry count differs from selected files' }
        foreach ($entry in $zip.Entries) { if (-not $expected.Remove($entry.FullName)) { throw "Unexpected ZIP entry: $($entry.FullName)" } }
        foreach ($name in $required) { if ($null -eq $zip.GetEntry($name)) { throw "Missing ZIP entry: $name" } }
        if ($zip.Entries | Where-Object { $_.FullName -match '(^|/)(?:build-input|node_modules|\.development|logs)/' }) { throw 'Private files entered ZIP' }
    } finally { $zip.Dispose() }
}
function Get-Sha256([string]$file) {
    $stream = [IO.File]::OpenRead($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

$startWord = -join ([char[]](0x542F,0x52A8))
$sourceEdition = -join ([char[]](0x6E90,0x7801,0x7248))
$contestEdition = -join ([char[]](0x53C2,0x8D5B,0x7248))
$offlineEdition = -join ([char[]](0x79BB,0x7EBF,0x4F53,0x9A8C))
$doubleClickEdition = -join ([char[]](0x53CC,0x51FB,0x4F53,0x9A8C))
$sourceLauncher = Get-Item -LiteralPath (Join-Path $projectRoot "$startWord$brand$sourceEdition.cmd") -ErrorAction SilentlyContinue
$portableLauncher = Get-Item -LiteralPath (Join-Path $projectRoot "$startWord$brand$contestEdition.cmd") -ErrorAction SilentlyContinue
$offlineLauncher = Get-Item -LiteralPath (Join-Path $projectRoot "$brand-$offlineEdition.cmd") -ErrorAction SilentlyContinue
$offlineHtml = Get-Item -LiteralPath (Join-Path $projectRoot "tourism/$brand-$doubleClickEdition.html") -ErrorAction SilentlyContinue
if (-not $sourceLauncher -or -not $portableLauncher -or -not $offlineLauncher -or -not $offlineHtml) { throw 'Launch files are incomplete' }
$sourceFixed = @('README.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','build-app.cjs','build-travel-brand.cjs','assets/travel-symbol.svg','assets/travel-wordmark.svg','assets/travel-icon.png','platform/model-config-paths.cjs','tools/check-environment.cjs','tools/anonymity-audit.cjs')
$sourceTests = @('test/contest-4.2.test.cjs','test/agent-runner.test.cjs','test/evaluation.test.cjs')
$source = @(Resolve-Files ($sourceFixed + $sourceTests)) + @(Get-TreeFiles 'tourism' @('.js','.cjs','.json','.md','.html')) + @(Get-TreeFiles 'runtime/skills' @('.js','.cjs','.json','.md')) + @(Get-TreeFiles 'docs' @('.md'))
$source += $sourceLauncher.FullName
$source = @($source | Sort-Object -Unique)

$portableFixed = @('README.md','THIRD_PARTY_NOTICES.md','runtime/bin/node.exe','platform/model-config-paths.cjs','assets/travel-symbol.svg','assets/travel-wordmark.svg')
$portable = @(Resolve-Files $portableFixed) + @(Get-TreeFiles 'tourism' @('.js','.cjs','.json','.md','.html')) + @(Get-TreeFiles 'runtime/skills' @('.js','.cjs','.json','.md')) + @(Get-TreeFiles 'docs' @('.md'))
$portable += $portableLauncher.FullName
$portable = @($portable | Sort-Object -Unique)

$offline = @(Resolve-Files @('README.md','THIRD_PARTY_NOTICES.md')) + @($offlineLauncher.FullName,$offlineHtml.FullName) + @(Get-TreeFiles 'docs' @('.md'))

Assert-Safe $source 'source'
Assert-Safe $portable 'portable'
Assert-Safe $offline 'offline'
$sourcePath = Join-Path $releaseDir "$brand-$version-source-$stamp.zip"
$portablePath = Join-Path $releaseDir "$brand-$version-portable-web-$stamp.zip"
$offlinePath = Join-Path $releaseDir "$brand-$version-offline-demo-$stamp.zip"
Add-Package $sourcePath $source
Add-Package $portablePath $portable
Add-Package $offlinePath $offline
$sourceLauncherRel = $sourceLauncher.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
$portableLauncherRel = $portableLauncher.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
$offlineLauncherRel = $offlineLauncher.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
$offlineHtmlRel = $offlineHtml.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
Verify-Package $sourcePath $source @('package.json','build-app.cjs','tourism/agent-server.cjs','runtime/skills/travel-demand-planner/SKILL.md',$sourceLauncherRel)
Verify-Package $portablePath $portable @('runtime/bin/node.exe','tourism/agent-server.cjs','runtime/skills/travel-content-lab/SKILL.md',$portableLauncherRel)
Verify-Package $offlinePath $offline @($offlineLauncherRel,$offlineHtmlRel)

$artifacts = @($sourcePath,$portablePath,$offlinePath) | ForEach-Object { $item=Get-Item -LiteralPath $_; [ordered]@{name=$item.Name;bytes=$item.Length;sha256=(Get-Sha256 $_)} }
$protectedHash = Get-Sha256 (Join-Path $projectRoot 'build-input/authorized-runtime.bin')
if ($protectedHash -ne 'D0B395AFB78D50812570437C0AA52DEC1EBDDE2CFCE492750CB3D651BCC97337') { throw 'Protected build input hash mismatch' }
$manifest = [ordered]@{product=$brand;version=$version;createdAt=(Get-Date -Format o);forms=@('source','portable-web','offline-demo');realModelCalls=0;anonymousAudit='passed';protectedBuildInputIncluded=$false;protectedBuildInputSHA256=$protectedHash;artifacts=$artifacts}
$manifestPath = Join-Path $releaseDir "manifest-$version-$stamp.json"
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$manifest | ConvertTo-Json -Depth 5
