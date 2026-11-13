Add-Type -AssemblyName System.Drawing
$jpgPath = Join-Path $PSScriptRoot "assets\app_icon.jpg"
$img = [System.Drawing.Image]::FromFile($jpgPath)

# 512x512 Master Icon
$p512 = Join-Path $PSScriptRoot "assets\icon-512.png"
$img.Save($p512, [System.Drawing.Imaging.ImageFormat]::Png)

# 192x192 Icon
$b192 = New-Object System.Drawing.Bitmap($img, 192, 192)
$p192 = Join-Path $PSScriptRoot "assets\icon-192.png"
$b192.Save($p192, [System.Drawing.Imaging.ImageFormat]::Png)

$b192.Dispose()
$img.Dispose()
Write-Host "PNG icons generated successfully!"
