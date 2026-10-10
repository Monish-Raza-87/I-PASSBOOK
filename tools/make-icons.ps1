# make-icons.ps1 — regenerate the app icon set from the brand masters.
#
#   pwsh -File tools/make-icons.ps1
#
# Why PowerShell and not a node script: this repo has no build step and no npm
# access (see tools/serve-local.mjs for the same constraint), so there is no
# sharp/jimp to reach for. System.Drawing is in-box on Windows, needs no
# download, and is what generated the icons that ship today.
#
# ── THERE ARE TWO MASTERS, AND THEY ARE NOT THE SAME PICTURE ──────────────────
#
# On 2026-10-10 the owner delivered two files and named their slots himself:
# "Mobile and web browser tab logo are kept in `Brand Elements I-PASSBOOK` by file
# name Mobile Logo and Browser Tab Logo." Read as a pair, the difference between
# them is the whole design:
#
#   * `Browser Tab Logo.png`  -> assets/icon-master.png        the mark ALONE
#   * `Mobile Logo.png`       -> assets/icon-master-plate.png  the mark plus the
#                                                              TELEMETRY GRID and
#                                                              CROSSHAIRS, on an
#                                                              opaque near-white field
#
# That was not obvious from the names, and it is not visible in a thumbnail: the
# two share a canvas ratio to four decimals (478x522 and 741x809 are the same
# composition at 1.55x), so they look like one file exported twice. Rendering the
# difference is what settled it — tools/.cache/master-diff.png, 2026-10-10, three
# panels: the tab master with no hairlines on it at all, the plate master framed by
# them, and the per-pixel difference lighting the frame up. **Check that picture
# before changing anything here.**
#
# So the split this script builds is not arbitrary, it is the one the artwork asks
# for:
#
#   * the CLEAN mark goes everywhere the app draws the brand itself — the sidebar,
#     the sign-in panel, the tab, the handoff page. At the sizes those use (16px in
#     a tab strip, 26px in the sidebar) the grid is sub-pixel, so all it can do is
#     dirty the mark. This is the same fault the owner had already reported on the
#     handoff page, where the old mark's crosshairs "read as dirt" at 56px.
#   * the FRAMED mark goes on the three square tiles, where an OS draws it at 180
#     and 512 and the grid is legible and is the point of the variant.
#
# ── Why the masters in the repo are copies ────────────────────────────────────
#
# `Brand Elements I-PASSBOOK/` is untracked and gitignored (24 MB of master art has
# no business in a public repo, and untracked files block tools/deploy-ghpages.mjs),
# so a clone with no access to that folder could not regenerate a single icon. The
# two files in assets/ are the owner's originals verbatim — no resample, nothing to
# go stale. To refresh them, copy them over and re-run this.
#
# ── No colour key any more ────────────────────────────────────────────────────
 #
# There used to be one, and it was the most delicate thing in this file: the 2025
# mark was a lockup on a flat field with its monogram and script in the SAME COLOUR
# as that field, so only a border-seeded flood fill could tell them apart — and it
# leaked through the knockout band and had to be patched with a `RestoreDisc`. All
# of it is gone, and not because the key got better: `icon-master.png` arrives with
# an alpha channel already (60% clear, 39% opaque, 2% edge ramp — measured,
# tools/.cache/master-probe.ps1). A key over artwork that is already keyed would
# only add the failure mode this file spent a year working around.
#
# ⚠ What replaced it is a crop, and a crop is the OTHER silent failure: the wrong
# rectangle still produces a valid PNG of the right width, showing a piece of the
# artwork to nobody who does not look. So the crop is measured off the alpha at run
# time rather than hardcoded, and the checks below refuse to write if it found
# nothing or found everything.

