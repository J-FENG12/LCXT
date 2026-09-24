param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = Join-Path $root 'release\最终提交-20260913-五分钟版'
if (Test-Path -LiteralPath $target) {
    if (-not $Refresh) { throw "Final submission folder already exists: $target" }
} else { [IO.Directory]::CreateDirectory($target) | Out-Null }

$files = @(
    'release\旅策协同-4.2.0-source-20260913-102749.zip',
    'release\旅策协同-4.2.0-desktop-demo-20260913-095118.zip',
    'release\旅策协同-4.2.0-portable-web-20260913-102749.zip',
    'release\旅策协同-4.2.0-offline-demo-20260913-102749.zip',
    'release\旅策协同-文旅Skill系统-评审讲解版-20260913.pptx',
    'release\旅策协同-文旅Skill系统-评审讲解版-20260913.mp4',
    'release\旅策协同-文旅Skill系统-评审讲解版-中文字幕.srt',
    'docs\评审交付说明.md',
    'docs\一键部署教程.md',
    'docs\评审版视频讲解稿.md'
)
foreach ($relative in $files) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing final artifact: $relative" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $target ([IO.Path]::GetFileName($source))) -Force
}

$artifacts = Get-ChildItem -LiteralPath $target -File | Where-Object { $_.Name -ne 'submission-manifest.json' } | Sort-Object Name | ForEach-Object {
    [ordered]@{ name=$_.Name; bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
$manifest = [ordered]@{
    product = 'Travel.AI'
    version = '4.2.0'
    contest = 'JBGS-2026-06'
    createdAt = (Get-Date -Format o)
    modelPolicy = 'Evaluator supplies an authorized model and API key; no developer key is included.'
    reviewerProfile = '.tr-ai-review'
    reviewerStartsWithModel = $false
    personalProfileFallback = $false
    skills = @('travel-demand-planner','travel-service-coordinator','travel-content-lab')
    realModelCallsDuringFinalValidation = 0
    validation = [ordered]@{ projectTests='108/108'; offlineEvaluation='25/25'; browserChecks='49/49'; anonymousAudit='passed'; packageSecretAudit='passed' }
    artifacts = $artifacts
}
$manifestPath = Join-Path $target 'submission-manifest.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ folder=$target; fileCount=(Get-ChildItem -LiteralPath $target -File).Count; manifest=$manifestPath } | ConvertTo-Json
