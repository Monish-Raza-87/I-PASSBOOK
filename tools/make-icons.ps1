# make-icons.ps1 — regenerate the app icon set from the brand master.
#
#   pwsh -File tools/make-icons.ps1
#
# Why PowerShell and not a node script: this repo has no build step and no npm
# access (see tools/serve-local.mjs for the same constraint), so there is no
# sharp/jimp to reach for. System.Drawing is in-box on Windows, needs no
# download, and is what generated the icons that ship today.
#
# What it does, and what it deliberately does NOT do:
#   * It downscales the master as a WHOLE SQUARE. It does not crop to the mark's
#     bounding box. The artwork sits on a soft light wash that reaches every
#     edge of the master (corner-to-corner luminance runs ~250 down to ~224), so
#     a tight crop would slice that gradient and leave a visible rectangular
#     seam on a white icon. The master arrives already cropped by the owner —
#     that is what "I cropped it to zoom it" means — so the mark's size in the
#     icon is decided by the master, not by this script.
#   * It resamples in halving steps rather than in one jump. A single bicubic
#     pass from 1653px straight to 180px softens the mark's edges; halving until
#     within 2x of the target and finishing with one high-quality bicubic pass
#     keeps them crisp.
#
# The source is assets/icon-master.jpeg. Replace that file, re-run this, and
# bump CACHE_NAME in sw.js — the icons are precached, so a client that already
# has the old one keeps it until the cache name changes.

param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\icon-master.jpeg'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "No master image at $Source" }

# name -> edge length. 192 is the favicon and the sign-in card; 512 is what
# Android/Chrome want for the home screen; 180 is the exact size iOS asks for by
# file name.
$targets = [ordered]@{
  'icon-192.png'         = 192
  'icon-512.png'         = 512
  'apple-touch-icon.png' = 180
}

function New-Canvas([int]$size) {
  New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Set-Quality($g) {
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

# One resample step into a fresh canvas of exactly $size.
function Resize-Step($src, [int]$size) {
  $dst = New-Canvas $size
  $g = [System.Drawing.Graphics]::FromImage($dst)
  Set-Quality $g
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  return $dst
}

# Halve while the current edge is more than twice the target, then finish.
function Resize-To($src, [int]$size) {
  $work = $src
  while ($work.Width -gt ($size * 2)) {
    $next = Resize-Step $work ([int]($work.Width / 2))
    if ($work -ne $src) { $work.Dispose() }
    $work = $next
  }
  $final = Resize-Step $work $size
  if ($work -ne $src) { $work.Dispose() }
  return $final
}

# Measure the mark, so the script reports something a human can check rather
# than just "wrote a file". Ink = luminance below 128, and its bounding box as a
# share of the icon's width tells you whether the mark is the size you intended.
function InkReport($bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)

  $minX = $bmp.Width; $maxX = -1; $minY = $bmp.Height; $maxY = -1; $ink = 0
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $i = $y * $stride + $x * 4
      $lum = 0.299 * $bytes[$i] + 0.587 * $bytes[$i + 1] + 0.114 * $bytes[$i + 2]
      if ($lum -lt 128) {
        $ink++
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) { return 'NO INK AT ALL — the icon is blank' }
  $pct = [Math]::Round(100 * ($maxX - $minX + 1) / $bmp.Width)
  $cover = [Math]::Round(100 * $ink / ($bmp.Width * $bmp.Height), 1)
  return "mark spans $pct% of the width, covers $cover% of the icon, box ${minX},${minY} to ${maxX},${maxY}"
}

$master = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$masterBmp = New-Object System.Drawing.Bitmap $master

"master: $(Split-Path $Source -Leaf)  $($masterBmp.Width)x$($masterBmp.Height)"
""

foreach ($name in $targets.Keys) {
  $size = $targets[$name]
  $icon = Resize-To $masterBmp $size
  $path = Join-Path $OutDir $name
  $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  "{0,-22} {1}x{1}  {2,8:N0} bytes   {3}" -f $name, $size, (Get-Item $path).Length, (InkReport $icon)
  $icon.Dispose()
}

$masterBmp.Dispose(); $master.Dispose()
""
"Now bump CACHE_NAME in sw.js — the icons are precached under it."
