# SneakPeek's music helper. Reads Windows' "now playing" (the media session behind the volume-key popup), so it
# works with Spotify, browsers, Apple Music, VLC... Prints one JSON line per change; reads commands from stdin:
# toggle | next | prev. Started by main.js; exits when SneakPeek closes its stdin.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # no "Preparing modules" noise on first run
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$NS = 'Windows.Media.Control'
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$IRAS = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$ICT = [Windows.Storage.Streams.IContentTypeProvider, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Get-Art($props) {
  try {
    if (-not $props.Thumbnail) { return $null }
    $ras = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # The stream arrives as a bare COM object, so call its methods through the WinRT interface types.
    $size = [uint64]$IRAS.GetProperty('Size').GetValue($ras)
    if ($size -eq 0 -or $size -gt 3MB) { return $null }
    $input = $IRAS.GetMethod('GetInputStreamAt').Invoke($ras, @([uint64]0))
    $dr = [Windows.Storage.Streams.DataReader]::new($input)
    $n = Await ($dr.LoadAsync([uint32]$size)) ([uint32])
    $bytes = New-Object byte[] $n
    $dr.ReadBytes($bytes); $dr.Dispose()
    $type = try { $ICT.GetProperty('ContentType').GetValue($ras) } catch { $null }
    if (-not $type) { $type = 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

# Output volume: the peak level of the default speakers (the bar in Windows' volume mixer), for the music bars.
$meterOk = $true
try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation { [PreserveSig] int GetPeakValue(out float peak); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class SneakPeekMeter {
  static IAudioMeterInformation meter;
  public static void Reset() { meter = null; } // picks up a new default device (headphones plugged in)
  public static float Peak() {
    try {
      if (meter == null) {
        IMMDevice d; ((IMMDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(0, 1, out d);
        Guid iid = typeof(IAudioMeterInformation).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
        meter = (IAudioMeterInformation)o;
      }
      float p; meter.GetPeakValue(out p); return p;
    } catch { meter = null; return 0; }
  }
}
'@
} catch { $meterOk = $false }
$inv = [Globalization.CultureInfo]::InvariantCulture; $tick = 0

function Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

# Commands arrive on stdin. Reading it blocks in Windows PowerShell, so a background runspace reads lines into a queue.
$queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$reader = [runspacefactory]::CreateRunspace(); $reader.Open(); $reader.SessionStateProxy.SetVariable('queue', $queue)
$readPs = [powershell]::Create(); $readPs.Runspace = $reader
[void]$readPs.AddScript({ $in = [Console]::In; while ($null -ne ($line = $in.ReadLine())) { $queue.Enqueue($line) }; $queue.Enqueue('__eof__') })
[void]$readPs.BeginInvoke()
$lastKey = ''; $lastSent = [DateTime]::MinValue; $artTries = 0; $art = $null
while ($true) {
  # Commands from SneakPeek
  $cmd = $null
  while ($queue.TryDequeue([ref]$cmd)) {
    if ($cmd -eq '__eof__') { exit } # SneakPeek went away
    try {
      $s = $mgr.GetCurrentSession()
      if ($s) {
        switch ($cmd.Trim()) {
          'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
          'next'   { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
          'prev'   { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
        }
      }
    } catch {}
    $lastKey = '' # report the new state right away
  }

  $playing = $false
  try {
    $s = $mgr.GetCurrentSession()
    if (-not $s) {
      if ($lastKey -ne 'none') { Send @{ none = $true }; $lastKey = 'none' }
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $status = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      $playing = $status -eq 'Playing'
      $tl = $s.GetTimelineProperties()
      $track = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
      $key = "$track|$status"
      if ($track -ne ($lastKey -replace '\|[^|]*$', '')) { $art = $null; $artTries = 0 }
      $newArt = $false
      if (-not $art -and $artTries -lt 6) { $artTries++; $art = Get-Art $p; $newArt = [bool]$art } # art often arrives a moment after the track
      if ($key -ne $lastKey -or $newArt -or ([DateTime]::Now - $lastSent).TotalSeconds -ge 5) {
        $msg = @{
          app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
          status = $status.ToLower()
          pos = [long]$tl.Position.TotalMilliseconds; dur = [long]($tl.EndTime - $tl.StartTime).TotalMilliseconds
          at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        }
        if ($key -ne $lastKey -or $newArt) { $msg.art = $art } # only resend art when it changed
        Send $msg
        $lastKey = $key; $lastSent = [DateTime]::Now
      }
    }
  } catch {}
  if ($playing -and $meterOk) { # the volume, 10 times over the next half second
    if ((++$tick % 20) -eq 0) { [SneakPeekMeter]::Reset() }
    for ($i = 0; $i -lt 10; $i++) {
      [Console]::Out.WriteLine('L ' + [Math]::Round([SneakPeekMeter]::Peak(), 3).ToString($inv)); [Console]::Out.Flush()
      Start-Sleep -Milliseconds 50
    }
  } else { Start-Sleep -Milliseconds 500 }
}
