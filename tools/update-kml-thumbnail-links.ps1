param(
  [string[]]$KmlFiles = @('scenes.kml', 'scenes-github-links.kml'),
  [string]$BaseUrl = 'https://jerzas.github.io/Oblazowa-Cave-Paleo-Landscape',
  [string]$KmzSource = 'scenes-github-links.kml',
  [string]$KmzOutput = 'scenes-github-links.kmz',
  [switch]$SkipKmz
)

$ErrorActionPreference = 'Stop'

$dataRaw = Get-Content -Raw -Encoding UTF8 -LiteralPath 'data.js'
$match = [regex]::Match($dataRaw, '(?s)var\s+APP_DATA\s*=\s*(\{.*\});\s*$')
if (-not $match.Success) {
  throw 'Could not read APP_DATA from data.js'
}

$appData = $match.Groups[1].Value | ConvertFrom-Json
$sceneNames = @{}
$scenesById = @{}
$openPanoramaLabel = 'Open 360 panorama'
foreach ($scene in $appData.scenes) {
  $sceneNames[$scene.id] = $scene.name
  $scenesById[$scene.id] = $scene
}

function ConvertTo-HtmlAttribute {
  param([string]$Value)

  return $Value.
    Replace('&', '&amp;').
    Replace('"', '&quot;').
    Replace('<', '&lt;').
    Replace('>', '&gt;')
}

function ConvertTo-XmlText {
  param([string]$Value)

  return [System.Security.SecurityElement]::Escape($Value)
}

function New-Description {
  param(
    [string]$SceneId,
    [string]$SceneUrl
  )

  $yaw = [double]$scenesById[$SceneId].initialViewParameters.yaw
  if ($yaw -ge (-[math]::PI / 4) -and $yaw -le ([math]::PI / 4)) {
    $face = 'f'
  }
  elseif ($yaw -gt ([math]::PI / 4) -and $yaw -lt (3 * [math]::PI / 4)) {
    $face = 'r'
  }
  elseif ($yaw -lt (-[math]::PI / 4) -and $yaw -gt (-3 * [math]::PI / 4)) {
    $face = 'l'
  }
  else {
    $face = 'b'
  }

  # Level 1 contains a complete 90-degree cube face and is already published
  # with the panorama, so Google Earth Web can load it with CORS enabled.
  $thumbUrl = "$BaseUrl/tiles/$SceneId/1/$face/0/0.jpg"
  $alt = ConvertTo-HtmlAttribute ($sceneNames[$SceneId])

  return '<description><![CDATA[' +
    '<p><a href="' + $SceneUrl + '" target="_blank">' +
    '<img src="' + $thumbUrl + '" alt="' + $alt + '" width="320" height="180" style="width:320px;height:180px;object-fit:cover;object-position:center;border:0;display:block;" />' +
    '</a></p>' +
    '<p><a href="' + $SceneUrl + '" target="_blank"><b>' + $openPanoramaLabel + '</b></a></p>' +
    ']]></description>'
}

foreach ($file in $KmlFiles) {
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Warning "Skipping missing KML file: $file"
    continue
  }

  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $file
  $updated = [regex]::Replace($content, '(?s)<Placemark>(.*?)</Placemark>', {
    param($placemarkMatch)

    $placemark = $placemarkMatch.Value
    $urlMatch = [regex]::Match($placemark, 'https://jerzas\.github\.io/Oblazowa-Cave-Paleo-Landscape/\?scene=([^"<\]\s]+)')
    if (-not $urlMatch.Success) {
      return $placemark
    }

    $sceneId = $urlMatch.Groups[1].Value
    $sceneUrl = "$BaseUrl/?scene=$sceneId"
    $description = New-Description -SceneId $sceneId -SceneUrl $sceneUrl

    $sceneName = ConvertTo-XmlText ([string]$sceneNames[$sceneId])
    $placemark = [regex]::Replace($placemark, '(?s)<name>.*?</name>', "<name>$sceneName</name>", 1)

    return [regex]::Replace($placemark, '(?s)<description>.*?</description>', $description, 1)
  })

  $targetPath = (Resolve-Path -LiteralPath $file).Path
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($targetPath, $updated, $utf8NoBom)
  Write-Output "Updated $file"
}

if (-not $SkipKmz) {
  if (-not (Test-Path -LiteralPath $KmzSource)) {
    throw "Could not create KMZ because the source KML is missing: $KmzSource"
  }

  $thumbnailDirectory = Join-Path (Get-Location) 'img\kml-thumbnails'
  $thumbnailFiles = @(Get-ChildItem -LiteralPath $thumbnailDirectory -File -Filter '*.jpg')
  if ($thumbnailFiles.Count -eq 0) {
    throw "Could not create KMZ because no thumbnails were found in: $thumbnailDirectory"
  }

  $buildDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("kml-thumbnails-" + [guid]::NewGuid().ToString('N'))
  $archivePath = Join-Path ([System.IO.Path]::GetTempPath()) ("kml-thumbnails-" + [guid]::NewGuid().ToString('N') + '.zip')

  try {
    $embeddedThumbnailDirectory = Join-Path $buildDirectory 'img\kml-thumbnails'
    New-Item -ItemType Directory -Path $embeddedThumbnailDirectory -Force | Out-Null

    $docKml = Get-Content -Raw -Encoding UTF8 -LiteralPath $KmzSource
    $remoteThumbnailPrefix = "$BaseUrl/img/kml-thumbnails/"
    $docKml = $docKml.Replace($remoteThumbnailPrefix, 'img/kml-thumbnails/')
    [System.IO.File]::WriteAllText((Join-Path $buildDirectory 'doc.kml'), $docKml, $utf8NoBom)

    Copy-Item -LiteralPath $thumbnailFiles.FullName -Destination $embeddedThumbnailDirectory
    Compress-Archive -Path (Join-Path $buildDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal

    $kmzTarget = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $KmzOutput))
    Move-Item -LiteralPath $archivePath -Destination $kmzTarget -Force
    Write-Output "Created $KmzOutput with $($thumbnailFiles.Count) embedded thumbnails"
  }
  finally {
    if (Test-Path -LiteralPath $buildDirectory) {
      Remove-Item -LiteralPath $buildDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath $archivePath) {
      Remove-Item -LiteralPath $archivePath -Force
    }
  }
}
