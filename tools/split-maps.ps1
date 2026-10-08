$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$mapDirectory = Join-Path $root "maps"
$mapNames = @("Foto01", "Foto02", "Foto03")
$stripCount = 20
$sources = @()

foreach ($name in $mapNames) {
  $sourcePath = Join-Path $root "$name.png"
  if (-not (Test-Path $sourcePath)) {
    throw "Imagem de origem não encontrada: $sourcePath"
  }
  $image = [System.Drawing.Image]::FromFile($sourcePath)
  $sources += [PSCustomObject]@{ Name = $name; Path = $sourcePath; Image = $image }
}

try {
  $width = $sources[0].Image.Width
  $height = $sources[0].Image.Height
  foreach ($source in $sources) {
    if ($source.Image.Width -ne $width -or $source.Image.Height -ne $height) {
      throw "As três imagens precisam ter as mesmas dimensões."
    }
  }

  if (-not (Test-Path $mapDirectory)) {
    New-Item -ItemType Directory -Path $mapDirectory | Out-Null
  }

  foreach ($source in $sources) {
    for ($index = 0; $index -lt $stripCount; $index++) {
      $bottom = $height - [Math]::Floor($index * $height / $stripCount)
      $top = $height - [Math]::Floor(($index + 1) * $height / $stripCount)
      $rectangle = [System.Drawing.Rectangle]::new(0, $top, $width, $bottom - $top)
      $tile = $source.Image.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $fileNumber = ($index + 1).ToString("00")
        $destination = Join-Path $mapDirectory "$($source.Name)-$fileNumber.png"
        $tile.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $tile.Dispose()
      }
    }
  }

  $manifest = [PSCustomObject]@{ width = $width; height = $height; strips = $stripCount }
  $manifestPath = Join-Path $mapDirectory "manifest.json"
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $encoding)
  Write-Output "Geradas $stripCount faixas para cada mapa em $mapDirectory."
} finally {
  foreach ($source in $sources) {
    $source.Image.Dispose()
  }
}
