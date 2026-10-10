# make-brand-assets.ps1 — derive the sign-in panel's art from the brand masters.
#
#   pwsh -File tools/make-brand-assets.ps1
#
# Why PowerShell and not a node script, and why System.Drawing: exactly the
# reasoning at the top of tools/make-icons.ps1. This repo has no build step and no
# npm access, so there is no sharp/jimp to reach for; System.Drawing is in-box on
# Windows and needs no download. The flood-fill keyer below is the same one
# make-icons.ps1 uses for icon-mark.png, for the same reason it is written as
# compiled C# rather than a PowerShell loop: it is 4.2 million pixels per pass.
#
# ── What this produces, and from what ─────────────────────────────────────────
#
# The masters live in `Brand Elements I-PASSBOOK/`, which is GITIGNORED: 24 MB of
# unoptimised presentation art is not what a clone of a public repo should carry.
# So the masters are the input to this script and are never published; what IS
# published is the two derived files below.
#
#   assets/brand-panel-dark.png   the lockup, background keyed out, neutral ink
#                                 remapped light — for the always-dark panel
#   assets/brand-panel-light.png  the lockup, background keyed out, ink as drawn
#                                 — for the panel that follows the page ground
#   assets/brand-intro.mp4        the panel's video, byte-copied from the master
#
# The owner asked to SEE both grounds before choosing, so both are generated and
# tools/render-themes.mjs photographs them. The loser is deleted, along with its
# PNG, once he has looked. Nothing here decides which one ships.
#
# ── TWO THINGS THAT ARE LOAD-BEARING, AND BOTH ARE INVISIBLE IF THEY BREAK ───
#
# 1. THE FULL SQUARE IS KEPT. This does NOT crop to the artwork's bounding box,
#    unlike make-icons.ps1's icon-mark.png, and the reason is the heartbeat.
#    The three pulsing nodes in the sign-in panel are positioned as PERCENTAGES
#    OF THIS IMAGE (index.html / base.css: .hb-center 50%/50.5%, .hb-tip
#    74%/31.8%, .hb-joint 39.5%/27%). Those numbers were measured against the
#    master's 2048x2048 canvas by the owner. Cropping to the art would move the
#    canvas under them and silently slide all three nodes off the mark — with no
#    error anywhere, and a screenshot that still looks like a logo.
#
# 2. THE GRIDLINES SURVIVE THE KEY. Option A is called "The Telemetry Grid" and
#    the blueprint annotations ARE the name: the thin grey rules, the [0.5x]
#    dimension brackets and the crosshair registration marks. The background
#    tolerance below is therefore set in the GAP between the white field and that
#    grey — the field is 255, the annotations measure in the 170s, so 48 clears
#    the field and stops at the annotations with room on both sides. Raising it
#    past ~80 eats the telemetry grid and leaves a plain logo, which is Option A
#    with its own name removed.
#
# ── The white fringe, and what is done about it ───────────────────────────────
#
# Keying leaves alpha 0 but the RGB UNDER the cleared pixels is still white. Any
# resample — and this tool resamples, and so does the browser — blends that white
# into the surviving edge, and on a dark panel a white halo around every letter is
# exactly the artefact that reads as "the logo was cut out badly". So cleared
# pixels have their RGB stamped with the artwork's own mean ink colour before the
# resize. The fringe then blends toward ink, not toward white.

param(
  [string]$Source      = (Join-Path $PSScriptRoot '..\Brand Elements I-PASSBOOK\Option A The Telemetry Grid & Sub-Branding Variant.png'),
  [string]$VideoSource = (Join-Path $PSScriptRoot '..\Brand Elements I-PASSBOOK\Video.mp4'),
  [string]$OutDir      = (Join-Path $PSScriptRoot '..\assets'),
  [int]$Width          = 1280,
  [double]$InkLift     = 1.1
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source))      { throw "No brand master at $Source" }
if (-not (Test-Path $VideoSource)) { throw "No brand video at $VideoSource" }

