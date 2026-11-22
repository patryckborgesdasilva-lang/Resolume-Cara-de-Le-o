#!/usr/bin/env node
/*
 * Ponte local — Cara de Leão Projeção (versão Node.js)
 *
 * Faz a mesma coisa que o ponte.ps1 (Windows), para quem tem Node.js (Mac, Linux ou Windows):
 *   - serve o programa em http://localhost:8090
 *   - repassa as chamadas para a API do Holyrics (o navegador sozinho pode ser bloqueado por CORS)
 *   - lista e entrega vídeos/imagens de uma pasta (ex.: a pasta de mídia do Holyrics)
 *
 * Uso:  node ponte/ponte.js        (porta diferente: PORTA=9000 node ponte/ponte.js)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTA = parseInt(process.env.PORTA, 10) || 8090;
const RAIZ = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.md': 'text/plain; charset=utf-8',
};
const VIDEO = ['.mp4', '.m4v', '.webm', '.mov', '.mkv'];
const IMAGEM = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const MAX_ARQUIVOS = 500;

function enviar(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => enviar(res, code, typeof obj === 'string' ? obj : JSON.stringify(obj));

function lerCorpo(req, limite = 1e6) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { dados += c; if (dados.length > limite) { reject(new Error('corpo muito grande')); req.destroy(); } });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

// ---------- Holyrics ----------
async function holyrics(req, res) {
  let b;
  try { b = JSON.parse(await lerCorpo(req)); } catch (_) { return json(res, 400, { status: 'error', error: 'pedido inválido' }); }
  const host = String(b.host || '127.0.0.1');
  const port = parseInt(b.port, 10);
  const action = String(b.action || '');
  if (!/^[A-Za-z0-9.\-]+$/.test(host) || !(port > 0 && port < 65536) || !/^[A-Za-z0-9_]+$/.test(action)) {
    return json(res, 400, { status: 'error', error: 'IP, porta ou ação inválidos' });
  }
  const corpo = typeof b.params === 'string' ? b.params : JSON.stringify(b.params || {});
  const pr = http.request({
    host, port, method: 'POST', timeout: 4000,
    path: `/api/${action}?token=${encodeURIComponent(String(b.token || ''))}`,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
  }, (hr) => {
    const partes = [];
    hr.on('data', (c) => partes.push(c));
    hr.on('end', () => json(res, 200, Buffer.concat(partes).toString('utf8') || '{"status":"error","error":"resposta vazia"}'));
  });
  pr.on('timeout', () => pr.destroy(new Error('tempo esgotado')));
  pr.on('error', (e) => { if (!res.headersSent) json(res, 502, { status: 'error', error: 'o Holyrics não respondeu (' + e.message + '). Confira se o API Server está ativo, o IP e a porta.' }); });
  pr.end(corpo);
}

// ---------- arquivos de mídia ----------
function pastasCandidatas() {
  const home = os.homedir();
  return [
    'C:\\Holyrics\\Holyrics\\files\\media', 'C:\\Holyrics\\files\\media', 'C:\\Holyrics',
    path.join(home, 'Holyrics', 'Holyrics', 'files', 'media'), path.join(home, 'Holyrics'),
    path.join(home, 'Documents', 'Holyrics'), path.join(home, 'Documentos', 'Holyrics'),
  ];
}

function listar(dir) {
  const arquivos = [];
  let truncado = false;
  const andar = (d, prof) => {
    if (prof > 4 || truncado) return;
    let itens;
    try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const it of itens) {
      if (arquivos.length >= MAX_ARQUIVOS) { truncado = true; return; }
      const full = path.join(d, it.name);
      if (it.isDirectory()) andar(full, prof + 1);
      else {
        const ext = path.extname(it.name).toLowerCase();
        if (VIDEO.includes(ext) || IMAGEM.includes(ext)) {
          let size = 0;
          try { size = fs.statSync(full).size; } catch (_) { /* ignora */ }
          arquivos.push({ name: it.name, path: full, size, kind: VIDEO.includes(ext) ? 'video' : 'image' });
        }
      }
    }
  };
  andar(dir, 0);
  return { arquivos, truncado };
}

function arquivos(u, res) {
  let dir = u.searchParams.get('dir') || '';
  if (!dir) dir = pastasCandidatas().find((p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }) || '';
  if (!dir) return json(res, 200, { ok: false, error: 'não encontrei a pasta do Holyrics sozinho. Cole o caminho da pasta de mídia.' });
  try { if (!fs.statSync(dir).isDirectory()) throw new Error(); } catch (_) { return json(res, 200, { ok: false, error: 'pasta não encontrada: ' + dir }); }
  const r = listar(dir);
  json(res, 200, { ok: true, dir, files: r.arquivos, truncated: r.truncado });
}

function arquivo(u, res) {
  const p = u.searchParams.get('path') || '';
  const ext = path.extname(p).toLowerCase();
  if (!path.isAbsolute(p) || !(VIDEO.includes(ext) || IMAGEM.includes(ext))) return json(res, 400, { ok: false });
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { ok: false });
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
}

// ---------- arquivos do programa ----------
function estatico(u, res) {
  let rel = decodeURIComponent(u.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(RAIZ, '.' + rel);
  if (!full.startsWith(RAIZ + path.sep)) return enviar(res, 403, 'proibido', 'text/plain');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return enviar(res, 404, 'não encontrado', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  });
}

const servidor = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (_) { return enviar(res, 400, 'url inválida', 'text/plain'); }
  const p = u.pathname;
  try {
    if (p === '/ponte/arquivo') return arquivo(u, res);
    if (p.startsWith('/ponte/')) {
      // cabeçalho exigido: impede que outros sites usem a ponte pelo navegador
      if (req.headers['x-ponte'] !== '1') return json(res, 403, { ok: false });
      if (p === '/ponte/info') return json(res, 200, { ok: true, ponte: 'node', versao: 1 });
      if (p === '/ponte/holyrics' && req.method === 'POST') return holyrics(req, res);
      if (p === '/ponte/arquivos') return arquivos(u, res);
      return json(res, 404, { ok: false });
    }
    return estatico(u, res);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  Cara de Leão — Projeção\n  Abra no Chrome ou Edge:  http://localhost:${PORTA}\n  Deixe esta janela aberta durante o culto. (Ctrl+C para sair)\n`);
});
servidor.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `A porta ${PORTA} já está em uso (o programa já está aberto?).` : e.message);
  process.exit(1);
});
