# Minimal static file server for previewing this app locally.
$root = (Resolve-Path "$PSScriptRoot\..").Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8787/")
$listener.Start()
Write-Host "serving $root on http://localhost:8787/"
$types = @{ ".html" = "text/html"; ".js" = "text/javascript"; ".css" = "text/css"; ".svg" = "image/svg+xml"; ".json" = "application/json" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($path -eq "/") { $path = "/index.html" }
  $file = Join-Path $root ($path.TrimStart("/") -replace "/", "\")
  if (Test-Path $file -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($file)
    $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] + "; charset=utf-8" } else { "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
