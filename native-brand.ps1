param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][string]$IconPath,
    [string]$Title,
    [string]$HoldHiddenUntilFile,
    [switch]$Once,
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$Title = -join ([char[]](0x65C5, 0x7B56, 0x534F, 0x540C, 0x20, 0x00B7, 0x20, 0x6587, 0x65C5, 0x667A, 0x80FD, 0x8F85, 0x52A9))
$resolvedIcon = [IO.Path]::GetFullPath($IconPath)
if (-not [IO.File]::Exists($resolvedIcon)) { throw "Brand icon is missing: $resolvedIcon" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace TravelBranding {
  public static class NativeMethods {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool SetWindowText(IntPtr hWnd, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW", SetLastError = true)] public static extern IntPtr SetClassLongPtr64(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetClassLongW", SetLastError = true)] public static extern uint SetClassLong32(IntPtr hWnd, int index, uint value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    public static IntPtr SetClassIcon(IntPtr hWnd, int index, IntPtr icon) {
      return IntPtr.Size == 8 ? SetClassLongPtr64(hWnd, index, icon) : new IntPtr((long)SetClassLong32(hWnd, index, unchecked((uint)icon.ToInt32())));
    }
  }
}
'@

$largeIcon = [TravelBranding.NativeMethods]::LoadImage([IntPtr]::Zero, $resolvedIcon, 1, 32, 32, 0x10)
$smallIcon = [TravelBranding.NativeMethods]::LoadImage([IntPtr]::Zero, $resolvedIcon, 1, 16, 16, 0x10)
if ($largeIcon -eq [IntPtr]::Zero -or $smallIcon -eq [IntPtr]::Zero) { throw 'Unable to load the Travel.AI icon.' }
$readyPath = if ($HoldHiddenUntilFile) { [IO.Path]::GetFullPath($HoldHiddenUntilFile) } else { $null }
$hiddenWindows = [Collections.Generic.HashSet[long]]::new()

$apply = {
    $script:applied = 0
    $script:iconVerified = 0
    $callback = [TravelBranding.NativeMethods+EnumWindowsProc]{
        param([IntPtr]$window, [IntPtr]$state)
        [uint32]$owner = 0
        [void][TravelBranding.NativeMethods]::GetWindowThreadProcessId($window, [ref]$owner)
        if ($owner -eq [uint32]$TargetProcessId -and [TravelBranding.NativeMethods]::GetWindowTextLength($window) -gt 0) {
            [void][TravelBranding.NativeMethods]::SetWindowText($window, $Title)
            [void][TravelBranding.NativeMethods]::SendMessage($window, 0x80, [IntPtr]1, $largeIcon)
            [void][TravelBranding.NativeMethods]::SendMessage($window, 0x80, [IntPtr]0, $smallIcon)
            [void][TravelBranding.NativeMethods]::SetClassIcon($window, -14, $largeIcon)
            [void][TravelBranding.NativeMethods]::SetClassIcon($window, -34, $smallIcon)
            if ($readyPath -and -not [IO.File]::Exists($readyPath)) {
                [void]$hiddenWindows.Add($window.ToInt64())
                [void][TravelBranding.NativeMethods]::ShowWindow($window, 0)
            } elseif ($hiddenWindows.Remove($window.ToInt64())) {
                [void][TravelBranding.NativeMethods]::ShowWindow($window, 5)
            }
            $script:applied++
            if ([TravelBranding.NativeMethods]::SendMessage($window, 0x7F, [IntPtr]0, [IntPtr]::Zero) -ne [IntPtr]::Zero) {
                $script:iconVerified++
            }
        }
        return $true
    }
    [void][TravelBranding.NativeMethods]::EnumWindows($callback, [IntPtr]::Zero)
}

do {
    if ($null -eq (Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue)) { break }
    & $apply
    if ($Once -and $script:applied -gt 0) { break }
    Start-Sleep -Milliseconds $(if ($readyPath -and -not [IO.File]::Exists($readyPath)) { 25 } else { 750 })
} while ($true)

if ($Once -and $script:applied -eq 0) { throw 'No visible window was found for the target process.' }
if ($Verify) {
    [ordered]@{ titleApplied = ($script:applied -gt 0); iconApplied = ($script:iconVerified -gt 0); windows = $script:applied } | ConvertTo-Json -Compress
}
