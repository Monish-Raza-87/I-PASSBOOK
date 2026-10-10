# make-icons.ps1 — regenerate the app icon set from the brand master.
#
#   pwsh -File tools/make-icons.ps1
#
# Why PowerShell and not a node script: this repo has no build step and no npm
# access (see tools/serve-local.mjs for the same constraint), so there is no
# sharp/jimp to reach for. System.Drawing is in-box on Windows, needs no
# download, and is what generated the icons that ship today.
#
# ── The master changed, and this file changed with it ────────────────────────
#
# Everything below used to be built from `assets/icon-master.jpeg`, the 2025
# disc-and-script mark. On 2026-10-10 the owner replaced the brand with **Option A
# The Telemetry Grid & Sub-Branding Variant** and said, in his own words: "I can
# see the icon of our app in browser tab is still not updated, we need to use our
# same logo everywhere which is Option A". Asked whether the icon should be the
# monogram or the whole lockup he answered **"The full lockup."** So the source is
# now `assets/icon-master.png` and the three square icons are the whole lockup,
# annotations and all — the `[0.5x]` dimension marks and crosshairs are part of
# what that variant IS, not dirt to be cleaned off it.
#
# ── Why the master in the repo is 1024 and not the owner's 2048 ───────────────
#
# The delivered master is 2048x2048 RGBA and 4.7 MB. `Brand Elements I-PASSBOOK/`
# is untracked and gitignored (24 MB of master art has no business in a public
# repo, and untracked files block tools/deploy-ghpages.mjs), so a clone with no
# access to that folder could not regenerate a single icon. The committed master
# is therefore the same artwork resampled to 1024x1024 — 1.2 MB — which is the
# largest size anything here asks for: 512 for the Android/Chrome tile, and 505
# for the mark's crop. Nothing downstream needs a pixel the 1024 does not carry.
#
# ── The borderless mark, and why it is a COLOUR key and not a flood fill ──────
#
# The square icons keep their background on purpose: a home-screen tile is square
# and iOS/Android mask it themselves. Inside the app it is the opposite — the
# owner's words about the old one were that it "comes in a shape of square" and
# should "feel real embedded into the page". So this also writes
# assets/icon-mark.png: the mark with its background made TRANSPARENT, for the
# sidebar, the sign-in panel and the emailed door page.
#
# The old mark needed a border-seeded FLOOD FILL here, because its monogram and
# its "Passbook" script were the SAME COLOUR as the background they sat on, and
# only connectivity could tell them apart — and that fill needed a `RestoreDisc`
# afterwards, because it leaked into the circle through the knockout band behind
# the script and punched the artwork out. None of that survives this change:
#
#   * Option A's field is `#fffffd`, flat within a few levels, and its artwork is
#     three SOLID inks — navy `#2b2b3a`, brand yellow `#f8c808`, and the darker
#     yellow `#b88900` facet on the bolt. Every one of them is 200+ away from the
#     field. So the background is separable by colour alone, and a flood fill
#     would only introduce the failure mode it once had to be patched for.
#   * There is no disc and no knockout, so there is nothing to restore. The
#     `RestoreDisc` geometry is specific to the old circle and is deleted rather
#     than left dormant — a dormant branch keyed to a mark that no longer exists
#     is a trap for whoever reads this next.
#
# ── What the key deliberately KEEPS ──────────────────────────────────────────
#
# The blueprint gridlines and the crosshairs are drawn ON TOP of the artwork in
# the master, in a near-black hairlines grey. They are further from the field
# than the navy is, so a colour key keeps them — and that is the right answer,
# not an oversight: the telemetry grid is the point of this variant. At the 26px
# the sidebar draws the mark they are sub-pixel and vanish on their own; at 512
# they read as the spec-sheet hairlines the design is built from.
#
# The key is an ALPHA RAMP, not a cut, so the anti-aliased edge of every shape
# keeps its blend — a hard threshold leaves a one-pixel staircase that is
# invisible at 60px and obvious at 512. Colours are NOT snapped to the nearest
# ink, because the blend of an ink with this field composites correctly on the
# light page by construction; on the dark page the filter below does not care.

param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\icon-master.png'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "No master image at $Source" }

# name -> edge length. 192 is the favicon; 512 is what Android/Chrome want for the
# home screen; 180 is the exact size iOS asks for by file name.
$targets = [ordered]@{
  'icon-192.png'         = 192
  'icon-512.png'         = 512
  'apple-touch-icon.png' = 180
}

