param([Parameter(Mandatory=$true)][string[]]$PackagePaths)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Find-ApiKeyValues($value) {
    $found = New-Object System.Collections.Generic.List[string]
    if ($null -eq $value) { return $found }
    if ($value -is [System.Collections.IDictionary]) {
        foreach ($key in $value.Keys) {
            if ([string]$key -match 'api.?key' -and $value[$key] -is [string] -and $value[$key].Length -ge 8) { $found.Add($value[$key]) }
            else { foreach ($nested in (Find-ApiKeyValues $value[$key])) { $found.Add($nested) } }
        }
    } elseif ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
        foreach ($entry in $value) { foreach ($nested in (Find-ApiKeyValues $entry)) { $found.Add($nested) } }
    } elseif ($value -is [pscustomobject]) {
        foreach ($property in $value.PSObject.Properties) {
            if ($property.Name -match 'api.?key' -and $property.Value -is [string] -and $property.Value.Length -ge 8) { $found.Add($property.Value) }
            else { foreach ($nested in (Find-ApiKeyValues $property.Value)) { $found.Add($nested) } }
        }
    }
    return $found
}

$personalConfig = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.tr-ai-assist\tr-ai-assist.json'
$personalProfilePath = [Environment]::GetFolderPath('UserProfile')
$secrets = @()
if (Test-Path -LiteralPath $personalConfig) {
    $secrets = @(Find-ApiKeyValues ([IO.File]::ReadAllText($personalConfig, [Text.Encoding]::UTF8) | ConvertFrom-Json) | Sort-Object -Unique)
}
$textExtensions = @('.js','.cjs','.mjs','.json','.md','.html','.css','.txt','.cmd','.ps1','.vbs','.toml','.yaml','.yml','.xml')
$results = foreach ($packagePath in $PackagePaths) {
    $resolved = [IO.Path]::GetFullPath($packagePath)
    $archive = [IO.Compression.ZipFile]::OpenRead($resolved)
    $secretHits = 0; $personalPathHits = 0; $configEntryHits = 0
    try {
        foreach ($entry in $archive.Entries) {
            $normalized = $entry.FullName.Replace('\','/')
            if ($normalized -match '(^|/)(?:tr-ai-assist\.json|tr-ai-review\.json|auth\.json|credentials\.json)$') { $configEntryHits += 1 }
            if ($entry.Length -gt 33554432 -or $textExtensions -notcontains [IO.Path]::GetExtension($entry.Name).ToLowerInvariant()) { continue }
            $stream = $entry.Open()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
            try { $content = $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
            foreach ($secret in $secrets) { if ($content.Contains($secret)) { $secretHits += 1 } }
            if ($content.Contains($personalProfilePath)) { $personalPathHits += 1 }
        }
    } finally { $archive.Dispose() }
    [ordered]@{ name=[IO.Path]::GetFileName($resolved); personalApiKeysFound=$secrets.Count; secretEntryHits=$secretHits; personalPathEntryHits=$personalPathHits; configEntryHits=$configEntryHits; passed=($secretHits -eq 0 -and $personalPathHits -eq 0 -and $configEntryHits -eq 0) }
}
$results | ConvertTo-Json -Depth 4
if ($results | Where-Object { -not $_.passed }) { exit 1 }
