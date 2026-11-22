# Ponte local — Cara de Leão Projeção (Windows / PowerShell, não precisa instalar nada)
#
#  - serve o programa em http://localhost:8090
#  - repassa as chamadas para a API do Holyrics (o navegador sozinho pode ser bloqueado por CORS)
#  - lista e entrega vídeos/imagens de uma pasta (ex.: a pasta de mídia do Holyrics)
#  - liga a saída para o OBS (saida.html) ao painel de controle
#
# Normalmente é aberto pelo arquivo "Iniciar-Windows.bat".

param([int]$Porta = 8090)

$ErrorActionPreference = 'Stop'
$Raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Video = @('.mp4', '.m4v', '.webm', '.mov', '.mkv')
$Imagem = @('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.bmp' = 'image/bmp'; '.ico' = 'image/x-icon'
  '.mp4' = 'video/mp4'; '.m4v' = 'video/mp4'; '.webm' = 'video/webm'; '.mov' = 'video/quicktime'; '.mkv' = 'video/x-matroska'
  '.md' = 'text/plain; charset=utf-8'
}
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Enviar-Bytes($ctx, [int]$code, [byte[]]$bytes, [string]$tipo) {
  $r = $ctx.Response
  $r.StatusCode = $code
  $r.ContentType = $tipo
  $r.Headers['Cache-Control'] = 'no-store'
  $r.ContentLength64 = $bytes.Length
  $r.OutputStream.Write($bytes, 0, $bytes.Length)
  $r.OutputStream.Close()
}

function Enviar-Json($ctx, [int]$code, $obj) {
  if ($obj -is [string]) { $txt = $obj } else { $txt = ConvertTo-Json -InputObject $obj -Depth 6 -Compress }
  Enviar-Bytes $ctx $code ($Utf8.GetBytes($txt)) 'application/json; charset=utf-8'
}

function Enviar-Arquivo($ctx, [string]$caminho) {
  $ext = [IO.Path]::GetExtension($caminho).ToLower()
  $tipo = $Mime[$ext]
  if (-not $tipo) { $tipo = 'application/octet-stream' }
  $r = $ctx.Response
  $fs = [IO.File]::OpenRead($caminho)
  try {
    $r.StatusCode = 200
    $r.ContentType = $tipo
    $r.Headers['Cache-Control'] = 'no-store'
    $r.ContentLength64 = $fs.Length
    $fs.CopyTo($r.OutputStream)
  } finally {
    $fs.Close()
    $r.OutputStream.Close()
  }
}

function Ler-Corpo($req) {
  $sr = New-Object IO.StreamReader($req.InputStream, $Utf8)
  try { return $sr.ReadToEnd() } finally { $sr.Close() }
}

function Enviar-Vazio($ctx) {
  $ctx.Response.StatusCode = 204
  $ctx.Response.Headers['Cache-Control'] = 'no-store'
  $ctx.Response.OutputStream.Close()
}

function Ler-Bytes($req) {
  $ms = New-Object IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  return , $ms.ToArray()
}

# Caixas de mensagem (conexão do OBS) e estados (imagem das letras)
$Caixas = @{}
$Estados = @{}

function Tratar-Caixa($ctx, [string]$nome) {
  if ($nome -notmatch '^[A-Za-z0-9_-]{1,40}$') { Enviar-Json $ctx 400 '{"ok":false}'; return }
  if ($ctx.Request.HttpMethod -eq 'POST') {
    $txt = Ler-Corpo $ctx.Request
    if (-not $Caixas.ContainsKey($nome)) {
      if ($Caixas.Count -gt 200) { $Caixas.Clear() }
      $Caixas[$nome] = New-Object 'System.Collections.Generic.List[string]'
    }
    $q = $Caixas[$nome]
    $q.Add($txt)
    while ($q.Count -gt 50) { $q.RemoveAt(0) }
    Enviar-Json $ctx 200 '{"ok":true}'
  } else {
    $saida = '[]'
    if ($Caixas.ContainsKey($nome)) {
      $q = $Caixas[$nome]
      if ($q.Count -gt 0) { $saida = '[' + ($q -join ',') + ']' }
      $q.Clear()
    }
    Enviar-Json $ctx 200 $saida
  }
}