# ── The mark's crop, in the 1024px master's pixels ────────────────────────────
#
# The master is a stacked lockup: "IND…RONES" on top, the big angular P in the
# middle, "PASSBOOK" and the strap line below. Only the P is the mark — the three
# in-app placements all sit it BESIDE the name already spelled out in text, so
# handing them the full lockup would say the brand twice.
#
# These four numbers were MEASURED off the 2048 master, not guessed: a per-row and
# per-column ink-density scan (tools/.cache probes, 2026-10-10) put the P's ink at
# x 566..1541, y 488..1583, and the box below is that, padded ~5px a side and
# halved with everything else. They are not self-locating, so the run below
# ASSERTS that the crop still lands on the mark — see the checks after the key. If
# the master is ever replaced with a differently-composed lockup, this script
# stops instead of shipping the wordmark, or the strap, as "the mark".
$MarkBox = @{ X = 280; Y = 240; W = 505; H = 555 }
$MarkWidth = 512

# What the key calls background. Measured, not chosen: the field is flat within ~5
# levels of itself and the nearest ink is 212 away. 12 sits below the field's own
# noise; the ramp tops out at 192, well under the navy's 212, so every solid ink
# pixel comes out fully opaque rather than merely dark.
$FieldTolerance = 12
$KeyRamp        = 180

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

# Halve while the current edge is more than twice the target, then finish. A
# single bicubic pass straight down to 180 softens the lockup's edges noticeably;
# stepping down to within 2x and finishing once keeps them crisp.
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

# Resample keeping the artwork's own aspect ratio instead of forcing a square.
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

# Measure the mark, so the script reports something a human can check rather
# than just "wrote a file". Ink = luminance below 128 — which for this artwork is
# the NAVY only, the yellow being bright. Its box as a share of the icon's width
# tells you whether the lockup is the size you intended.
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
  if ($maxX -lt 0) { return 'NO DARK INK AT ALL — the icon is blank' }
  $pct = [Math]::Round(100 * ($maxX - $minX + 1) / $bmp.Width)
  $cover = [Math]::Round(100 * $ink / ($bmp.Width * $bmp.Height), 1)
  return "dark ink spans $pct% of the width, covers $cover% of the icon"
}

# What share of the finished mark is see-through, and how much of it is the two
# inks rather than the hairlines. A key that quietly failed reads as 0%
# transparent; one that ate the artwork reads as transparent nearly everywhere.
function MarkReport($bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)

  $clear = 0; $solid = 0; $yellow = 0; $navy = 0
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $i = $y * $stride + $x * 4
      $b = $bytes[$i]; $g = $bytes[$i + 1]; $r = $bytes[$i + 2]; $a = $bytes[$i + 3]
      if ($a -eq 0) { $clear++; continue }
      if ($a -lt 250) { continue }
      $solid++
      if ($r -gt 200 -and $g -gt 150 -and $b -lt 120) { $yellow++ }
      elseif ($r -lt 90 -and $g -lt 90 -and $b -lt 110 -and $b -gt $r) { $navy++ }
    }
  }
  $total = $bmp.Width * $bmp.Height
  $line = "transparent {0}%, solid {1}% of which yellow {2}% navy {3}%" -f `
    [Math]::Round(100 * $clear / $total),
    [Math]::Round(100 * $solid / $total),
    [Math]::Round(100 * $yellow / [Math]::Max(1, $solid)),
    [Math]::Round(100 * $navy / [Math]::Max(1, $solid))
  return @($line, $clear, $solid, $yellow, $navy, $total)
}

# ── The key, compiled ────────────────────────────────────────────────────────
# Conservative C# (no interpolation, no expression bodies) so this compiles under
# Windows PowerShell 5.1's csc as well as pwsh's Roslyn.
Add-Type -TypeDefinition @'
public static class BrandMark
{
    // Set alpha from how far each pixel is from the field colour. `bg` is one
    // field pixel sampled from the master itself, never a literal — the field is
    // #fffffd here but nothing in this file should have to be edited if a
    // re-export shifts it by a level.
    //
    // Format32bppArgb is BGRA in memory, and so is the byte[] copied out of
    // LockBits, which is why every index below is +2 for red.
    public static void KeyField(byte[] px, int w, int h, int fr, int fg, int fb, int lo, int ramp)
    {
        for (int p = 0; p < w * h; p++)
        {
            int i = p * 4;
            int dr = px[i + 2] - fr; if (dr < 0) dr = -dr;
            int dg = px[i + 1] - fg; if (dg < 0) dg = -dg;
            int db = px[i]     - fb; if (db < 0) db = -db;
            int d = dr > dg ? dr : dg;
            if (db > d) d = db;

            int a = (int)(255.0 * (d - lo) / ramp);
            if (a < 0) a = 0; else if (a > 255) a = 255;
            px[i + 3] = (byte)a;
        }
    }

    // Bounding box of what is left after the key, as {x0, y0, x1, y1} — the cue
    // the checks below use to prove the crop still lands on the mark.
    public static int[] SolidBox(byte[] px, int w, int h)
    {
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (px[(y * w + x) * 4 + 3] < 128) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        return new int[] { minX, minY, maxX, maxY };
    }
}
'@

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

# A fresh 32bpp canvas: the master's alpha is opaque everywhere, and the key
# writes the alpha directly, so this is the copy the key works on.
$plate = New-Object System.Drawing.Bitmap $masterBmp.Width, $masterBmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($plate)
Set-Quality $g
$g.DrawImage($masterBmp, 0, 0, $masterBmp.Width, $masterBmp.Height)
$g.Dispose()

# The field, read off the master's own top-left pixel rather than written down.
$probe = $plate.GetPixel(0, 0)
$fr = [int]$probe.R; $fg = [int]$probe.G; $fb = [int]$probe.B

$crop = New-Object System.Drawing.Rectangle $MarkBox.X, $MarkBox.Y, $MarkBox.W, $MarkBox.H
$trimmed = $plate.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$all = New-Object System.Drawing.Rectangle 0, 0, $trimmed.Width, $trimmed.Height
$data = $trimmed.LockBits($all, [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
                          [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $trimmed.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

[BrandMark]::KeyField($bytes, $trimmed.Width, $trimmed.Height, $fr, $fg, $fb, $FieldTolerance, $KeyRamp)

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$trimmed.UnlockBits($data)

$box = [BrandMark]::SolidBox($bytes, $trimmed.Width, $trimmed.Height)

# ── The checks, which are the reason those four numbers can be hardcoded ─────
#
# A crop is a silent failure: the wrong rectangle still produces a valid PNG of
# the right width, and the page shows a wordmark or a strap line where the mark
# should be, only to the person who looks. So the crop has to prove it landed on
# the mark before anything is written.
if ($box[2] -lt 0) {
  throw "The key left nothing behind at all — the field it sampled ($fr,$fg,$fb) is not the artwork's background. Nothing was written."
}
$reachX = [Math]::Max($box[0], $trimmed.Width - 1 - $box[2])
$reachY = [Math]::Max($box[1], $trimmed.Height - 1 - $box[3])
if ($reachX -gt ($trimmed.Width * 0.06) -or $reachY -gt ($trimmed.Height * 0.06)) {
  throw ("The mark's crop is no longer tight to the artwork — the ink stops {0}px short horizontally and {1}px vertically inside a {2}x{3} crop. `$MarkBox in this script is measured for ONE lockup; re-measure it rather than shipping a crop that holds something else. Nothing was written." -f $reachX, $reachY, $trimmed.Width, $trimmed.Height)
}