param(
  [string]$TabMaster   = (Join-Path $PSScriptRoot '..\assets\icon-master.png'),
  [string]$PlateMaster = (Join-Path $PSScriptRoot '..\assets\icon-master-plate.png'),
  [string]$OutDir      = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

foreach ($m in @($TabMaster, $PlateMaster)) {
  if (-not (Test-Path $m)) { throw "No master image at $m" }
}

# name -> edge length. 192 and 512 are what the manifest declares and what
# Android/Chrome want for the home screen; 180 is the exact size iOS asks for by
# file name.
$targets = [ordered]@{
  'icon-192.png'         = 192
  'icon-512.png'         = 512
  'apple-touch-icon.png' = 180
}

# The clean mark, sized by its width. 512 is what the app's own CSS assumes
# (`.brand-mark img` sizes by height and lets the width follow) and what
# smoke-shell.mjs asserts.
$MarkWidth = 512

# Tolerance for "this pixel is artwork and not the plate", used only to sanity
# check the plate master. The plate is a near-white field with +/-3 levels of
# export noise — measured, not assumed (tools/.cache/master-probe.ps1 found 30
# distinct colours on the border ring, spanning 252..255) — so a threshold well
# above that separates artwork from noise.
$PlateTolerance = 24

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
# single bicubic pass straight down to 180 softens the hairlines noticeably;
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

# The plate master is 741x809 — the same composition as the tab master, so NOT
# square, and forcing it into a square would squash the monogram by 9%. It is
# centred instead, and the two side bands are filled by EDGE-CLAMPING the master's
# own outermost column across them rather than by a flat fill of the sampled plate
# colour. A flat fill leaves a 255-vs-253 step down both edges: invisible on a
# white page, a measurable seam on a coloured home screen, and exactly the kind of
# one-pixel lie a 512px icon is asked about. Clamping has nothing to leave a seam
# between, because the pixels either side of the join are the same plate.
function New-PlatedSquare($src, $pr, $pg, $pb) {
  $side = [Math]::Max($src.Width, $src.Height)
  $sq = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($sq)
  Set-Quality $g
  $g.Clear([System.Drawing.Color]::FromArgb(255, $pr, $pg, $pb))
  $ox = [int](($side - $src.Width) / 2)
  $oy = [int](($side - $src.Height) / 2)
  $g.DrawImage($src, $ox, $oy, $src.Width, $src.Height)
  $PX = [System.Drawing.GraphicsUnit]::Pixel
  if ($ox -gt 0) {
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, $oy, $ox, $src.Height),
                       0, 0, 1, $src.Height, $PX)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle ($ox + $src.Width), $oy, $ox, $src.Height),
                       ($src.Width - 1), 0, 1, $src.Height, $PX)
  }
  if ($oy -gt 0) {
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle $ox, 0, $src.Width, $oy),
                       0, 0, $src.Width, 1, $PX)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle $ox, ($oy + $src.Height), $src.Width, $oy),
                       0, ($src.Height - 1), $src.Width, 1, $PX)
  }
  $g.Dispose()
  return $sq
}

function Get-Bytes($bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)
  return @($bytes, $stride)
}

