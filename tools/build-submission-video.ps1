param(
    [string]$OutputPath = "",
    [switch]$AgentFirst,
    [switch]$Review
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ffmpeg = "F:\program\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe"
$ffprobe = "F:\program\ffmpeg-8.1.2-essentials_build\bin\ffprobe.exe"
if ($Review) { $configFileName = "submission-video-segments-review.json" }
elseif ($AgentFirst) { $configFileName = "submission-video-segments-agent-first.json" }
else { $configFileName = "submission-video-segments.json" }
$configPath = [System.IO.Path]::Combine($PSScriptRoot, $configFileName)
$buildRoot = Join-Path $projectRoot (".development\video-build\render-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$audioRoot = Join-Path $buildRoot "audio"
$segmentRoot = Join-Path $buildRoot "segments"
$releaseRoot = Join-Path $projectRoot "release"

if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "FFmpeg not found: $ffmpeg" }
if (-not (Test-Path -LiteralPath $ffprobe)) { throw "FFprobe not found: $ffprobe" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "Segment config not found: $configPath" }

New-Item -ItemType Directory -Force -Path $audioRoot, $segmentRoot, $releaseRoot | Out-Null

if ($Review) { $srtFileName = "TravelAI-Skill-Review-zh-CN.srt" }
elseif ($AgentFirst) { $srtFileName = "TravelAI-Agent-First-zh-CN.srt" }
else { $srtFileName = "TravelAI-Demo-zh-CN.srt" }
$srtPath = [System.IO.Path]::Combine([string]$releaseRoot, [string]$srtFileName)

$json = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
$parsedSegments = $json | ConvertFrom-Json
$segments = New-Object System.Collections.Generic.List[object]
foreach ($parsedSegment in $parsedSegments) { $segments.Add($parsedSegment) }
if ($segments.Count -eq 0) { throw "No video segments configured." }

Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { $_ -like "*Huihui*" } | Select-Object -First 1
if ($voice) { $speaker.SelectVoice($voice) }
$speaker.Rate = 0
$speaker.Volume = 100

function Format-SrtTime([double]$seconds) {
    $span = [TimeSpan]::FromSeconds($seconds)
    return ('{0:00}:{1:00}:{2:00},{3:000}' -f [math]::Floor($span.TotalHours), $span.Minutes, $span.Seconds, $span.Milliseconds)
}

$concatLines = New-Object System.Collections.Generic.List[string]
$srtBlocks = New-Object System.Collections.Generic.List[string]
$timeline = 0.0
$index = 0
$subtitleIndex = 0

foreach ($item in $segments) {
    $index += 1
    $imagePath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ([string]$item.image)))
    if (-not (Test-Path -LiteralPath $imagePath)) { throw "Image not found: $imagePath" }

    $wavPath = Join-Path $audioRoot ('{0:00}.wav' -f $index)
    $mp4Path = Join-Path $segmentRoot ('{0:00}.mp4' -f $index)
    $speaker.SetOutputToWaveFile($wavPath)
    $speaker.Speak([string]$item.narration)
    $speaker.SetOutputToNull()

    $durationText = & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- $wavPath
    if ($LASTEXITCODE -ne 0) { throw "Unable to read audio duration: $wavPath" }
    $duration = [double]::Parse(($durationText | Select-Object -First 1), [Globalization.CultureInfo]::InvariantCulture) + 0.8
    $durationArg = $duration.ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)

    & $ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i $imagePath -i $wavPath -t $durationArg -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xF5F7F7,format=yuv420p" -c:v libx264 -preset medium -crf 19 -r 30 -c:a aac -b:a 160k -af "apad=pad_dur=1" -shortest -movflags +faststart $mp4Path
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed for segment $index" }

    $escapedPath = $mp4Path.Replace("'", "''")
    $concatLines.Add("file '$escapedPath'")
    $start = $timeline
    $timeline += $duration
    $sentences = New-Object System.Collections.Generic.List[string]
    foreach ($match in [regex]::Matches([string]$item.narration, '[^\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A]+[\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A]?')) {
        $sentenceText = $match.Value.Trim()
        if ($sentenceText) { $sentences.Add($sentenceText) }
    }
    $captions = New-Object System.Collections.Generic.List[string]
    $part = ""
    foreach ($sentence in $sentences) {
        if ($part.Length -gt 0 -and ($part.Length + $sentence.Length) -gt 27) { $captions.Add($part); $part = "" }
        while ($sentence.Length -gt 30) { $captions.Add($sentence.Substring(0, 30)); $sentence = $sentence.Substring(30) }
        $part += $sentence
    }
    if ($part.Length -gt 0) { $captions.Add($part) }
    if ($captions.Count -eq 0) { $captions.Add([string]$item.narration) }
    $characters = ($captions | ForEach-Object { $_.Length } | Measure-Object -Sum).Sum
    $captionStart = $start
    for ($captionNumber = 0; $captionNumber -lt $captions.Count; $captionNumber++) {
        $subtitleIndex += 1
        $captionEnd = if ($captionNumber -eq $captions.Count - 1) { $timeline } else { $captionStart + $duration * ($captions[$captionNumber].Length / $characters) }
        $srtBlocks.Add(($subtitleIndex.ToString() + "`r`n" + (Format-SrtTime $captionStart) + " --> " + (Format-SrtTime $captionEnd) + "`r`n" + $captions[$captionNumber] + "`r`n"))
        $captionStart = $captionEnd
    }
}
$speaker.Dispose()

$listPath = Join-Path $segmentRoot "concat.txt"
[System.IO.File]::WriteAllLines($listPath, $concatLines, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($srtPath, ($srtBlocks -join "`r`n"), (New-Object System.Text.UTF8Encoding($true)))

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    if ($Review) { $videoVariant = "TravelAI-Skill-Review-" }
    elseif ($AgentFirst) { $videoVariant = "TravelAI-Agent-First-" }
    else { $videoVariant = "TravelAI-Demo-" }
    $OutputPath = [System.IO.Path]::Combine($releaseRoot, $videoVariant + $stamp + ".mp4")
} else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}

& $ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i $listPath -c copy -movflags +faststart $OutputPath
if ($LASTEXITCODE -ne 0) { throw "Final video concatenation failed." }

$probe = & $ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of json -- $OutputPath
$sha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
[pscustomobject]@{
    output = $OutputPath
    subtitles = $srtPath
    voice = $(if ($voice) { $voice } else { "default" })
    segments = $segments.Count
    sha256 = $sha256
    probe = ($probe -join "")
} | ConvertTo-Json -Depth 6
