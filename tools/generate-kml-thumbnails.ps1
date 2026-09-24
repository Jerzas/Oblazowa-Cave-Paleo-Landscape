param(
  [int]$Width = 320,
  [int]$Height = 180,
  [int]$PreferredLevel = 3
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;

public static class CubeThumbnailRenderer
{
    public static void Render(string sceneDir, int level, double yaw, double pitch, double fov, string outputPath, int width, int height)
    {
        var faces = new Dictionary<string, Bitmap>();
        foreach (var face in new[] { "f", "b", "l", "r", "u", "d" })
        {
            faces[face] = LoadFace(sceneDir, level, face);
        }

        try
        {
            using (var output = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                double aspect = (double)width / height;
                double tanV = Math.Tan(fov / 2.0);
                double tanH = Math.Tan(2.0 * Math.Atan(tanV * aspect) / 2.0);

                double sinYaw = Math.Sin(yaw);
                double cosYaw = Math.Cos(yaw);
                double sinPitch = Math.Sin(pitch);
                double cosPitch = Math.Cos(pitch);

                double fx = cosPitch * sinYaw;
                double fy = sinPitch;
                double fz = cosPitch * cosYaw;

                double rx = cosYaw;
                double ry = 0.0;
                double rz = -sinYaw;

                double ux = fy * rz - fz * ry;
                double uy = fz * rx - fx * rz;
                double uz = fx * ry - fy * rx;
                Normalize(ref ux, ref uy, ref uz);

                for (int y = 0; y < height; y++)
                {
                    double sy = 1.0 - (2.0 * (y + 0.5) / height);
                    for (int x = 0; x < width; x++)
                    {
                        double sx = (2.0 * (x + 0.5) / width) - 1.0;

                        double vx = fx + sx * tanH * rx + sy * tanV * ux;
                        double vy = fy + sx * tanH * ry + sy * tanV * uy;
                        double vz = fz + sx * tanH * rz + sy * tanV * uz;
                        Normalize(ref vx, ref vy, ref vz);

                        string face;
                        double u;
                        double v;
                        DirectionToFace(vx, vy, vz, out face, out u, out v);
                        output.SetPixel(x, y, Sample(faces[face], u, v));
                    }
                }

                Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
                SaveJpeg(output, outputPath, 88L);
            }
        }
        finally
        {
            foreach (var bitmap in faces.Values)
            {
                bitmap.Dispose();
            }
        }
    }

    private static Bitmap LoadFace(string sceneDir, int level, string face)
    {
        string faceDir = Path.Combine(sceneDir, level.ToString(), face);
        var tileFiles = Directory.GetFiles(faceDir, "*.jpg", SearchOption.AllDirectories);
        if (tileFiles.Length == 0)
        {
            throw new FileNotFoundException("No JPG tiles found in " + faceDir);
        }

        int maxRow = 0;
        int maxCol = 0;
        var tiles = new List<Tuple<string, int, int>>();

        foreach (var file in tileFiles)
        {
            int row = Int32.Parse(Path.GetFileName(Path.GetDirectoryName(file)));
            int col = Int32.Parse(Path.GetFileNameWithoutExtension(file));
            maxRow = Math.Max(maxRow, row);
            maxCol = Math.Max(maxCol, col);
            tiles.Add(Tuple.Create(file, row, col));
        }

        int tileWidth;
        int tileHeight;
        using (var sample = Image.FromFile(tileFiles[0]))
        {
            tileWidth = sample.Width;
            tileHeight = sample.Height;
        }

        var faceBitmap = new Bitmap((maxCol + 1) * tileWidth, (maxRow + 1) * tileHeight, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(faceBitmap))
        {
            g.Clear(Color.Black);
            foreach (var tileInfo in tiles)
            {
                using (var tile = Image.FromFile(tileInfo.Item1))
                {
                    g.DrawImage(tile, tileInfo.Item3 * tileWidth, tileInfo.Item2 * tileHeight, tile.Width, tile.Height);
                }
            }
        }

        return faceBitmap;
    }

    private static void DirectionToFace(double x, double y, double z, out string face, out double u, out double v)
    {
        double ax = Math.Abs(x);
        double ay = Math.Abs(y);
        double az = Math.Abs(z);

        if (az >= ax && az >= ay)
        {
            if (z >= 0)
            {
                face = "f";
                u = x / az;
                v = -y / az;
            }
            else
            {
                face = "b";
                u = -x / az;
                v = -y / az;
            }
        }
        else if (ax >= ay)
        {
            if (x >= 0)
            {
                face = "r";
                u = -z / ax;
                v = -y / ax;
            }
            else
            {
                face = "l";
                u = z / ax;
                v = -y / ax;
            }
        }
        else
        {
            if (y >= 0)
            {
                face = "u";
                u = x / ay;
                v = z / ay;
            }
            else
            {
                face = "d";
                u = x / ay;
                v = -z / ay;
            }
        }
    }

    private static Color Sample(Bitmap bitmap, double u, double v)
    {
        double px = Clamp((u + 1.0) * 0.5 * (bitmap.Width - 1), 0.0, bitmap.Width - 1);
        double py = Clamp((v + 1.0) * 0.5 * (bitmap.Height - 1), 0.0, bitmap.Height - 1);

        int x0 = (int)Math.Floor(px);
        int y0 = (int)Math.Floor(py);
        int x1 = Math.Min(x0 + 1, bitmap.Width - 1);
        int y1 = Math.Min(y0 + 1, bitmap.Height - 1);
        double dx = px - x0;
        double dy = py - y0;

        Color c00 = bitmap.GetPixel(x0, y0);
        Color c10 = bitmap.GetPixel(x1, y0);
        Color c01 = bitmap.GetPixel(x0, y1);
        Color c11 = bitmap.GetPixel(x1, y1);

        int r = Blend(c00.R, c10.R, c01.R, c11.R, dx, dy);
        int g = Blend(c00.G, c10.G, c01.G, c11.G, dx, dy);
        int b = Blend(c00.B, c10.B, c01.B, c11.B, dx, dy);
        return Color.FromArgb(r, g, b);
    }

    private static int Blend(int c00, int c10, int c01, int c11, double dx, double dy)
    {
        double top = c00 + (c10 - c00) * dx;
        double bottom = c01 + (c11 - c01) * dx;
        return (int)Math.Round(top + (bottom - top) * dy);
    }

    private static void Normalize(ref double x, ref double y, ref double z)
    {
        double length = Math.Sqrt(x * x + y * y + z * z);
        x /= length;
        y /= length;
        z /= length;
    }

    private static double Clamp(double value, double min, double max)
    {
        return Math.Min(Math.Max(value, min), max);
    }

    private static void SaveJpeg(Bitmap bitmap, string path, long quality)
    {
        var encoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using (var parameters = new EncoderParameters(1))
        {
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
            bitmap.Save(path, encoder, parameters);
        }
    }
}
"@

$dataRaw = Get-Content -Raw -LiteralPath 'data.js'
$match = [regex]::Match($dataRaw, '(?s)var\s+APP_DATA\s*=\s*(\{.*\});\s*$')
if (-not $match.Success) {
  throw 'Could not read APP_DATA from data.js'
}

$appData = $match.Groups[1].Value | ConvertFrom-Json
$outputDir = Join-Path 'img' 'kml-thumbnails'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

foreach ($scene in $appData.scenes) {
  $sceneDir = Join-Path 'tiles' $scene.id
  $availableLevels = @(Get-ChildItem -LiteralPath $sceneDir -Directory |
    Where-Object { $_.Name -match '^\d+$' } |
    ForEach-Object { [int]$_.Name } |
    Sort-Object)

  if (-not $availableLevels.Count) {
    Write-Warning "No tile levels found for $($scene.id)"
    continue
  }

  $level = ($availableLevels | Where-Object { $_ -le $PreferredLevel } | Select-Object -Last 1)
  if ($null -eq $level) {
    $level = $availableLevels[-1]
  }

  $scenePath = (Resolve-Path -LiteralPath $sceneDir).Path
  $outputPath = Join-Path $outputDir ($scene.id + '.jpg')

  [CubeThumbnailRenderer]::Render(
    $scenePath,
    [int]$level,
    [double]$scene.initialViewParameters.yaw,
    [double]$scene.initialViewParameters.pitch,
    [double]$scene.initialViewParameters.fov,
    (Join-Path (Get-Location).Path $outputPath),
    $Width,
    $Height
  )

  Write-Output "$($scene.id) -> $outputPath"
}
