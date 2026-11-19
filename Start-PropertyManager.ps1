[CmdletBinding()]
param([switch]$NoBrowser, [ValidateRange(0, 65535)][int]$Port = 8769)
$ErrorActionPreference = 'Stop'
$siteRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'dist')).Path
$sitePrefix = $siteRoot.TrimEnd('\') + '\'
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$mime = @{
    '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8';
    '.css'='text/css; charset=utf-8'; '.png'='image/png'; '.pdf'='application/pdf';
    '.txt'='text/plain; charset=utf-8'; '.webmanifest'='application/manifest+json'
}
try {
    $server.Start()
} catch {
    Write-Error "Could not listen on port $Port. $($_.Exception.Message)"
    return
}
try {
    $origin = 'http://127.0.0.1:{0}/' -f $server.LocalEndpoint.Port
    Write-Host "Property Manager is available at $origin"
    Write-Host 'Keep this window open for the initial installation and updates. Press Ctrl+C to stop the local server.'
    if (-not $NoBrowser) { Start-Process $origin }
    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 8000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $line = $reader.ReadLine()
            $status = '404 Not Found'
            $data = [byte[]]@()
            $format = 'text/plain'
            $headOnly = $false
            if ($line -match '^(GET|HEAD) (/[^ ]*) HTTP/1\.[01]$') {
                $headOnly = $Matches[1] -eq 'HEAD'
                $urlPath = [Uri]::UnescapeDataString(($Matches[2] -split '\?', 2)[0]).TrimStart('/')
                if (-not $urlPath) { $urlPath = 'index.html' }
                if ($urlPath -match '^[A-Za-z0-9_.\-/]+$') {
                    $filePath = [IO.Path]::GetFullPath([IO.Path]::Combine($siteRoot, $urlPath.Replace('/', '\')))
                    if ($filePath.StartsWith($sitePrefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($filePath)) {
                        $data = [IO.File]::ReadAllBytes($filePath)
                        $status = '200 OK'
                        $ext = [IO.Path]::GetExtension($filePath)
                        $format = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                    }
                }
            }
            $header = "HTTP/1.1 $status`r`nContent-Type: $format`r`nContent-Length: $($data.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $bytes = [Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($bytes, 0, $bytes.Length)
            if (-not $headOnly -and $data.Length) { $stream.Write($data, 0, $data.Length) }
            $stream.Flush()
        } catch {
            Write-Verbose $_.Exception.Message
        } finally {
            $client.Close()
        }
    }
} finally {
    $server.Stop()
}