$mark = Resize-Width $trimmed $MarkWidth
$markPath = Join-Path $OutDir 'icon-mark.png'
$report = MarkReport $mark

# Both inks have to survive. The yellow is the one that can go missing without the
# mark looking broken: it is the bolt, and a mark that lost it is still a
# recognisable shape, so nothing about the file's size or dimensions would say so.
if ($report[3] -lt ($report[2] * 0.10)) {
  throw ("Only {0}% of the mark's opaque pixels are brand yellow. The bolt did not survive the key. Nothing was written." -f [Math]::Round(100 * $report[3] / [Math]::Max(1, $report[2])))
}
if ($report[4] -lt ($report[2] * 0.05)) {
  throw ("Only {0}% of the mark's opaque pixels are navy — the crop is probably not on the monogram. Nothing was written." -f [Math]::Round(100 * $report[4] / [Math]::Max(1, $report[2])))
}
# ...and the background has to actually be gone, or the mark is still a tile.
$clearPct = [Math]::Round(100 * $report[1] / $report[5])
if ($clearPct -lt 20 -or $clearPct -gt 70) {
  throw "The mark is $clearPct% transparent, which is neither a keyed-out mark nor a plausible one. Nothing was written."
}

$mark.Save($markPath, [System.Drawing.Imaging.ImageFormat]::Png)
""
"{0,-22} {1}x{2}  {3,8:N0} bytes   {4}" -f 'icon-mark.png', $mark.Width, $mark.Height, (Get-Item $markPath).Length, $report[0]
"  field sampled at the master's corner: rgb($fr,$fg,$fb); keyed with a $FieldTolerance..$($FieldTolerance + $KeyRamp) ramp"
"  cropped $($MarkBox.X),$($MarkBox.Y) $($MarkBox.W)x$($MarkBox.H); ink reaches to $reachX px / $reachY px of the edge"
"  this one is the INSIDE-the-app mark: no square, no background, the page shows through."
"  light mode uses it as drawn. Dark mode does NOT invert it any more — see the note in"
"  base.css: inverting this artwork turns the brand yellow blue, which is not a brand."

$mark.Dispose(); $trimmed.Dispose(); $plate.Dispose()
$masterBmp.Dispose(); $master.Dispose()
""
"Now bump CACHE_NAME in sw.js — the icons are precached under it."
