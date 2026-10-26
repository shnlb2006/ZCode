Add-Type -AssemblyName System.Drawing
$asar = Get-Item 'D:\Programs\ZCode\resources\app.asar' -ErrorAction SilentlyContinue
if ($asar) { 'app.asar: ' + $asar.LastWriteTime + ' ' + [int]($asar.Length/1MB) + 'MB' }
$exe = Get-Item 'D:\Programs\ZCode\CodeDesign.exe'
'exe icon check:'
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe.FullName)
$bmp = $ico.ToBitmap()
$bmp.Save('E:\harness\ZCode\.tmp-taskbar-icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
'saved 32px icon'
Start-Process 'D:\Programs\ZCode\CodeDesign.exe'
Start-Sleep -Seconds 12
$main = Get-Process CodeDesign -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
if ($main) {
  'MainWindow: ' + $main.MainWindowTitle
  $sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
  Add-Type -TypeDefinition $sig
  [Win32]::ShowWindow($main.MainWindowHandle, 9) | Out-Null
  [Win32]::SetForegroundWindow($main.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 3
  $rect = New-Object Win32+RECT
  [Win32]::GetWindowRect($main.MainWindowHandle, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  'window rect: ' + $w + 'x' + $h
  $bmp2 = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp2)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp2.Size)
  $bmp2.Save('E:\harness\ZCode\.tmp-window.png')
  'window screenshot saved'
} else { 'no main window found' }