# Measure the finished tile, so the script reports something a human can check
# rather than just "wrote a file". Ink = luminance below 128 — which for this
# artwork is the NAVY only, the yellow being bright. Its box as a share of the
# icon's width tells you whether the mark is the size you intended.
function InkReport($bmp) {
  $r = Get-Bytes $bmp; $bytes = $r[0]; $stride = $r[1]
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
# inks. A crop that quietly failed reads as 0% transparent; one that ate the
# artwork reads as transparent nearly everywhere.
function MarkReport($bmp) {
  $r = Get-Bytes $bmp; $bytes = $r[0]; $stride = $r[1]
  $clear = 0; $solid = 0; $yellow = 0; $navy = 0
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $i = $y * $stride + $x * 4
      $b = $bytes[$i]; $g = $bytes[$i + 1]; $r2 = $bytes[$i + 2]; $a = $bytes[$i + 3]
      if ($a -eq 0) { $clear++; continue }
      if ($a -lt 250) { continue }
      $solid++
      if ($r2 -gt 200 -and $g -gt 150 -and $b -lt 120) { $yellow++ }
      elseif ($r2 -lt 90 -and $g -lt 90 -and $b -lt 110 -and $b -gt $r2) { $navy++ }
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

# ══ The two masters ═══════════════════════════════════════════════════════════

$tabImg  = [System.Drawing.Image]::FromFile((Resolve-Path $TabMaster))
$tabBmp  = New-Object System.Drawing.Bitmap $tabImg
$plateImg = [System.Drawing.Image]::FromFile((Resolve-Path $PlateMaster))
$plateBmp = New-Object System.Drawing.Bitmap $plateImg

"tab master   : $(Split-Path $TabMaster -Leaf)   $($tabBmp.Width)x$($tabBmp.Height)"
"plate master : $(Split-Path $PlateMaster -Leaf)   $($plateBmp.Width)x$($plateBmp.Height)"
""

# The two files share one composition, which is what makes them a pair and not two
# unrelated exports. Pinning it catches the one edit that would quietly break this
# script's premise: a master replaced by artwork framed differently, so that the
# mark and the tiles stop being the same design at two scales.
$ratioTab   = $tabBmp.Width / $tabBmp.Height
$ratioPlate = $plateBmp.Width / $plateBmp.Height
if ([Math]::Abs($ratioTab - $ratioPlate) -gt 0.005) {
  throw ("The two masters are no longer the same composition: aspect {0:N4} vs {1:N4}. They are supposed to be one design at two scales, one clean and one framed by the telemetry grid. If the owner has delivered genuinely new artwork, replace them here rather than letting the mark and the tiles drift apart. Nothing was written." -f $ratioTab, $ratioPlate)
}
"masters agree on composition: aspect {0:N4} vs {1:N4}" -f $ratioTab, $ratioPlate

# The plate, read off the plate master's own corner rather than written down.
$pc = $plateBmp.GetPixel(0, 0)
$pr = [int]$pc.R; $pg = [int]$pc.G; $pb = [int]$pc.B
if ($pc.A -lt 250) {
  throw "The plate master's corner is not opaque (alpha $($pc.A)) — it is not the plated file this script expects. Nothing was written."
}
"plate colour : rgb($pr,$pg,$pb), sampled from the plate master's corner"

# The plate master must actually carry artwork. "differs from the plate by more
# than the export noise" is the only test that can see it, since every pixel of it
# is opaque and an alpha test would call the whole canvas ink.
$inkCols = 0
$plateProbe = 0
for ($x = 0; $x -lt $plateBmp.Width; $x += 4) {
  for ($y = 0; $y -lt $plateBmp.Height; $y += 4) {
   $p = $plateBmp.GetPixel($x, $y)
    $d = [Math]::Max([Math]::Abs($p.R - $pr), [Math]::Max([Math]::Abs($p.G - $pg), [Math]::Abs($p.B - $pb)))
    if ($d -gt $PlateTolerance) { $inkCols++ }
    $plateProbe++
  }
}
$inkShare = [Math]::Round(100 * $inkCols / $plateProbe)
if ($inkShare -lt 3) {
  throw ("Only $inkShare% of the plate master differs from its own plate colour — it is blank, or its corner is not the field. Nothing was written.")
}
"plate carries artwork : $inkShare% of sampled pixels differ from the plate"
""

# ══ The clean mark, from the tab master — measured and checked FIRST ══════════
#
# ⚠ This block runs BEFORE the three tiles are written, and the order is the point.
# Every refusal below ends "Nothing was written", and with the tiles first that
# sentence was false: a mark that lost its bolt still left three freshly-written
# square icons on disk, which the next `git add` would carry into a release. The
# tiles are the output that LOOKS right and is not, so nothing is saved until both
# halves have passed every check.

# The crop is MEASURED, not hardcoded. The tab master arrives already keyed out, so
# its own alpha says where the artwork is, and a measurement cannot fall out of date
# the way the four numbers this replaced could.
$tabBytes = Get-Bytes $tabBmp; $b = $tabBytes[0]; $st = $tabBytes[1]
$minX = $tabBmp.Width; $maxX = -1; $minY = $tabBmp.Height; $maxY = -1
for ($y = 0; $y -lt $tabBmp.Height; $y++) {
  for ($x = 0; $x -lt $tabBmp.Width; $x++) {
    if ($b[$y * $st + $x * 4 + 3] -lt 128) { continue }
    if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
    if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
  }
}

if ($maxX -lt 0) {
  throw "The tab master has no opaque pixels at all — it is blank, or it is not the keyed-out file. Nothing was written."
}
$inkW = $maxX - $minX + 1
$inkH = $maxY - $minY + 1

# A crop that found nothing, or found the whole canvas, is a crop that learned
# nothing. Both are the shapes a silent failure takes: the first ships an empty
# PNG, the second ships the file unchanged and calls it cropped.
if ($inkW -lt ($tabBmp.Width * 0.30)) {
  throw ("The tab master's ink is only $inkW of $($tabBmp.Width) px wide. Either the alpha is broken or this is not the clean mark. Nothing was written.")
}
if ($inkW -ge $tabBmp.Width -and $inkH -ge $tabBmp.Height) {
  throw "The tab master's ink fills its whole canvas — it has no alpha to crop against. Nothing was written."
}

$crop = New-Object System.Drawing.Rectangle $minX, $minY, $inkW, $inkH
$trimmed = $tabBmp.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$mark = Resize-Width $trimmed $MarkWidth
$markPath = Join-Path $OutDir 'icon-mark.png'
$report = MarkReport $mark

# Both inks have to survive. The yellow is the one that can go missing without the
# mark looking broken: it is the bolt, and a mark that lost it is still a
# recognisable shape, so nothing about the file's size or dimensions would say so.
if ($report[3] -lt ($report[2] * 0.10)) {
  throw ("Only {0}% of the mark's opaque pixels are brand yellow. The bolt did not survive the crop. Nothing was written." -f [Math]::Round(100 * $report[3] / [Math]::Max(1, $report[2])))
}
if ($report[4] -lt ($report[2] * 0.05)) {
  throw ("Only {0}% of the mark's opaque pixels are navy — the crop is probably not on the monogram. Nothing was written." -f [Math]::Round(100 * $report[4] / [Math]::Max(1, $report[2])))
}
# ...and the background has to actually be gone, or the mark is still a tile.
$clearPct = [Math]::Round(100 * $report[1] / $report[5])
if ($clearPct -lt 20 -or $clearPct -gt 70) {
  throw "The mark is $clearPct% transparent, which is neither a keyed-out mark nor a plausible one. Nothing was written."
}

# Both halves have passed. Only now are the tiles written — see the note above the
# mark's measurement for why this loop is not where it used to be.
$square = New-PlatedSquare $plateBmp $pr $pg $pb

foreach ($name in $targets.Keys) {
  $size = $targets[$name]
  $icon = Resize-To $square $size
  $path = Join-Path $OutDir $name
  $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  "{0,-22} {1}x{1}  {2,8:N0} bytes   {3}" -f $name, $size, (Get-Item $path).Length, (InkReport $icon)
  $icon.Dispose()
}

$mark.Save($markPath, [System.Drawing.Imaging.ImageFormat]::Png)
""
"{0,-22} {1}x{2}  {3,8:N0} bytes   {4}" -f 'icon-mark.png', $mark.Width, $mark.Height, (Get-Item $markPath).Length, $report[0]
"  cropped to the tab master's own ink: x{0}..{1} y{2}..{3} of {4}x{5}, i.e. {6}x{7}" -f `
  $minX, $maxX, $minY, $maxY, $tabBmp.Width, $tabBmp.Height, $inkW, $inkH
"  no colour key ran: this artwork arrives with its alpha already in it."
"  this one is the INSIDE-the-app mark and the TAB: no square, no background, no"
"  telemetry grid, the page shows through. It is used as drawn in light mode."
"  Dark mode does NOT invert it — see the note in base.css: inverting this artwork"
"  turns the brand yellow blue, which is not a brand."

$mark.Dispose(); $trimmed.Dispose(); $square.Dispose()
$plateBmp.Dispose(); $plateImg.Dispose(); $tabBmp.Dispose(); $tabImg.Dispose()
""
"Now bump CACHE_NAME in sw.js — the icons are precached under it."
