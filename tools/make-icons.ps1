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
#
# ── The borderless mark, and why it needs code rather than a crop ────────────
#
# The master is a logo on a light background, and the OS icons above keep that
# background on purpose: a home-screen tile is square, and iOS/Android mask it
# themselves. Inside the app it is the opposite — the owner's words were that the
# icon "comes in a shape of square" and should "feel real embedded into the
# page", and the square they were seeing is exactly that baked-in wash.
#
# So this also writes assets/icon-mark.png: the same artwork with the background
# made TRANSPARENT, for the sidebar and the sign-in card.
#
# The naive way to do that — make every light pixel transparent — punches the
# holes in the logo too, because the "Passbook" script and the monogram inside
# the circle are white. What is background and what is artwork cannot be told
# apart by colour alone: they are the same colour. The only thing that separates
# them is CONNECTIVITY, so the fill starts at the border and spreads inward,
# stopping at anything that is not background-coloured. The white inside the
# circle is enclosed by the dark circle and is never reached.
#
# That flood is why this part is C# injected with Add-Type rather than plain
# PowerShell: it is ~2.7 million pixels and a per-pixel loop in PowerShell takes
# minutes, while the same loop compiled takes well under a second.

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

# ── The cutout, compiled ─────────────────────────────────────────────────────
# Conservative C# (no interpolation, no expression bodies) so this compiles under
# Windows PowerShell 5.1's csc as well as pwsh's Roslyn.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;

public static class BrandMark
{
    // Zero the alpha of everything that is background-coloured AND reachable
    // from the border, then feather the one-pixel seam that leaves behind.
    public static void Cutout(byte[] px, int w, int h, int tol)
    {
        int bb = px[0], bg = px[1], br = px[2];   // Format32bppArgb is BGRA in memory

        bool[] bgish = new bool[w * h];
        for (int p = 0; p < w * h; p++)
        {
            int i = p * 4;
            bgish[p] = Math.Abs(px[i + 2] - br) <= tol
                    && Math.Abs(px[i + 1] - bg) <= tol
                    && Math.Abs(px[i]     - bb) <= tol;
        }

        bool[] clear = new bool[w * h];
        Stack<int> stack = new Stack<int>();
        for (int x = 0; x < w; x++)
        {
            Push(stack, clear, bgish, x);
            Push(stack, clear, bgish, (h - 1) * w + x);
        }
        for (int y = 0; y < h; y++)
        {
            Push(stack, clear, bgish, y * w);
            Push(stack, clear, bgish, y * w + w - 1);
        }
        while (stack.Count > 0)
        {
            int p = stack.Pop();
            int x = p % w, y = p / w;
            if (x > 0)     Push(stack, clear, bgish, p - 1);
            if (x < w - 1) Push(stack, clear, bgish, p + 1);
            if (y > 0)     Push(stack, clear, bgish, p - w);
            if (y < h - 1) Push(stack, clear, bgish, p + w);
        }

        int cleared = 0;
        for (int p = 0; p < w * h; p++)
        {
            if (clear[p]) { px[p * 4 + 3] = 0; cleared++; }
        }

        // The pixels the fill stopped ON are the anti-aliased rim of the artwork.
        // Left at full opacity they show as a pale halo of the background colour,
        // so their alpha follows how far they are from it.
        for (int p = 0; p < w * h; p++)
        {
            if (clear[p]) continue;
            int x = p % w, y = p / w;
            bool rim = (x > 0 && clear[p - 1]) || (x < w - 1 && clear[p + 1])
                    || (y > 0 && clear[p - w]) || (y < h - 1 && clear[p + w]);
            if (!rim) continue;
            int i = p * 4;
            int d = Math.Max(Math.Abs(px[i + 2] - br),
                    Math.Max(Math.Abs(px[i + 1] - bg), Math.Abs(px[i] - bb)));
            int a = (int)(255.0 * (d - tol) / (tol * 2.0));
            px[i + 3] = (byte)(a < 0 ? 0 : (a > 255 ? 255 : a));
        }
    }

    // Bounding box of the pixels that survived, as {x0, y0, x1, y1} — the artwork
    // with the background gone, which is a different rectangle from the master.
    public static int[] Box(byte[] px, int w, int h)
    {
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (px[(y * w + x) * 4 + 3] == 0) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        return new int[] { minX, minY, maxX, maxY };
    }

    // Count of fully transparent pixels, reported so a hollowed-out logo is
    // visible in the output rather than only on the page.
    public static int Cleared(byte[] px, int w, int h)
    {
        int n = 0;
        for (int p = 0; p < w * h; p++) if (px[p * 4 + 3] == 0) n++;
        return n;
    }

    static void Push(Stack<int> s, bool[] clear, bool[] bgish, int p)
    {
        if (!clear[p] && bgish[p]) { clear[p] = true; s.Push(p); }
    }
}
'@