function Tratar-Estado($ctx, [string]$nome) {
  if ($nome -notmatch '^[A-Za-z0-9_-]{1,40}$') { Enviar-Json $ctx 400 '{"ok":false}'; return }
  $req = $ctx.Request
  if ($req.HttpMethod -eq 'POST') {
    $bytes = Ler-Bytes $req
    $v = 1
    if ($Estados.ContainsKey($nome)) { $v = $Estados[$nome].v + 1 }
    $tipo = [string]$req.ContentType
    if (-not $tipo) { $tipo = 'application/octet-stream' }
    $Estados[$nome] = @{ v = $v; bytes = $bytes; tipo = $tipo; meta = [string]$req.Headers['X-Meta'] }
    Enviar-Json $ctx 200 ('{"ok":true,"v":' + $v + '}')
  } else {
    if (-not $Estados.ContainsKey($nome)) { Enviar-Vazio $ctx; return }
    $e = $Estados[$nome]
    if ($req.QueryString['v'] -eq [string]$e.v) { Enviar-Vazio $ctx; return }
    $ctx.Response.Headers['X-Versao'] = [string]$e.v
    $ctx.Response.Headers['X-Meta'] = $e.meta
    Enviar-Bytes $ctx 200 $e.bytes $e.tipo
  }
}

function Chamar-Holyrics($ctx) {
  $b = (Ler-Corpo $ctx.Request) | ConvertFrom-Json
  $hostH = [string]$b.host
  $porta = 0
  [void][int]::TryParse([string]$b.port, [ref]$porta)
  $acao = [string]$b.action
  if ($hostH -notmatch '^[A-Za-z0-9.\-]+$' -or $porta -lt 1 -or $porta -gt 65535 -or $acao -notmatch '^[A-Za-z0-9_]+$') {
    Enviar-Json $ctx 400 @{ status = 'error'; error = 'IP, porta ou ação inválidos' }
    return
  }
  $corpo = [string]$b.params
  if (-not $corpo) { $corpo = '{}' }
  $url = "http://${hostH}:${porta}/api/${acao}?token=" + [Uri]::EscapeDataString([string]$b.token)
  try {
    $wr = [Net.HttpWebRequest]::Create($url)
    $wr.Method = 'POST'
    $wr.ContentType = 'application/json'
    $wr.Timeout = 4000
    $wr.ReadWriteTimeout = 4000
    $wr.Proxy = $null
    $bytes = $Utf8.GetBytes($corpo)
    $wr.ContentLength = $bytes.Length
    $s = $wr.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    try {
      $resp = $wr.GetResponse()
    } catch [Net.WebException] {
      if ($_.Exception.Response) { $resp = $_.Exception.Response } else { throw }
    }
    $sr = New-Object IO.StreamReader($resp.GetResponseStream(), $Utf8)
    $txt = $sr.ReadToEnd()
    $sr.Close()
    $resp.Close()
    if (-not $txt) { $txt = '{"status":"error","error":"resposta vazia"}' }
    Enviar-Json $ctx 200 $txt
  } catch {
    Enviar-Json $ctx 502 @{ status = 'error'; error = ('o Holyrics não respondeu (' + $_.Exception.Message + '). Confira se o API Server está ativo, o IP e a porta.') }
  }
}

function Listar-Arquivos($ctx) {
  $dir = $ctx.Request.QueryString['dir']
  if (-not $dir) {
    $cands = @('C:\Holyrics\Holyrics\files\media', 'C:\Holyrics\files\media', 'C:\Holyrics',
      (Join-Path $env:USERPROFILE 'Holyrics\Holyrics\files\media'), (Join-Path $env:USERPROFILE 'Holyrics'),
      (Join-Path $env:USERPROFILE 'Documents\Holyrics'))
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c -PathType Container) { $dir = $c; break } }
  }
  if (-not $dir) {
    Enviar-Json $ctx 200 @{ ok = $false; error = 'não encontrei a pasta do Holyrics sozinho. Cole o caminho da pasta de mídia.' }
    return
  }
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    Enviar-Json $ctx 200 @{ ok = $false; error = "pasta não encontrada: $dir" }
    return
  }
  $todos = @(Get-ChildItem -LiteralPath $dir -Recurse -Depth 4 -File -ErrorAction SilentlyContinue |
      Where-Object { ($Video -contains $_.Extension.ToLower()) -or ($Imagem -contains $_.Extension.ToLower()) } |
      Select-Object -First 501)
  $lista = New-Object System.Collections.ArrayList
  foreach ($f in ($todos | Select-Object -First 500)) {
    $tipo = 'image'
    if ($Video -contains $f.Extension.ToLower()) { $tipo = 'video' }
    [void]$lista.Add(@{ name = $f.Name; path = $f.FullName; size = $f.Length; kind = $tipo })
  }
  Enviar-Json $ctx 200 @{ ok = $true; dir = $dir; files = $lista.ToArray(); truncated = ($todos.Count -gt 500) }
}