function New-Canvas([int]$w, [int]$h) {
  New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Set-Quality($g) {
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

# Halve while the edge is more than twice the target, then one finishing pass —
# the same stepped resample as the icons above, and for the same reason: a single
# bicubic jump from 2048 straight to 1280 softens the monogram's edges.
function Resize-Square($src, [int]$size) {
  $work = $src
  while ($work.Width -gt ($size * 2)) {
    $half = [int]($work.Width / 2)
    $next = New-Canvas $half $half
    $g = [System.Drawing.Graphics]::FromImage($next)
    Set-Quality $g
    $g.DrawImage($work, 0, 0, $half, $half)
    $g.Dispose()
    if ($work -ne $src) { $work.Dispose() }
    $work = $next
  }
  $final = New-Canvas $size $size
  $g = [System.Drawing.Graphics]::FromImage($final)
  Set-Quality $g
  $g.DrawImage($work, 0, 0, $size, $size)
  $g.Dispose()
  if ($work -ne $src) { $work.Dispose() }
  return $final
}

# ── The keyer and the remap, compiled ─────────────────────────────────────────
# Conservative C# (no interpolation, no expression bodies) so this compiles under
# Windows PowerShell 5.1's csc as well as pwsh's Roslyn — the same constraint
# make-icons.ps1's C# is written to.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;

public static class BrandPanel
{
    // Zero the alpha of everything background-coloured AND reachable from the
    // border, feather the rim that leaves behind, then stamp the cleared pixels
    // with the artwork's own mean ink so no resample can pull white into an edge.
    //
    // Then, for the dark ground only, remap the NEUTRAL ink to light while leaving
    // the brand yellow exactly as drawn.
    public static void Derive(byte[] px, int w, int h, int tol, bool dark, double lift)
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

        // The surviving ink's mean colour, so the cleared pixels can be stamped
        // with something that blends in the right direction.
        long sr = 0, sg = 0, sb = 0, n = 0;
        for (int p = 0; p < w * h; p++)
        {
            if (clear[p]) continue;
            int i = p * 4;
            sr += px[i + 2]; sg += px[i + 1]; sb += px[i]; n++;
        }
        byte mr = n > 0 ? (byte)(sr / n) : (byte)128;
        byte mg = n > 0 ? (byte)(sg / n) : (byte)128;
        byte mb = n > 0 ? (byte)(sb / n) : (byte)128;

        for (int p = 0; p < w * h; p++)
        {
            if (!clear[p]) continue;
            int i = p * 4;
            px[i] = mb; px[i + 1] = mg; px[i + 2] = mr;
            px[i + 3] = 0;
        }

        // The pixels the fill stopped ON are the anti-aliased rim. Left at full
        // opacity they read as a pale halo of the field colour, so their alpha
        // follows how far they are from it.
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

        if (!dark) return;

        // ── The dark-ground remap ────────────────────────────────────────────────
        // The brand yellow is a FILL and is kept exactly as drawn — see the header
        // of industrial.css for why it is never repainted or used for text.
        //
        // Everything else in this artwork is neutral: the navy of the wordmark and
        // the monogram's shaded faces, and the grey of the telemetry annotations.
        // All of it is remapped by LUMINANCE about white, which lifts the navy to a
        // light grey (a near-black wordmark is invisible on a dark panel) and pushes
        // the grey annotations DOWN, so they stay the faint texture they are in the
        // owner's own mockup rather than competing with the mark they annotate.
        // That is what makes the single factor `lift` do both jobs at once.
        for (int p = 0; p < w * h; p++)
        {
            int i = p * 4;
            if (px[i + 3] == 0) continue;
            int r = px[i + 2], g = px[i + 1], bl = px[i];
            if (r - bl > 40 && g - bl > 40) continue;          // brand yellow — untouched
            double lum = 0.299 * r + 0.587 * g + 0.114 * bl;
            int v = (int)Math.Round(255.0 - lift * lum);
            if (v < 0) v = 0; else if (v > 255) v = 255;
            px[i] = (byte)v; px[i + 1] = (byte)v; px[i + 2] = (byte)v;
        }
    }

    // What share of the panel is see-through. A key that quietly failed reads as
    // 0% and the panel would still carry a white square; one that ate the artwork
    // reads as far too high. Either way the number is the check — the page shows
    // the failure as "the logo looks fine" on a light ground and wrong on a dark one.
    public static double ClearedShare(byte[] px, int w, int h)
    {
        long c = 0;
        for (int p = 0; p < w * h; p++) if (px[p * 4 + 3] == 0) c++;
        return (double)c / (w * h);
    }

    // Bounding box of the ink that survived, as {x0, y0, x1, y1}. Reported so the
    // owner can see the art has NOT been cropped — it is the master's own canvas,
    // which is what the heartbeat coordinates are measured against.
    public static int[] InkBox(byte[] px, int w, int h)
    {
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (px[(y * w + x) * 4 + 3] == 0) continue;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
        return new int[] { minX, minY, maxX, maxY };
    }

    static void Push(Stack<int> s, bool[] clear, bool[] bgish, int p)
    {
        if (!clear[p] && bgish[p]) { clear[p] = true; s.Push(p); }
    }
}
'@

# In the gap between the white field (255) and the telemetry annotations (~170).
# See point 2 in the header — this number is what keeps Option A's own name.
$BackgroundTolerance = 48

# ── Derive both grounds from one plate ────────────────────────────────────────
# The key runs ONCE, at master resolution, and its result is copied for the second
# ground. Running it twice would be two chances for the two grounds to disagree
# about where the artwork ends.

$master = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$masterBmp = New-Object System.Drawing.Bitmap $master
if ($masterBmp.Width -ne $masterBmp.Height) {
  throw "The master is $($masterBmp.Width)x$($masterBmp.Height). This tool keeps the canvas square because the heartbeat nodes are positioned as percentages of it. A non-square master means the coordinates the owner measured no longer apply — stop and re-measure with him."
}

$plate = New-Canvas $masterBmp.Width $masterBmp.Height
$g = [System.Drawing.Graphics]::FromImage($plate)
Set-Quality $g
$g.DrawImage($masterBmp, 0, 0, $masterBmp.Width, $masterBmp.Height)
$g.Dispose()

$all = New-Object System.Drawing.Rectangle 0, 0, $plate.Width, $plate.Height
$data = $plate.LockBits($all, [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $plate.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

"master: $(Split-Path $Source -Leaf)"
"        $($masterBmp.Width)x$($masterBmp.Height), square — the heartbeat coordinates hold"
""

$results = [ordered]@{}

foreach ($ground in @(
    @{ Name = 'brand-panel-dark.png';  Dark = $true  },
    @{ Name = 'brand-panel-light.png'; Dark = $false }
)) {
  # A private copy per ground: Derive is destructive and the dark remap rewrites
  # the RGB of every opaque pixel.
  $work = New-Object byte[] $bytes.Length
  [Array]::Copy($bytes, $work, $bytes.Length)

  [BrandPanel]::Derive($work, $plate.Width, $plate.Height, $BackgroundTolerance, $ground.Dark, $InkLift)

  $cleared = [BrandPanel]::ClearedShare($work, $plate.Width, $plate.Height)
  $box     = [BrandPanel]::InkBox($work, $plate.Width, $plate.Height)

  if ($box[2] -lt 0) {
    throw "The key left nothing opaque behind — the tolerance ($BackgroundTolerance) ate the whole lockup. Nothing was written."
  }
  if ($cleared -lt 0.20) {
    throw "Only $([Math]::Round(100*$cleared))% of the master was recognised as background. The tolerance is too tight for this artwork, so the panel would still show a white square. Nothing was written."
  }
  if ($cleared -gt 0.92) {
    throw "$([Math]::Round(100*$cleared))% of the master was keyed out, which is more than the field and its annotations — the fill has eaten the lockup. Nothing was written."
  }

  $stamped = New-Canvas $plate.Width $plate.Height
  $d2 = $stamped.LockBits($all, [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
                          [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  # WriteOnly needs the whole buffer; the stride padding is left as the canvas's
  # own zeroes, which is what a fresh bitmap already holds.
  [System.Runtime.InteropServices.Marshal]::Copy($work, 0, $d2.Scan0, [Math]::Min($work.Length, $d2.Stride * $stamped.Height))
  $stamped.UnlockBits($d2)

  $final = Resize-Square $stamped $Width
  $path = Join-Path $OutDir $ground.Name
  $final.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $results[$ground.Name] = [ordered]@{
    Bytes   = (Get-Item $path).Length
    Width   = $final.Width
    Cleared = $cleared
    Box     = $box
  }

  $kb = [Math]::Round((Get-Item $path).Length / 1KB)
  "{0,-24} {1}x{1}  {2,7} KB   keyed out {3}% of the master" -f $ground.Name, $final.Width, $kb, [Math]::Round(100*$cleared)
  "  ink survives at $($box[0]),$($box[1]) to $($box[2]),$($box[3]) of $($plate.Width) — NOT cropped, so the heartbeat percentages still land"

  $final.Dispose(); $stamped.Dispose()
}

$plate.UnlockBits($data)
$plate.Dispose(); $masterBmp.Dispose(); $master.Dispose()

# ── The video ────────────────────────────────────────────────────────────────
# A byte copy, not a transcode. It is already H.264 + faststart (moov before
# mdat), so it begins playing without the whole file — re-encoding it would only
# risk losing that and would need ffmpeg, which this repo does not have.
$videoOut = Join-Path $OutDir 'brand-intro.mp4'
Copy-Item -LiteralPath $VideoSource -Destination $videoOut -Force
""
"{0,-24} {1,7} KB   byte copy of $(Split-Path $VideoSource -Leaf)" -f 'brand-intro.mp4', [Math]::Round((Get-Item $videoOut).Length / 1KB)

""
"Both grounds were written. The owner asked to see them before choosing —"
"photograph them with:"
""
"  node tools/render-fixture.mjs"
"  node tools/render-themes.mjs `"$env:TEMP/ipassbook-render/landing.html`" --width 1440"
""
"Delete the losing PNG once he has looked, and point .brand-still at the winner."
"Neither PNG nor the video is precached: bump CACHE_NAME in sw.js and add"
"assets/brand-intro.mp4 to SERVED in tools/deploy-ghpages.mjs, and move the two"
"retired intro_ipassbookv2*.mp4 cuts into PRUNE there."
