Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $Radius * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $Width - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $Width - $d, $Y + $Height - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $Height - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$outPath = Join-Path $PSScriptRoot '..\designs\mercabot-logo-pro-1024.png'
$outPath = [System.IO.Path]::GetFullPath($outPath)

$bmp = New-Object System.Drawing.Bitmap 1024, 1024
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

$dark = [System.Drawing.ColorTranslator]::FromHtml('#0B110D')
$darkSoft = [System.Drawing.ColorTranslator]::FromHtml('#111810')
$green = [System.Drawing.ColorTranslator]::FromHtml('#00E676')
$greenDeep = [System.Drawing.ColorTranslator]::FromHtml('#00C853')
$white = [System.Drawing.ColorTranslator]::FromHtml('#F4FBF5')
$gray = [System.Drawing.ColorTranslator]::FromHtml('#67806F')

# Icon base
$iconX = 282
$iconY = 110
$iconSize = 460
$iconPath = New-RoundedRectPath -X $iconX -Y $iconY -Width $iconSize -Height $iconSize -Radius 110
$iconBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point([int]$iconX, [int]$iconY)),
  (New-Object System.Drawing.Point([int]($iconX + $iconSize), [int]($iconY + $iconSize))),
  $dark,
  $darkSoft
)
$g.FillPath($iconBrush, $iconPath)

$outlinePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(26, 234, 242, 235), 3)
$g.DrawPath($outlinePen, $iconPath)

# Chat bubble
$bubblePath = New-RoundedRectPath -X 360 -Y 220 -Width 300 -Height 220 -Radius 62
$bubbleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(360, 220)),
  (New-Object System.Drawing.Point(660, 440)),
  $green,
  $greenDeep
)
$g.FillPath($bubbleBrush, $bubblePath)

$tail = New-Object System.Drawing.Drawing2D.GraphicsPath
$tailPoints = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point(445, 438)),
  (New-Object System.Drawing.Point(503, 438)),
  (New-Object System.Drawing.Point(430, 505))
)
$tail.AddPolygon($tailPoints)
$g.FillPath($bubbleBrush, $tail)

# Upward arrow inside bubble
$arrowPen = New-Object System.Drawing.Pen($dark, 28)
$arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($arrowPen, 450, 372, 570, 252)
$g.DrawLine($arrowPen, 520, 252, 570, 252)
$g.DrawLine($arrowPen, 570, 252, 570, 302)

# Accent node
$g.FillEllipse((New-Object System.Drawing.SolidBrush($white)), 590, 337, 38, 38)

# Wordmark
$fontMain = New-Object System.Drawing.Font('Segoe UI', 88, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontSub = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

$mercaSize = $g.MeasureString('Merca', $fontMain)
$botSize = $g.MeasureString('Bot', $fontMain)
$totalWidth = [int]([Math]::Ceiling($mercaSize.Width + $botSize.Width - 8))
$startX = [int](512 - ($totalWidth / 2))
$baseY = 690

$textBrushDark = New-Object System.Drawing.SolidBrush($dark)
$textBrushGreen = New-Object System.Drawing.SolidBrush($green)
$subBrush = New-Object System.Drawing.SolidBrush($gray)

$g.DrawString('Merca', $fontMain, $textBrushDark, $startX, $baseY)
$g.DrawString('Bot', $fontMain, $textBrushGreen, $startX + [int]([Math]::Ceiling($mercaSize.Width - 12)), $baseY)

$tagline = 'Atendimento com IA no WhatsApp'
$tagSize = $g.MeasureString($tagline, $fontSub)
$tagX = [int](512 - ($tagSize.Width / 2))
$g.DrawString($tagline, $fontSub, $subBrush, $tagX, 808)

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/png' }
$enc = [System.Drawing.Imaging.Encoder]::Compression
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($enc, ([long][System.Drawing.Imaging.EncoderValue]::CompressionLZW))
$bmp.Save($outPath, $codec, $params)

$outlinePen.Dispose()
$arrowPen.Dispose()
$iconBrush.Dispose()
$bubbleBrush.Dispose()
$textBrushDark.Dispose()
$textBrushGreen.Dispose()
$subBrush.Dispose()
$fontMain.Dispose()
$fontSub.Dispose()
$tail.Dispose()
$bubblePath.Dispose()
$iconPath.Dispose()
$g.Dispose()
$bmp.Dispose()

Get-Item $outPath | Select-Object FullName, Length
