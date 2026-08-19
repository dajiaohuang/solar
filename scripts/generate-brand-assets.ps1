Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot 'public\icons'
New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $bitmap.SetResolution(144, 144)
  return $bitmap
}

function Initialize-Graphics([System.Drawing.Bitmap]$bitmap) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rectangle,
    [System.Drawing.Color]::FromArgb(255, 25, 54, 62),
    [System.Drawing.Color]::FromArgb(255, 5, 8, 12),
    45
  )
  $graphics.FillRectangle($background, $rectangle)
  $background.Dispose()
  return $graphics
}

function Draw-Orbit([System.Drawing.Graphics]$graphics, [float]$centerX, [float]$centerY, [float]$radiusX, [float]$radiusY, [float]$angle, [float]$width) {
  $state = $graphics.Save()
  $graphics.TranslateTransform($centerX, $centerY)
  $graphics.RotateTransform($angle)
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(118, 115, 155, 165), $width)
  $graphics.DrawEllipse($pen, -$radiusX, -$radiusY, $radiusX * 2, $radiusY * 2)
  $pen.Dispose()
  $graphics.Restore($state)
}

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function New-AtlasIcon([int]$size, [string]$path, [bool]$maskable) {
  $bitmap = New-Canvas $size $size
  $graphics = Initialize-Graphics $bitmap
  $center = $size / 2
  $scale = if ($maskable) { 0.72 } else { 0.9 }
  Draw-Orbit $graphics $center $center ($size * 0.25 * $scale) ($size * 0.09 * $scale) -22 ($size / 128)
  Draw-Orbit $graphics $center $center ($size * 0.38 * $scale) ($size * 0.15 * $scale) -22 ($size / 150)
  $sunBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 227, 187, 104))
  $sunRadius = $size * 0.075 * $scale
  $graphics.FillEllipse($sunBrush, $center - $sunRadius, $center - $sunRadius, $sunRadius * 2, $sunRadius * 2)
  $sunBrush.Dispose()
  $planetBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 98, 208, 181))
  $planetRadius = $size * 0.025 * $scale
  $graphics.FillEllipse($planetBrush, $center + $size * 0.28 * $scale, $center - $size * 0.14 * $scale, $planetRadius * 2, $planetRadius * 2)
  $planetBrush.Dispose()
  $graphics.Dispose()
  Save-Png $bitmap $path
}

function New-AtlasOgImage([string]$path) {
  $bitmap = New-Canvas 1200 630
  $graphics = Initialize-Graphics $bitmap
  Draw-Orbit $graphics 410 315 245 90 -18 2
  Draw-Orbit $graphics 410 315 355 145 -18 2
  Draw-Orbit $graphics 410 315 470 205 -18 2
  $sunBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 227, 187, 104))
  $graphics.FillEllipse($sunBrush, 388, 293, 44, 44)
  $sunBrush.Dispose()
  $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 98, 208, 181))
  $graphics.FillEllipse($greenBrush, 690, 222, 18, 18)
  $greenBrush.Dispose()
  $redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 226, 118, 96))
  $graphics.FillEllipse($redBrush, 178, 411, 14, 14)
  $redBrush.Dispose()
  $titleFont = [System.Drawing.Font]::new('Segoe UI', 64, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $labelFont = [System.Drawing.Font]::new('Consolas', 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 219, 229, 232))
  $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 98, 208, 181))
  $graphics.DrawString('SOLAR', $titleFont, $textBrush, 760, 214)
  $graphics.DrawString('ATLAS', $titleFont, $textBrush, 760, 284)
  $graphics.DrawString('DYNAMICS · SMALL BODIES · MISSIONS', $labelFont, $accentBrush, 768, 382)
  $graphics.DrawString('TRACEABLE DATA · REPRODUCIBLE SCENES', $labelFont, $textBrush, 768, 420)
  $titleFont.Dispose(); $labelFont.Dispose(); $textBrush.Dispose(); $accentBrush.Dispose(); $graphics.Dispose()
  Save-Png $bitmap $path
}

New-AtlasIcon 192 (Join-Path $iconDirectory 'icon-192.png') $false
New-AtlasIcon 512 (Join-Path $iconDirectory 'icon-512.png') $false
New-AtlasIcon 512 (Join-Path $iconDirectory 'icon-maskable-512.png') $true
New-AtlasOgImage (Join-Path $projectRoot 'public\og-image.png')