# What the fill counts as background. The wash is flat within a few levels and
# its faint diagonal lines sit ~15 off it; the artwork is ~200 off. 48 sits in
# the gap with room on both sides.
$BackgroundTolerance = 48
$MarkWidth = 512

# Halve, then finish — the same stepped resample as the icons above, but keeping
# the artwork's own aspect ratio instead of forcing a square.
function Resize-Width($src, [int]$w) {
  $work = $src
  while ($work.Width -gt ($w * 2)) {
    $nw = [int]($work.Width / 2); $nh = [int]($work.Height / 2)
    $next = New-Object System.Drawing.Bitmap $nw, $nh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($next)
    Set-Quality $g
    $g.DrawImage($work, 0, 0, $nw, $nh)
    $g.Dispose()
    if ($work -ne $src) { $work.Dispose() }
    $work = $next
  }
  $hh = [int][Math]::Round($work.Height * $w / $work.Width)
  $final = New-Object System.Drawing.Bitmap $w, $hh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($final)
  Set-Quality $g
  $g.DrawImage($work, 0, 0, $w, $hh)
  $g.Dispose()
  if ($work -ne $src) { $work.Dispose() }
  return $final
}

# What share of the finished mark is see-through. A cutout that quietly failed
# reads as 0%; one that ate the logo reads as far too high. Either way the number
# is the check, because the page shows the failure as "the logo looks fine" on a
# light background and wrong on a dark one.
function AlphaReport($bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $clear = 0; $solid = 0
  for ($p = 0; $p -lt ($bmp.Width * $bmp.Height); $p++) {
    $a = $bytes[$p * 4 + 3]
    if ($a -eq 0) { $clear++ } elseif ($a -eq 255) { $solid++ }
  }
  $total = $bmp.Width * $bmp.Height
  return "transparent {0}%, solid {1}%" -f [Math]::Round(100 * $clear / $total), [Math]::Round(100 * $solid / $total)
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

# ── And the borderless mark ──────────────────────────────────────────────────

# A fresh 32bpp canvas: the master is a JPEG, so it has no alpha channel to write
# into, and the cutout works on the bytes directly.
$plate = New-Object System.Drawing.Bitmap $masterBmp.Width, $masterBmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($plate)
Set-Quality $g
$g.DrawImage($masterBmp, 0, 0, $masterBmp.Width, $masterBmp.Height)
$g.Dispose()

$all = New-Object System.Drawing.Rectangle 0, 0, $plate.Width, $plate.Height
$data = $plate.LockBits($all, [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $plate.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

[BrandMark]::Cutout($bytes, $plate.Width, $plate.Height, $BackgroundTolerance)
$box = [BrandMark]::Box($bytes, $plate.Width, $plate.Height)
$cleared = [BrandMark]::Cleared($bytes, $plate.Width, $plate.Height)

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$plate.UnlockBits($data)

if ($box[2] -lt 0) {
  throw "The cutout left nothing opaque behind — the tolerance ($BackgroundTolerance) ate the logo. Nothing was written."
}
$clearedPct = [Math]::Round(100 * $cleared / ($plate.Width * $plate.Height))
if ($clearedPct -lt 5) {
  throw "Only $clearedPct% of the master was recognised as background — the tolerance is too tight for this artwork, and the mark would still show its square. Nothing was written."
}

# Crop to the artwork itself — with the background gone, the interesting
# rectangle is the mark, not the master's square.
$margin = [int]([Math]::Max($plate.Width, $plate.Height) * 0.02)
$x0 = [Math]::Max(0, $box[0] - $margin); $y0 = [Math]::Max(0, $box[1] - $margin)
$x1 = [Math]::Min($plate.Width - 1, $box[2] + $margin); $y1 = [Math]::Min($plate.Height - 1, $box[3] + $margin)
$crop = New-Object System.Drawing.Rectangle $x0, $y0, ($x1 - $x0 + 1), ($y1 - $y0 + 1)
$trimmed = $plate.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$mark = Resize-Width $trimmed $MarkWidth
$markPath = Join-Path $OutDir 'icon-mark.png'
$mark.Save($markPath, [System.Drawing.Imaging.ImageFormat]::Png)

""
"{0,-22} {1}x{2}  {3,8:N0} bytes   {4}" -f 'icon-mark.png', $mark.Width, $mark.Height, (Get-Item $markPath).Length, (AlphaReport $mark)
"  background keyed out: $clearedPct% of the master; artwork box ${x0},${y0} to ${x1},${y1}"
"  this one is the INSIDE-the-app mark: no square, no background, the page shows through."

$mark.Dispose(); $trimmed.Dispose(); $plate.Dispose()
$masterBmp.Dispose(); $master.Dispose()
""
"Now bump CACHE_NAME in sw.js — the icons are precached under it."

