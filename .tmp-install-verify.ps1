Add-Type -AssemblyName System.Drawing
$installer = 'E:\harness\ZCode\packages\desktop\dist\CodeDesign-3.17.2-win-x64.exe'
$proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
$proc.WaitForExit(300000) | Out-Null
Write-Output "installer exit code: $($proc.ExitCode)"
Start-Sleep -Seconds 10
$main = Get-Process CodeDesign -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
if ($main) { Write-Output "MainWindow: $($main.MainWindowTitle)" } else { Write-Output "no main window" }
$exe = 'D:\Programs\ZCode\CodeDesign.exe'
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $ico.ToBitmap()
$bmp.Save('E:\harness\ZCode\.tmp-taskbar-32.png', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "taskbar icon extracted (32px)"
$sig = @'
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
Add-Type -TypeDefinition $sig
if ($main) {
  [W32]::ShowWindow($main.MainWindowHandle, 9) | Out-Null
  [W32]::SetForegroundWindow($main.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 3
  $rect = New-Object W32+RECT
  [W32]::GetWindowRect($main.MainWindowHandle, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  $shot = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($shot)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $shot.Size)
  $shot.Save('E:\harness\ZCode\.tmp-window-final.png')
  Write-Output "window screenshot saved ${w}x${h}"
}