function Entregar-Midia($ctx) {
  $p = $ctx.Request.QueryString['path']
  $ext = ''
  if ($p) { $ext = [IO.Path]::GetExtension($p).ToLower() }
  if (-not $p -or -not [IO.Path]::IsPathRooted($p) -or -not (($Video -contains $ext) -or ($Imagem -contains $ext))) {
    Enviar-Json $ctx 400 '{"ok":false}'
    return
  }
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Enviar-Json $ctx 404 '{"ok":false}'; return }
  Enviar-Arquivo $ctx $p
}

function Entregar-Estatico($ctx) {
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($rel.EndsWith('/')) { $rel += 'index.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $Raiz ($rel.TrimStart('/').Replace('/', '\'))))
  if (-not $full.StartsWith($Raiz + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Enviar-Bytes $ctx 403 ($Utf8.GetBytes('proibido')) 'text/plain'
    return
  }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    Enviar-Bytes $ctx 404 ($Utf8.GetBytes('não encontrado')) 'text/plain; charset=utf-8'
    return
  }
  Enviar-Arquivo $ctx $full
}

# ---------------------------------------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Porta/")
try {
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host "  Não foi possível abrir a porta $Porta." -ForegroundColor Red
  Write-Host "  Talvez o programa já esteja aberto em outra janela. Feche-a e tente de novo."
  Write-Host "  Detalhe: $($_.Exception.Message)"
  exit 1
}

$endereco = "http://localhost:$Porta/"
Write-Host ''
Write-Host '  Cara de Leão — Projeção' -ForegroundColor Yellow
Write-Host "  Aberto em: $endereco"
Write-Host '  DEIXE ESTA JANELA ABERTA durante o culto (pode minimizar).'
Write-Host ''

# abre no Chrome ou Edge (recomendados); se não achar, no navegador padrão
$abriu = $false
foreach ($nav in @('chrome', 'msedge')) {
  try { Start-Process $nav $endereco -ErrorAction Stop; $abriu = $true; break } catch { }
}
if (-not $abriu) { Start-Process $endereco }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $caminho = $ctx.Request.Url.AbsolutePath
    if ($caminho -eq '/ponte/arquivo') {
      Entregar-Midia $ctx
    } elseif ($caminho.StartsWith('/ponte/')) {
      # cabeçalho exigido: impede que outros sites usem a ponte pelo navegador
      if ($ctx.Request.Headers['X-Ponte'] -ne '1') {
        Enviar-Json $ctx 403 '{"ok":false}'
      } elseif ($caminho -eq '/ponte/info') {
        Enviar-Json $ctx 200 '{"ok":true,"ponte":"powershell","versao":1}'
      } elseif ($caminho -eq '/ponte/holyrics' -and $ctx.Request.HttpMethod -eq 'POST') {
        Chamar-Holyrics $ctx
      } elseif ($caminho -eq '/ponte/arquivos') {
        Listar-Arquivos $ctx
      } elseif ($caminho.StartsWith('/ponte/caixa/')) {
        Tratar-Caixa $ctx $caminho.Substring(13)
      } elseif ($caminho.StartsWith('/ponte/estado/')) {
        Tratar-Estado $ctx $caminho.Substring(14)
      } else {
        Enviar-Json $ctx 404 '{"ok":false}'
      }
    } else {
      Entregar-Estatico $ctx
    }
  } catch {
    try { Enviar-Json $ctx 500 @{ ok = $false; error = $_.Exception.Message } } catch { }
  }
}
