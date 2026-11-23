/*
 * Cara de Leão — Projeção
 * Mixer de vídeo em camadas para projeção na igreja (estilo Resolume), 100% no navegador.
 *
 * Estrutura:
 *   P   = projeto salvo (camadas, clipes, configurações) — vai para o IndexedDB
 *   rt  = estado de execução (elementos de mídia, transições, janela do projetor) — não é salvo
 *   ui  = seleção atual da interface
 */
(function () {
  'use strict';

  // =====================================================================
  // Utilitários
  // =====================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k in e) { try { e[k] = v; } catch (_) { e.setAttribute(k, v); } }
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // =====================================================================
  // Armazenamento (IndexedDB): projeto + arquivos de mídia
  // =====================================================================
  const DB = (() => {
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          const r = indexedDB.open('cara-de-leao-projecao', 1);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    async function tx(store, mode, fn) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }
    return {
      get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
      put: (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key)),
      del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
      clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
    };
  })();

  // =====================================================================
  // Constantes e padrões
  // =====================================================================
  const BLENDS = [
    ['source-over', 'Normal'],
    ['screen', 'Tela (Screen)'],
    ['lighter', 'Adicionar (Add)'],
    ['multiply', 'Multiplicar'],
    ['overlay', 'Sobrepor'],
    ['soft-light', 'Luz suave'],
    ['difference', 'Diferença'],
    ['luminosity', 'Luminosidade'],
  ];
  const TX = window.CDLTexto;
  const Animador = TX.criarAnimador();
  const RESOLUTIONS = [
    [1920, 1080, 'Full HD 16:9'], [1280, 720, 'HD 16:9'], [3840, 2160, '4K 16:9'],
    [1024, 768, 'Projetor 4:3'], [1400, 1050, 'Projetor 4:3 (SXGA+)'], [1280, 800, 'Projetor 16:10'],
    [1920, 1200, '16:10 (WUXGA)'], [1080, 1920, 'Vertical 9:16'],
  ];
  const TYPE_LABEL = { video: 'Vídeo', image: 'Imagem', text: 'Texto / Letra', color: 'Cor', camera: 'Câmera / NDI', screen: 'Captura de tela', holyrics: 'Holyrics ao vivo (letra)', obs: 'Cena / fonte do OBS', holybg: 'Holyrics ao vivo (fundo)' };
  const BADGE = { video: 'VÍDEO', image: 'IMG', text: 'TEXTO', color: 'COR', camera: 'CÂM', screen: 'TELA', holyrics: 'HOLYRICS', obs: 'OBS', holybg: 'FUNDO HOLYRICS' };
  const isTextLike = (clip) => !!clip && (clip.type === 'text' || clip.type === 'holyrics');
  const defaultHolyrics = () => ({ host: '127.0.0.1', port: 8091, token: '', arrows: true, useOrder: true, mediaDir: '' });
  const defaultObs = () => ({ quality: 'alta' });
  const defaultObsWs = () => ({ host: '127.0.0.1', port: 4455, password: '', enabled: false });
  const FIT_OPTS = [['cover', 'Preencher (corta bordas)'], ['contain', 'Encaixar (sem cortar)'], ['stretch', 'Esticar']];

  const defaultFx = () => ({
    brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, zoom: 100,
    gray: 0, vignette: 0, tint: 0, tintColor: '#f5a524', mirror: false, posX: 0, posY: 0,
  });
  // "Looks" de camada no estilo das igrejas que usam Resolume (IMAG = câmera no telão)
  const FX_PRESETS = {
    'Limpo': {},
    'Câmera P&B dramática': { gray: 100, contrast: 130, brightness: 95, vignette: 55 },
    'Cinema': { contrast: 115, saturate: 85, vignette: 60, tint: 12, tintColor: '#ff9a3c' },
    'Tom quente': { tint: 22, tintColor: '#ff8a1f', saturate: 110 },
    'Tom frio': { tint: 22, tintColor: '#2f7bff', saturate: 90 },
    'Fundo desfocado (atrás da letra)': { blur: 14, brightness: 60, vignette: 30 },
    'Quadro no canto (PiP)': { zoom: 35, posX: 30, posY: 28 },
  };
  const defaultTextStyle = () => ({
    font: 'Arial', size: 80, weight: 700, italic: false, uppercase: false, letterSpacing: 0,
    color: '#ffffff', gradient: false, color2: '#f5a524',
    outline: 3, outlineColor: '#000000', shadow: true, glow: 0, glowColor: '#ffffff',
    align: 'center', valign: 'middle',
    box: 'none', boxColor: '#000000', boxOpacity: 0.55,
    margin: 90, lineHeight: 1.2,
    anim: 'fade', animDur: 0.5, stagger: 0.05, exitAnim: 'fade', exitDur: 0.35, idle: 'nenhum',
  });
  // Visuais prontos inspirados em operações de letras com Resolume em igrejas
  const BASE_LOOK = { italic: false, uppercase: false, letterSpacing: 0, gradient: false, glow: 0, outline: 0, shadow: true, box: 'none', idle: 'nenhum', stagger: 0.05, lineHeight: 1.2, align: 'center' };
  const TEXT_PRESETS = {
    'Letra clássica': { font: 'Arial', weight: 700, size: 80, outline: 3, valign: 'middle', margin: 90, anim: 'fade', animDur: 0.5, exitAnim: 'fade', exitDur: 0.35 },
    'Worship moderno': { font: 'Montserrat', weight: 700, size: 76, uppercase: true, letterSpacing: 6, valign: 'middle', margin: 120, anim: 'desfoque', animDur: 0.8, exitAnim: 'desfoque', exitDur: 0.45, idle: 'respirar' },
    'Palavra por palavra': { font: 'Poppins', weight: 700, size: 78, valign: 'middle', margin: 110, anim: 'palavra', animDur: 0.45, stagger: 0.09, exitAnim: 'fade', exitDur: 0.3 },
    'Linha subindo': { font: 'Inter', weight: 700, size: 76, valign: 'middle', margin: 110, anim: 'subir', animDur: 0.6, stagger: 0.14, exitAnim: 'subir', exitDur: 0.4 },
    'Impacto': { font: 'Bebas Neue', weight: 400, size: 150, uppercase: true, letterSpacing: 3, valign: 'middle', margin: 80, lineHeight: 1.0, anim: 'escala', animDur: 0.5, stagger: 0.07, exitAnim: 'zoom', exitDur: 0.35 },
    'Máquina de escrever': { font: 'Courier New', weight: 700, size: 70, valign: 'middle', margin: 130, anim: 'maquina', stagger: 0.035, exitAnim: 'fade', exitDur: 0.3 },
    'Cinema': { font: 'Playfair Display', weight: 400, italic: true, size: 78, valign: 'middle', margin: 140, anim: 'fade', animDur: 1.2, exitAnim: 'fade', exitDur: 0.8, idle: 'flutuar' },
    'Brilho dourado': { font: 'Cinzel', weight: 700, size: 74, uppercase: true, gradient: true, color: '#fff6d5', color2: '#d9a521', glow: 22, glowColor: '#ffb300', valign: 'middle', margin: 120, anim: 'tracking', animDur: 1.0, exitAnim: 'fade', exitDur: 0.5, idle: 'brilho' },
    'Legenda (rodapé)': { font: 'Inter', weight: 700, size: 54, valign: 'bottom', box: 'band', boxOpacity: 0.6, shadow: false, margin: 50, anim: 'subir', animDur: 0.45, stagger: 0.08, exitAnim: 'fade', exitDur: 0.3 },
    'Versículo': { font: 'Lora', weight: 400, size: 64, valign: 'middle', box: 'box', boxOpacity: 0.5, margin: 140, anim: 'fade', animDur: 0.7, exitAnim: 'fade', exitDur: 0.4 },
  };

  function newLayer(name, cols) {
    return { id: uid(), name, opacity: 1, blend: 'source-over', fade: 0.6, bypass: false, fx: defaultFx(), clips: Array(cols).fill(null) };
  }
  function newTextClip(name, text, presetName) {
    const style = defaultTextStyle();
    if (presetName) Object.assign(style, BASE_LOOK, TEXT_PRESETS[presetName]);
    return { id: uid(), type: 'text', name, text, slide: 0, style };
  }
  function newColorClip(name, color, color2, gradient, dir) {
    return { id: uid(), type: 'color', name, color, color2: color2 || '#000000', gradient: !!gradient, dir: dir || 'vertical' };
  }

  function defaultProject() {
    const cols = 8;
    const p = { version: 1, width: 1920, height: 1080, columns: cols, master: 1, masterFade: 0.6, layers: [], clips: {}, holyrics: defaultHolyrics(), obs: defaultObs(), obsWs: defaultObsWs(), fontesLocais: [] };
    // camadas ficam guardadas de baixo (índice 0) para cima
    const fundo = newLayer('Fundo', cols);
    const midia = newLayer('Mídia', cols);
    const letras = newLayer('Letras', cols);
    letras.fade = 0.4;
    p.layers.push(fundo, midia, letras);

    const add = (layer, col, clip) => { p.clips[clip.id] = clip; layer.clips[col] = clip.id; };
    add(fundo, 0, newColorClip('Degradê azul', '#0d2a6b', '#02040c', true, 'vertical'));
    add(fundo, 1, newColorClip('Degradê dourado', '#5a3a00', '#0a0600', true, 'radial'));
    add(fundo, 2, newColorClip('Preto', '#000000', '#000000', false));
    add(letras, 0, newTextClip('Exemplo de letra',
      'Bem-vindos!\n\nDigite a letra da música\nno painel à direita\n\nDeixe uma linha em branco\npara criar um novo slide\n\nUse → e ← (ou o passador)\npara trocar os slides'));
    add(letras, 1, newTextClip('Versículo',
      'Porque Deus amou o mundo de tal maneira\nque deu o seu Filho unigênito,\npara que todo aquele que nele crê\nnão pereça, mas tenha a vida eterna.\n\nJoão 3:16', 'Versículo'));
    return p;
  }

  // Garante que um projeto salvo (talvez de versão antiga) tenha todos os campos
  function normalize(p) {
    const d = defaultProject();
    for (const k of ['width', 'height', 'columns', 'master', 'masterFade']) if (typeof p[k] !== 'number') p[k] = d[k];
    p.clips = p.clips || {};
    p.holyrics = Object.assign(defaultHolyrics(), p.holyrics);
    p.obs = Object.assign(defaultObs(), p.obs);
    p.obsWs = Object.assign(defaultObsWs(), p.obsWs);
    p.layers = Array.isArray(p.layers) && p.layers.length ? p.layers : d.layers;
    p.fontesLocais = Array.isArray(p.fontesLocais) ? p.fontesLocais : [];
    for (const l of p.layers) {
      l.fx = Object.assign(defaultFx(), l.fx);
      if (typeof l.opacity !== 'number') l.opacity = 1;
      if (typeof l.fade !== 'number') l.fade = 0.6;
      l.blend = l.blend || 'source-over';
      l.clips = Array.isArray(l.clips) ? l.clips : [];
      while (l.clips.length < p.columns) l.clips.push(null);
      l.clips = l.clips.slice(0, p.columns).map((id) => (id && p.clips[id] ? id : null));
    }
    for (const c of Object.values(p.clips)) {
      if (isTextLike(c)) {
        const old = c.style || {};
        if (old.weight == null) old.weight = old.bold === false ? 400 : 700;
        c.style = Object.assign(defaultTextStyle(), old);
        delete c.style.bold; delete c.style.transition;
      }
      if (c.type === 'text') { c.slide = c.slide || 0; c.text = c.text || ''; }
      if (c.type === 'obs') { c.fps = +c.fps || 10; c.res = c.res || 'media'; }
      if (c.type === 'holybg') { c.fit = c.fit || 'cover'; if (typeof c.transition !== 'number') c.transition = 0.8; }
      if (c.type === 'video') { c.speed = c.speed || 1; c.volume = c.volume == null ? 1 : c.volume; c.loop = c.loop !== false; }
      if (!c.fit && !isTextLike(c) && c.type !== 'color') c.fit = 'cover';
    }
    return p;
  }

  // =====================================================================
  // Estado
  // =====================================================================
  let P = null;
  const ui = { selClip: null, selLayer: null, addTarget: null, slidesClip: null };
  const rt = {
    layers: {},          // id da camada -> { current, prev, t0, canvas, ctx }
    media: {},           // id do clipe -> { el, url, ready, stream, error }
    liveText: null,      // último clipe de texto colocado no ar
    blackout: false,
    blackLevel: 0,       // 0 = normal, 1 = preto
    lastNow: 0,
    outWin: null, outCanvas: null, outCtx: null,
  };
  const pendingBlobs = new Map(); // arquivos importados nesta sessão (chave -> File)
  const cellEls = new Map();
  const progEls = new Map();

  const comp = $('#comp');
  const ctx = comp.getContext('2d', { alpha: false });

  function layerRt(id) {
    return rt.layers[id] || (rt.layers[id] = { current: null, prev: null, t0: 0, canvas: null, ctx: null });
  }
  const layerById = (id) => P.layers.find((l) => l.id === id);
  const layerOfClip = (clipId) => P.layers.find((l) => l.clips.includes(clipId));
  const isLive = (clipId) => P.layers.some((l) => { const r = rt.layers[l.id]; return r && r.current && r.current.clipId === clipId; });

  // =====================================================================
  // Salvamento automático
  // =====================================================================
  let saveTimer = null;
  let saveWarned = false;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  async function saveNow() {
    try { await DB.put('kv', 'project', P); } catch (e) {
      console.warn('Falha ao salvar', e);
      if (!saveWarned) { saveWarned = true; toast('Não foi possível salvar no navegador. As mudanças valem só até fechar a página.'); }
    }
  }

  // =====================================================================
  // Mídia (vídeo, imagem, câmera, captura de tela)
  // =====================================================================
  function ensureMedia(clip) {
    let m = rt.media[clip.id];
    if (m) return m;
    m = rt.media[clip.id] = { el: null, url: null, ready: false, stream: null, error: null };
    if (clip.type === 'video' || clip.type === 'image') loadMediaBlob(clip, m);
    return m;
  }

  async function loadMediaBlob(clip, m) {
    let blob = pendingBlobs.get(clip.mediaKey);
    if (!blob) { try { blob = await DB.get('media', clip.mediaKey); } catch (_) { blob = null; } }
    if (rt.media[clip.id] !== m) return; // clipe removido enquanto carregava
    if (!blob) { m.error = 'Arquivo não encontrado'; refreshCell(clip); return; }
    m.url = URL.createObjectURL(blob);
    if (clip.type === 'video') {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.playsInline = true;
      v.loop = clip.loop;
      v.muted = !!clip.muted;
      v.addEventListener('loadeddata', () => {
        m.ready = true;
        if (!clip.thumb) makeThumb(clip);
        if (isLive(clip.id) && v.paused) v.play().catch(() => {});
      }, { once: true });
      v.addEventListener('error', () => { m.error = 'Formato de vídeo não suportado'; refreshCell(clip); toast(`"${clip.name}": formato não suportado pelo navegador. Use MP4 (H.264) ou WebM.`, 6000); });
      v.src = m.url;
      m.el = v;
    } else {
      const img = new Image();
      img.onload = () => { m.ready = true; if (!clip.thumb) makeThumb(clip); };
      img.onerror = () => { m.error = 'Imagem inválida'; refreshCell(clip); };
      img.src = m.url;
      m.el = img;
    }
  }

  function makeThumb(clip) {
    const m = rt.media[clip.id];
    if (!m || !m.el) return;
    const draw = () => {
      const el = m.el;
      const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
      if (!sw || !sh) return;
      const tc = document.createElement('canvas');
      tc.width = 192; tc.height = 108;
      const t = tc.getContext('2d');
      t.fillStyle = '#000'; t.fillRect(0, 0, 192, 108);
      const s = clip.fit === 'contain' ? Math.min(192 / sw, 108 / sh) : Math.max(192 / sw, 108 / sh);
      t.drawImage(el, (192 - sw * s) / 2, (108 - sh * s) / 2, sw * s, sh * s);
      try { clip.thumb = tc.toDataURL('image/jpeg', 0.72); } catch (_) { return; }
      refreshCell(clip);
      scheduleSave();
    };
    if (clip.type === 'video') {
      const v = m.el;
      const onSeek = () => {
        v.removeEventListener('seeked', onSeek);
        draw();
        if (!isLive(clip.id)) v.currentTime = 0;
      };
      v.addEventListener('seeked', onSeek);
      v.currentTime = Math.min((v.duration || 0) * 0.15, 3) || 0.01;
    } else draw();
  }

  async function startStream(clip, m) {
    if (m.stream && m.stream.active) return;
    if (m.starting) return;
    m.starting = true;
    try {
      let stream;
      if (clip.type === 'camera') {
        if (clip.obsVirtual) await prepareObsVirtualCam(clip);
        const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
        if (clip.deviceId) video.deviceId = { exact: clip.deviceId };
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      }
      if (rt.media[clip.id] !== m) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = m.el || document.createElement('video');
      v.muted = true; v.playsInline = true;
      v.srcObject = stream;
      m.el = v; m.stream = stream; m.error = null;
      stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => {
        if (m.stream === stream) { m.stream = null; m.ready = false; }
      }));
      await v.play().catch(() => {});
      m.ready = true;
      refreshCell(clip);
    } catch (e) {
      m.error = clip.type === 'camera' ? 'Câmera indisponível' : 'Captura cancelada';
      toast(clip.type === 'camera'
        ? 'Não foi possível abrir a câmera. Verifique a permissão do navegador e se outro programa está usando a câmera.'
        : 'Captura de tela cancelada.');
      refreshCell(clip);
    } finally { m.starting = false; }
  }

  function stopStream(clipId) {
    const m = rt.media[clipId];
    if (m && m.stream) { m.stream.getTracks().forEach((t) => t.stop()); m.stream = null; m.ready = false; }
  }

  function startClipMedia(clip, m, restart) {
    if (clip.type === 'video' && m.el) {
      if (restart) { try { m.el.currentTime = 0; } catch (_) {} }
      m.el.loop = clip.loop;
      m.el.playbackRate = clip.speed || 1;
      m.el.muted = !!clip.muted;
      m.el.play().catch(() => {});
    } else if (clip.type === 'camera' || clip.type === 'screen') {
      startStream(clip, m);
    } else if (clip.type === 'obs' && ObsWs.status !== 'ok') {
      toast('O OBS não está conectado. Clique em “OBS” na barra de cima.');
      obsWsConnect();
    }
  }

  function stopClipMedia(clipId) {
    const clip = P.clips[clipId], m = rt.media[clipId];
    if (!clip || !m || !m.el) return;
    if (clip.type === 'video' && !isLive(clipId)) m.el.pause();
  }

  function disposeMedia(clipId) {
    const m = rt.media[clipId];
    if (!m) return;
    if (m.stream) m.stream.getTracks().forEach((t) => t.stop());
    if (m.el && m.el.tagName === 'VIDEO') {
      try { m.el.pause(); m.el.srcObject = null; m.el.removeAttribute('src'); m.el.load(); } catch (_) {}
    }
    if (m.url) URL.revokeObjectURL(m.url);
    delete rt.media[clipId];
  }

  // =====================================================================
  // Disparo de clipes / camadas
  // =====================================================================
  function triggerClip(layer, clipId, opts = {}) {
    const clip = P.clips[clipId];
    if (!clip || !layer) return;
    const L = layerRt(layer.id);
    const m = ensureMedia(clip);
    if (L.current && L.current.clipId === clipId) {
      // já está no ar: só reconecta câmera/tela se caiu
      if ((clip.type === 'camera' || clip.type === 'screen') && !(m.stream && m.stream.active)) startStream(clip, m);
      if (isTextLike(clip)) rt.liveText = clipId;
      return;
    }
    if (isTextLike(clip)) {
      if (clip.type === 'text' && !opts.keepSlide) clip.slide = 0;
      Animador.reset(clipId);
      rt.liveText = clipId;
    }
    if (L.prev) { const old = L.prev.clipId; L.prev = null; stopClipMedia(old); }
    L.prev = L.current;
    L.current = { clipId };
    L.t0 = performance.now();
    startClipMedia(clip, m, true);
    onLiveChanged();
  }

  function clearLayer(layer) {
    const L = layerRt(layer.id);
    if (!L.current) return;
    if (L.prev) { const old = L.prev.clipId; L.prev = null; stopClipMedia(old); }
    L.prev = L.current;
    L.current = null;
    L.t0 = performance.now();
    onLiveChanged();
  }

  function triggerColumn(col) {
    if (col < 0 || col >= P.columns) return;
    for (const layer of P.layers) { const id = layer.clips[col]; if (id) triggerClip(layer, id); }
  }

  function clearAll() { P.layers.forEach(clearLayer); }

  function setBlackout(on) {
    rt.blackout = on;
    $('#btnBlackout').classList.toggle('active', on);
  }

  // =====================================================================
  // Texto / letras
  // =====================================================================
  const slidesCache = new Map();
  function getSlides(clip) {
    const c = slidesCache.get(clip.id);
    if (c && c.text === clip.text) return c.slides;
    const slides = String(clip.text || '').replace(/\r/g, '').split(/\n[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
    slidesCache.set(clip.id, { text: clip.text, slides });
    return slides;
  }

  function liveTextClip() {
    if (rt.liveText && P.clips[rt.liveText] && isLive(rt.liveText)) return P.clips[rt.liveText];
    for (let i = P.layers.length - 1; i >= 0; i--) {
      const cur = layerRt(P.layers[i].id).current;
      const c = cur && P.clips[cur.clipId];
      if (isTextLike(c)) return c;
    }
    return null;
  }
  function keyTextClip() {
    const live = liveTextClip();
    if (live) return live;
    const sel = P.clips[ui.selClip];
    return isTextLike(sel) ? sel : null;
  }

  function setSlide(clip, idx) {
    const n = getSlides(clip).length;
    idx = clamp(idx, 0, Math.max(0, n - 1));
    if (idx === clip.slide) return;
    clip.slide = idx;
    scheduleSave();
    updateSlidesActive(true);
  }

  function stepSlide(dir) {
    const clip = keyTextClip();
    if (!clip) { toast('Nenhuma letra no ar. Clique num clipe de texto primeiro.'); return; }
    if (clip.type === 'holyrics') {
      if (P.holyrics.arrows) Holy.call(dir > 0 ? 'ActionNext' : 'ActionPrevious').catch((e) => toast('Holyrics: ' + e.message));
      else toast('O controle do Holyrics pelas setas está desligado (veja o clipe Holyrics).');
      return;
    }
    setSlide(clip, (clip.slide || 0) + dir);
  }

  function clearLyrics() {
    const clip = liveTextClip();
    if (!clip) return;
    for (const l of P.layers) { const r = layerRt(l.id); if (r.current && r.current.clipId === clip.id) clearLayer(l); }
  }

  function clipText(clip) {
    if (clip.type === 'holyrics') return Holy.text;
    return getSlides(clip)[clip.slide || 0] || '';
  }

  function drawTextClip(c, clip, alpha, now, W, H) {
    Animador.desenhar(c, clip.id, clip.style, clipText(clip), W, H, alpha, now / 1000);
  }

  // =====================================================================
  // Renderização da composição
  // =====================================================================
  function isOpaque(clip) {
    if (!clip) return false;
    if (clip.type === 'holybg') return !!HolyBg.cur;
    if (clip.type === 'color') return true;
    if (isTextLike(clip)) return false;
    if (clip.fit === 'contain') return false;
    if (clip.type === 'image') return /jpe?g/i.test(clip.mime || '');
    return true;
  }

  function colorFill(c, clip, W, H) {
    if (!clip.gradient) return clip.color;
    let g;
    if (clip.dir === 'radial') g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    else if (clip.dir === 'horizontal') g = c.createLinearGradient(0, 0, W, 0);
    else if (clip.dir === 'diagonal') g = c.createLinearGradient(0, 0, W, H);
    else g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, clip.color);
    g.addColorStop(1, clip.color2);
    return g;
  }

  function drawFit(c, el, sw, sh, fit, W, H) {
    if (fit === 'stretch') { c.drawImage(el, 0, 0, W, H); return; }
    const s = fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    c.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  // Desenha um clipe no canvas da camada. gain = volume final do áudio.
  function drawClip(c, clip, alpha, now, gain, W, H) {
    if (!clip) return false;
    const m = rt.media[clip.id];
    if (clip.type === 'video' && m && m.el) {
      m.el.muted = !!clip.muted;
      m.el.volume = clamp((clip.volume == null ? 1 : clip.volume) * gain, 0, 1);
    }
    if (alpha <= 0.001) return false;
    c.globalAlpha = alpha;
    switch (clip.type) {
      case 'color':
        c.fillStyle = colorFill(c, clip, W, H);
        c.fillRect(0, 0, W, H);
        return true;
      case 'text':
      case 'holyrics':
        drawTextClip(c, clip, alpha, now, W, H);
        return true;
      case 'holybg':
        return drawHolyBg(c, clip, alpha, now, W, H);
      default: {
        if (!m || !m.el || !m.ready) return false;
        const el = m.el;
        if (el.tagName === 'VIDEO' && el.readyState < 2) return false;
        const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
        if (!sw || !sh) return false;
        if (clip.mirror) {
          c.save(); c.translate(W, 0); c.scale(-1, 1);
          drawFit(c, el, sw, sh, clip.fit, W, H);
          c.restore();
        } else drawFit(c, el, sw, sh, clip.fit, W, H);
        return true;
      }
    }
  }

  function renderLayer(layer, now, masterEff, W, H) {
    const L = layerRt(layer.id);
    if (!L.current && !L.prev) return null;
    const fade = Math.max(0, layer.fade || 0) * 1000;
    const p = fade > 0 ? Math.min(1, (now - L.t0) / fade) : 1;
    if (p >= 1 && L.prev) { const old = L.prev.clipId; L.prev = null; stopClipMedia(old); }

    if (!L.canvas) { L.canvas = document.createElement('canvas'); L.ctx = L.canvas.getContext('2d'); }
    if (L.canvas.width !== W || L.canvas.height !== H) { L.canvas.width = W; L.canvas.height = H; }
    const c = L.ctx;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);

    const layerGain = layer.bypass ? 0 : layer.opacity * masterEff;
    const cur = L.current && P.clips[L.current.clipId];
    let drew = false;
    if (L.prev) {
      const a = cur && isOpaque(cur) ? 1 : 1 - p;
      drew = drawClip(c, P.clips[L.prev.clipId], a, now, (1 - p) * layerGain, W, H) || drew;
    }
    if (cur) drew = drawClip(c, cur, p, now, p * layerGain, W, H) || drew;
    c.globalAlpha = 1;
    if (drew) layerPostFx(c, layer.fx, W, H);
    return drew ? L.canvas : null;
  }

  // vinheta e tom de cor (só onde a camada tem imagem)
  function layerPostFx(c, fx, W, H) {
    if (!(fx.vignette > 0) && !(fx.tint > 0)) return;
    c.save();
    c.globalCompositeOperation = 'source-atop';
    if (fx.tint > 0) {
      c.globalAlpha = Math.min(1, fx.tint / 100);
      c.fillStyle = fx.tintColor || '#f5a524';
      c.fillRect(0, 0, W, H);
    }
    if (fx.vignette > 0) {
      const r = Math.hypot(W, H) / 2;
      const g = c.createRadialGradient(W / 2, H / 2, r * (0.75 - 0.45 * fx.vignette / 100), W / 2, H / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, 0.35 + 0.65 * fx.vignette / 100)})`);
      c.globalAlpha = 1;
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    c.restore();
  }

  function fxFilter(fx) {
    const parts = [];
    if (fx.brightness !== 100) parts.push(`brightness(${fx.brightness}%)`);
    if (fx.contrast !== 100) parts.push(`contrast(${fx.contrast}%)`);
    if (fx.saturate !== 100) parts.push(`saturate(${fx.saturate}%)`);
    if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`);
    if (fx.gray > 0) parts.push(`grayscale(${fx.gray}%)`);
    if (fx.blur > 0) parts.push(`blur(${(fx.blur * P.height / 1080).toFixed(1)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  function renderComposition(now) {
    const W = P.width, H = P.height;
    if (comp.width !== W || comp.height !== H) { comp.width = W; comp.height = H; }
    const dt = rt.lastNow ? Math.min(100, now - rt.lastNow) : 16;
    rt.lastNow = now;

    // fade do blackout
    const target = rt.blackout ? 1 : 0;
    const step = dt / Math.max(1, (P.masterFade || 0.01) * 1000);
    rt.blackLevel = target > rt.blackLevel ? Math.min(target, rt.blackLevel + step) : Math.max(target, rt.blackLevel - step);
    const masterEff = P.master * (1 - rt.blackLevel);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    for (const layer of P.layers) { // de baixo para cima
      const lc = renderLayer(layer, now, masterEff, W, H);
      if (!lc || layer.bypass || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.filter = fxFilter(layer.fx);
      const fx = layer.fx;
      const z = (fx.zoom || 100) / 100;
      const dw = W * z, dh = H * z;
      const dx = (W - dw) / 2 + (fx.posX || 0) / 100 * W, dy = (H - dh) / 2 + (fx.posY || 0) / 100 * H;
      if (fx.mirror) {
        ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
        ctx.drawImage(lc, W - dx - dw, dy, dw, dh);
        ctx.restore();
      } else if (z !== 1 || dx || dy) ctx.drawImage(lc, dx, dy, dw, dh);
      else ctx.drawImage(lc, 0, 0);
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    if (masterEff < 1) {
      ctx.globalAlpha = 1 - masterEff;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;

    if (rt.testPattern) drawTestPattern(ctx, W, H, now);

    // copia para a janela do projetor
    if (rt.outWin && !rt.outWin.closed && rt.outCtx) {
      const oc = rt.outCanvas;
      if (oc.width !== W || oc.height !== H) { oc.width = W; oc.height = H; }
      rt.outCtx.drawImage(comp, 0, 0);
    }
  }

  // Loop de renderização. Quando o projetor está aberto, usamos o requestAnimationFrame
  // da janela do projetor (ela está sempre visível), para não congelar se o painel
  // de controle for minimizado ou ficar em segundo plano.
  let loopToken = 0, lastFrameT = 0, fpsCount = 0, fpsT = 0;
  function schedule() {
    const tok = ++loopToken;
    let w = window;
    try { if (rt.outWin && !rt.outWin.closed) w = rt.outWin; } catch (_) { w = window; }
    w.requestAnimationFrame(() => { if (tok === loopToken) frame(); });
  }
  function frame() {
    const now = performance.now();
    lastFrameT = now;
    try {
      renderComposition(now);
      if (Holy.bridge) overlayCheck();
      updateProgress();
    } catch (e) { console.error(e); }
    fpsCount++;
    if (now - fpsT > 1000) {
      $('#fps').textContent = `${P.width}×${P.height} · ${Math.round(fpsCount * 1000 / (now - fpsT))} fps`;
      fpsCount = 0; fpsT = now;
    }
    schedule();
  }
  setInterval(() => { if (performance.now() - lastFrameT > 300) schedule(); }, 300);

  // =====================================================================
  // Janela do projetor
  // =====================================================================
  const OUT_NAME = 'cdl_projetor';
  function openOutput() {
    if (rt.outWin && !rt.outWin.closed) { rt.outWin.focus(); return rt.outWin; }
    const win = window.open('', OUT_NAME, 'popup=yes,width=960,height=540');
    if (!win) { toast('O navegador bloqueou a janela do projetor. Permita pop-ups para esta página e tente de novo.', 6000); return null; }
    setupOutputWindow(win);
    keepAwake();
    return win;
  }

  function setupOutputWindow(win) {
    const d = win.document;
    d.open();
    d.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Projetor — Cara de Leão</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
canvas{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:#000}
#hint{position:fixed;left:50%;top:20px;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;
font:16px system-ui,Arial,sans-serif;padding:10px 18px;border-radius:8px;border:1px solid #444;transition:opacity .6s;cursor:default}
</style></head><body><canvas id="out"></canvas>
<div id="hint">Arraste esta janela para o projetor e dê <b>dois cliques</b> (ou tecle <b>F</b>) para tela cheia</div></body></html>`);
    d.close();
    const cv = d.getElementById('out');
    cv.width = P.width; cv.height = P.height;
    rt.outWin = win;
    rt.outCanvas = cv;
    rt.outCtx = cv.getContext('2d', { alpha: false });
    const hint = d.getElementById('hint');
    const hideHint = () => { hint.style.opacity = '0'; };
    setTimeout(hideHint, 7000);
    const toggleFs = () => {
      if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
      else d.documentElement.requestFullscreen().then(hideHint).catch(() => {});
    };
    d.addEventListener('dblclick', toggleFs);
    win.addEventListener('keydown', (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleFs(); return; }
      handleKey(e);
    });
    win.addEventListener('pagehide', () => { if (rt.outWin === win) { rt.outWin = null; rt.outCtx = null; updateOutStatus(); } });
    updateOutStatus();
    schedule();
  }

  function moveOutputToScreen(scr) {
    const win = openOutput();
    if (!win) return;
    try {
      win.moveTo(scr.availLeft, scr.availTop);
      win.resizeTo(scr.availWidth, scr.availHeight);
    } catch (_) { /* sem permissão */ }
    win.document.documentElement.requestFullscreen({ screen: scr }).catch(() => {});
    toast(`Projetor enviado para “${scr.label || 'tela'}”. Se não ficar em tela cheia, dê dois cliques na imagem do projetor (ou tecle F nela).`, 7000);
  }

  async function moveOutputToSecondScreen() {
    const win = openOutput();
    if (!win) return;
    if (!('getScreenDetails' in window)) {
      toast('Arraste a janela do projetor para a segunda tela e dê dois cliques nela para tela cheia.', 6000);
      return;
    }
    try {
      const sd = await window.getScreenDetails();
      const cur = sd.currentScreen;
      const other = sd.screens.find((s) => s.left !== cur.left || s.top !== cur.top);
      if (!other) { toast('Só uma tela foi detectada. No Windows, aperte Win+P e escolha "Estender".', 7000); return; }
      win.moveTo(other.availLeft, other.availTop);
      win.resizeTo(other.availWidth, other.availHeight);
      win.document.documentElement.requestFullscreen({ screen: other }).catch(() => {});
      toast('Projetor enviado para a 2ª tela. Se não ficar em tela cheia, dê dois cliques na imagem dele.', 6000);
    } catch (e) {
      toast('Sem permissão para mover janelas. Arraste a janela do projetor manualmente e dê dois cliques nela.', 7000);
    }
  }

  function updateOutStatus() {
    const on = !!(rt.outWin && !rt.outWin.closed);
    const s = $('#outStatus');
    s.textContent = on ? '● Projetor conectado' : 'Projetor fechado';
    s.classList.toggle('on', on);
    s.classList.toggle('off', !on);
    $('#btnOutput').textContent = on ? '📽 Mostrar projetor' : '📽 Abrir projetor';
  }
  setInterval(() => {
    if (rt.outWin && rt.outWin.closed) { rt.outWin = null; rt.outCtx = null; }
    updateOutStatus();
  }, 1000);

  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { /* sem suporte */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

  // =====================================================================
  // Grade de clipes (deck)
  // =====================================================================
  function colorCss(clip) {
    if (!clip.gradient) return clip.color;
    if (clip.dir === 'radial') return `radial-gradient(circle, ${clip.color}, ${clip.color2})`;
    const ang = clip.dir === 'horizontal' ? '90deg' : clip.dir === 'diagonal' ? '135deg' : '180deg';
    return `linear-gradient(${ang}, ${clip.color}, ${clip.color2})`;
  }

  function cellInner(clip) {
    const m = rt.media[clip.id];
    let thumb;
    if (m && m.error) thumb = `<div class="ithumb" title="${esc(m.error)}">⚠️</div>`;
    else if (clip.type === 'text') thumb = `<div class="tthumb">${esc(getSlides(clip)[0] || '(vazio)')}</div>`;
    else if (clip.type === 'holyrics') thumb = `<div class="tthumb holy">${esc(Holy.text || (Holy.status === 'ok' ? '(nada no ar no Holyrics)' : 'Holyrics desconectado'))}</div>`;
    else if (clip.type === 'color') thumb = `<div class="cthumb" style="background:${esc(colorCss(clip))}"></div>`;
    else if (clip.type === 'camera') thumb = `<div class="ithumb">${clip.obsVirtual ? '🎥' : '📷'}</div>`;
    else if (clip.type === 'holybg') thumb = HolyBg.thumb ? `<img src="${HolyBg.thumb}" draggable="false" alt="">` : `<div class="ithumb">🎞</div>`;
    else if (clip.type === 'obs') thumb = clip.thumb ? `<img src="${clip.thumb}" draggable="false" alt="">` : `<div class="ithumb">📺</div>`;
    else if (clip.type === 'screen') thumb = `<div class="ithumb">🖥</div>`;
    else if (clip.thumb) thumb = `<img src="${clip.thumb}" draggable="false" alt="">`;
    else thumb = `<div class="ithumb">⏳</div>`;
    const extra = clip.type === 'video' && clip.muted ? ' 🔇' : '';
    return `<div class="thumb">${thumb}<span class="badge">${BADGE[clip.type]}${extra}</span>` +
      `<button class="edit" data-act="edit" title="Editar sem colocar no ar">✎</button>` +
      `<span class="live-tag">NO AR</span><div class="prog"><i></i></div></div>` +
      `<div class="cname" title="${esc(clip.name)}">${esc(clip.name)}</div>`;
  }

  function renderDeck() {
    const deck = $('#deck');
    deck.style.gridTemplateColumns = `200px repeat(${P.columns}, var(--cell-w)) 30px`;
    let html = `<div class="corner"><span>Camadas</span><button class="mini" data-act="addlayer" title="Adicionar camada">+ camada</button></div>`;
    for (let c = 0; c < P.columns; c++) {
      html += `<button class="col-trigger" data-col="${c}" title="Colocar no ar a coluna ${c + 1} inteira${c < 9 ? ` (tecla ${c + 1})` : ''}">▶ ${c + 1}</button>`;
    }
    html += `<button class="col-add" data-act="addcol" title="Adicionar coluna">+</button>`;
    for (let i = P.layers.length - 1; i >= 0; i--) {
      const L = P.layers[i];
      html += `<div class="layer-head${L.bypass ? ' bypassed' : ''}" data-layer="${L.id}">
        <div class="lh-row"><span class="lh-num" title="${i === P.layers.length - 1 ? 'Camada de cima' : i === 0 ? 'Camada de baixo' : ''}">${i + 1}</span>
          <span class="lh-name" title="Duplo clique para renomear">${esc(L.name)}</span>
          <button class="ico" data-act="bypass" title="${L.bypass ? 'Mostrar camada' : 'Ocultar camada'}">${L.bypass ? '🚫' : '👁'}</button>
          <button class="ico danger" data-act="clear" title="Tirar esta camada do ar">✕</button></div>
        <input type="range" class="lh-opacity" min="0" max="1" step="0.01" value="${L.opacity}" title="Opacidade (duplo clique = 100%)">
        <div class="lh-row small">
          <select class="lh-blend" title="Modo de mistura">${BLENDS.map(([v, t]) => `<option value="${v}"${v === L.blend ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <label title="Tempo da transição (segundos)">⟷<input type="number" class="lh-fade" min="0" max="10" step="0.1" value="${L.fade}">s</label>
        </div></div>`;
      for (let c = 0; c < P.columns; c++) {
        const id = L.clips[c];
        const clip = id && P.clips[id];
        if (clip) html += `<div class="cell" draggable="true" data-layer="${L.id}" data-col="${c}" data-clip="${clip.id}">${cellInner(clip)}</div>`;
        else html += `<div class="cell empty" data-layer="${L.id}" data-col="${c}" title="Adicionar clipe (ou arraste um arquivo aqui)"><span>+</span></div>`;
      }
      html += '<div></div>';
    }
    deck.innerHTML = html;
    cellEls.clear(); progEls.clear();
    $$('.cell[data-clip]', deck).forEach((e) => { cellEls.set(e.dataset.clip, e); progEls.set(e.dataset.clip, e.querySelector('.prog i')); });
    onLiveChanged();
    markSelected();
  }

  function refreshCell(clip) {
    const e = cellEls.get(clip.id);
    if (!e) return;
    e.innerHTML = cellInner(clip);
    progEls.set(clip.id, e.querySelector('.prog i'));
  }

  function onLiveChanged() {
    for (const [id, e] of cellEls) {
      const live = isLive(id);
      e.classList.toggle('live', live);
      if (!live) { const b = progEls.get(id); if (b) b.style.width = '0'; }
    }
    for (const e of $$('.layer-head')) {
      const r = rt.layers[e.dataset.layer];
      e.classList.toggle('onair', !!(r && r.current));
    }
    updateSlidesActive(false);
  }

  function markSelected() {
    for (const [id, e] of cellEls) e.classList.toggle('selected', id === ui.selClip);
    for (const e of $$('.layer-head')) e.classList.toggle('selected', !ui.selClip && e.dataset.layer === ui.selLayer);
  }

  function updateProgress() {
    for (const L of P.layers) {
      const cur = rt.layers[L.id] && rt.layers[L.id].current;
      if (!cur) continue;
      const clip = P.clips[cur.clipId];
      if (!clip || clip.type !== 'video') continue;
      const m = rt.media[clip.id], bar = progEls.get(clip.id);
      if (m && m.el && bar && m.el.duration) bar.style.width = (m.el.currentTime / m.el.duration * 100).toFixed(1) + '%';
    }
  }

  function select(clipId, layerId) {
    ui.selClip = clipId;
    ui.selLayer = layerId;
    markSelected();
    renderInspector();
    renderSlides();
  }

  function placeClip(layer, col, clip) {
    P.clips[clip.id] = clip;
    layer.clips[col] = clip.id;
    renderDeck();
    select(clip.id, layer.id);
    scheduleSave();
  }

  function addColumns(n) {
    P.columns += n;
    for (const l of P.layers) for (let i = 0; i < n; i++) l.clips.push(null);
  }

  function addLayer() {
    P.layers.push(newLayer('Camada ' + (P.layers.length + 1), P.columns));
    renderDeck();
    scheduleSave();
  }

  function removeLayer(layer) {
    if (P.layers.length <= 1) { toast('O projeto precisa de pelo menos uma camada.'); return; }
    if (!confirm(`Remover a camada "${layer.name}" e todos os clipes dela?`)) return;
    for (const id of layer.clips) if (id) removeClipData(id);
    delete rt.layers[layer.id];
    P.layers = P.layers.filter((l) => l !== layer);
    if (ui.selLayer === layer.id) { ui.selLayer = null; ui.selClip = null; }
    renderAll();
    scheduleSave();
  }

  function moveLayer(layer, dir) {
    const i = P.layers.indexOf(layer), j = i + dir;
    if (j < 0 || j >= P.layers.length) return;
    [P.layers[i], P.layers[j]] = [P.layers[j], P.layers[i]];
    renderDeck();
    scheduleSave();
  }

  function removeClipData(id) {
    const clip = P.clips[id];
    if (!clip) return;
    for (const L of P.layers) {
      const i = L.clips.indexOf(id);
      if (i >= 0) L.clips[i] = null;
      const r = rt.layers[L.id];
      if (r && r.current && r.current.clipId === id) r.current = null;
      if (r && r.prev && r.prev.clipId === id) r.prev = null;
    }
    disposeMedia(id);
    delete P.clips[id];
    Animador.reset(id);
    slidesCache.delete(id);
    if (clip.mediaKey && !Object.values(P.clips).some((c) => c.mediaKey === clip.mediaKey)) {
      pendingBlobs.delete(clip.mediaKey);
      DB.del('media', clip.mediaKey).catch(() => {});
    }
    if (ui.selClip === id) ui.selClip = null;
  }

  function removeClip(id) {
    const clip = P.clips[id];
    if (!clip) return;
    if (!confirm(`Remover o clipe "${clip.name}"?`)) return;
    removeClipData(id);
    renderAll();
    scheduleSave();
  }

  function duplicateClip(id) {
    const clip = P.clips[id];
    const layer = layerOfClip(id);
    if (!clip || !layer) return;
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = uid();
    copy.name = clip.name + ' (cópia)';
    let col = layer.clips.indexOf(id) + 1;
    while (col < P.columns && layer.clips[col]) col++;
    if (col >= P.columns) addColumns(col - P.columns + 1);
    if (copy.type === 'video' || copy.type === 'image') ensureMedia(copy);
    placeClip(layer, col, copy);
  }

  function moveClip(srcLayer, srcCol, dstLayer, dstCol) {
    if (srcLayer === dstLayer && srcCol === dstCol) return;
    const a = srcLayer.clips[srcCol], b = dstLayer.clips[dstCol];
    srcLayer.clips[srcCol] = b;
    dstLayer.clips[dstCol] = a;
    renderDeck();
    scheduleSave();
  }

  function guessType(file) {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('image/')) return 'image';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) return 'video';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
    return null;
  }

  function importFiles(files, layer, col) {
    let c = col, added = 0, last = null;
    for (const f of files) {
      const type = guessType(f);
      if (!type) { toast(`"${f.name}" não é vídeo nem imagem.`); continue; }
      while (c < P.columns && layer.clips[c]) c++;
      if (c >= P.columns) addColumns(c - P.columns + 1);
      const key = uid();
      pendingBlobs.set(key, f);
      DB.put('media', key, f).catch(() => toast(`Não foi possível guardar "${f.name}" no navegador (sem espaço?). Ele funciona até recarregar a página.`, 6000));
      const isJpeg = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name);
      const clip = {
        id: uid(), type, name: f.name.replace(/\.[^.]+$/, ''), mediaKey: key, mime: f.type,
        fit: type === 'image' && !isJpeg ? 'contain' : 'cover',
        loop: true, speed: 1, muted: false, volume: 1, thumb: null,
      };
      P.clips[clip.id] = clip;
      layer.clips[c] = clip.id;
      ensureMedia(clip);
      last = clip; added++; c++;
    }
    if (!added) return;
    renderDeck();
    select(last.id, layer.id);
    scheduleSave();
  }

  // ---------- eventos do deck ----------
  const deck = $('#deck');
  deck.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) {
      const layer = layerById(cell.dataset.layer);
      const col = +cell.dataset.col;
      const clipId = layer && layer.clips[col];
      if (!clipId) { openAddMenu(cell, layer, col); return; }
      if (e.target.closest('[data-act=edit]')) { select(clipId, layer.id); return; }
      triggerClip(layer, clipId);
      select(clipId, layer.id);
      return;
    }
    const colBtn = e.target.closest('.col-trigger');
    if (colBtn) { triggerColumn(+colBtn.dataset.col); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'addcol') { addColumns(1); renderDeck(); scheduleSave(); return; }
    if (act && act.dataset.act === 'addlayer') { addLayer(); return; }
    const lh = e.target.closest('.layer-head');
    if (lh) {
      const layer = layerById(lh.dataset.layer);
      if (act && act.dataset.act === 'clear') { clearLayer(layer); return; }
      if (act && act.dataset.act === 'bypass') { layer.bypass = !layer.bypass; renderDeck(); scheduleSave(); return; }
      if (!e.target.closest('input,select,label')) select(null, layer.id);
    }
  });
  deck.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cell[data-clip]');
    if (!cell) return;
    e.preventDefault();
    select(cell.dataset.clip, cell.dataset.layer);
  });
  deck.addEventListener('input', (e) => {
    const lh = e.target.closest('.layer-head');
    if (!lh) return;
    const layer = layerById(lh.dataset.layer);
    if (e.target.classList.contains('lh-opacity')) layer.opacity = parseFloat(e.target.value);
    else if (e.target.classList.contains('lh-fade')) layer.fade = Math.max(0, parseFloat(e.target.value) || 0);
    scheduleSave();
  });
  deck.addEventListener('change', (e) => {
    const lh = e.target.closest('.layer-head');
    if (!lh) return;
    if (e.target.classList.contains('lh-blend')) { layerById(lh.dataset.layer).blend = e.target.value; scheduleSave(); }
  });
  deck.addEventListener('dblclick', (e) => {
    const lh = e.target.closest('.layer-head');
    if (!lh) return;
    const layer = layerById(lh.dataset.layer);
    if (e.target.classList.contains('lh-opacity')) { layer.opacity = 1; e.target.value = 1; scheduleSave(); return; }
    if (e.target.classList.contains('lh-name')) {
      const name = prompt('Nome da camada:', layer.name);
      if (name && name.trim()) { layer.name = name.trim(); renderDeck(); renderInspector(); scheduleSave(); }
    }
  });

  // arrastar e soltar
  const CELL_MIME = 'application/x-cdl-cell';
  deck.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.cell[data-clip]');
    if (!cell) return;
    e.dataTransfer.setData(CELL_MIME, `${cell.dataset.layer}|${cell.dataset.col}`);
    e.dataTransfer.effectAllowed = 'move';
  });
  deck.addEventListener('dragover', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    $$('.cell.drop', deck).forEach((x) => x !== cell && x.classList.remove('drop'));
    cell.classList.add('drop');
  });
  deck.addEventListener('dragleave', (e) => {
    const cell = e.target.closest('.cell');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('drop');
  });
  deck.addEventListener('drop', (e) => {
    const cell = e.target.closest('.cell');
    $$('.cell.drop', deck).forEach((x) => x.classList.remove('drop'));
    if (!cell) return;
    e.preventDefault();
    const layer = layerById(cell.dataset.layer), col = +cell.dataset.col;
    if (e.dataTransfer.files && e.dataTransfer.files.length) { importFiles(Array.from(e.dataTransfer.files), layer, col); return; }
    const src = e.dataTransfer.getData(CELL_MIME);
    if (src) {
      const [lid, c] = src.split('|');
      const sl = layerById(lid);
      if (sl) moveClip(sl, +c, layer, col);
    }
  });
  // evita que o navegador abra o arquivo se soltar fora das células
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---------- menu de adicionar ----------
  const addMenu = $('#addMenu');
  const mainMenu = $('#mainMenu');
  function showPopover(menu, anchor) {
    hidePopovers();
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = r.left, y = r.bottom + 4;
    if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }
  function hidePopovers() { addMenu.classList.add('hidden'); mainMenu.classList.add('hidden'); }
  function openAddMenu(cell, layer, col) {
    ui.addTarget = { layerId: layer.id, col };
    showPopover(addMenu, cell);
  }
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.popover') && !e.target.closest('#btnMenu') && !e.target.closest('.cell.empty')) hidePopovers();
  });

  addMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b || !ui.addTarget) return;
    hidePopovers();
    const layer = layerById(ui.addTarget.layerId), col = ui.addTarget.col;
    if (!layer) return;
    switch (b.dataset.add) {
      case 'file': $('#fileInput').click(); return;
      case 'text': {
        placeClip(layer, col, newTextClip('Nova letra', 'Primeira estrofe\nda música\n\nSegunda estrofe\nda música'));
        setTimeout(() => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
        return;
      }
      case 'color': placeClip(layer, col, newColorClip('Cor', '#1b3b8f', '#000000', true, 'vertical')); return;
      case 'camera': placeClip(layer, col, { id: uid(), type: 'camera', name: 'Câmera', deviceId: '', fit: 'cover', mirror: false }); return;
      case 'screen': placeClip(layer, col, { id: uid(), type: 'screen', name: 'Captura de tela', fit: 'contain' }); return;
      case 'ndi': addNdiClip(layer, col); return;
      case 'obsvcam': addObsVirtualCamClip(layer, col); return;
      case 'obssource': openObsDialog(layer.id, col); return;
      case 'holyrics': {
        const st = defaultTextStyle();
        placeClip(layer, col, { id: uid(), type: 'holyrics', name: 'Holyrics ao vivo', style: st });
        holyPoll();
        if (!P.holyrics.token) openHolyDialog();
        return;
      }
      case 'holyimport': openHolyDialog('musicas', layer.id); return;
      case 'holybg':
        placeClip(layer, col, newHolyBgClip());
        holyPoll(); holyBgPoll();
        if (!P.holyrics.token) openHolyDialog();
        return;
      case 'holysplit': setupHolyLayers(); return;
    }
  });
  $('#fileInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !ui.addTarget) return;
    const layer = layerById(ui.addTarget.layerId);
    if (layer) importFiles(files, layer, ui.addTarget.col);
  });

  // =====================================================================
  // Painel de slides (letras)
  // =====================================================================
  function slidesTarget() {
    const sel = P.clips[ui.selClip];
    if (isTextLike(sel)) return sel;
    return liveTextClip();
  }

  function renderSlides() {
    const panel = $('#slidesPanel');
    const clip = slidesTarget();
    ui.slidesClip = clip ? clip.id : null;
    if (!clip) {
      panel.innerHTML = `<div class="empty-hint">
        <h3>Letras e versículos</h3>
        Clique num clipe de <b>TEXTO</b> na grade para ver os slides aqui.<br>
        Para criar um, clique numa célula vazia <b>+</b> e escolha <i>Texto / Letra de música</i>.
        Cole a letra e deixe uma <b>linha em branco</b> entre as estrofes — cada bloco vira um slide.<br><br>
        Durante o culto: <kbd>→</kbd> próximo slide · <kbd>←</kbd> anterior · <kbd>C</kbd> tira a letra · <kbd>B</kbd> tela preta.
        Passadores de slide (clicker) também funcionam.
      </div>`;
      return;
    }
    if (clip.type === 'holyrics') { renderHolyPanel(panel, clip); return; }
    const slides = getSlides(clip);
    const layer = layerOfClip(clip.id);
    panel.innerHTML = '';
    const head = h('div', { class: 'sp-head' },
      h('b', {}, clip.name),
      h('span', { class: 'pill', id: 'spPill' }),
      h('span', { class: 'muted' }, `${layer ? layer.name : ''} · ${slides.length} slide${slides.length === 1 ? '' : 's'}`),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', title: 'Slide anterior (←)', onclick: () => setSlide(clip, clip.slide - 1) }, '◀ Anterior'),
      h('button', { class: 'btn small', title: 'Próximo slide (→)', onclick: () => setSlide(clip, clip.slide + 1) }, 'Próximo ▶'),
      h('button', {
        class: 'btn small', id: 'spLive',
        onclick: () => {
          const l = layerOfClip(clip.id);
          if (!l) return;
          if (isLive(clip.id)) clearLayer(l); else triggerClip(l, clip.id, { keepSlide: true });
        },
      }));
    const grid = h('div', { class: 'slides' });
    if (!slides.length) grid.append(h('div', { class: 'muted' }, 'Sem texto. Digite a letra no painel à direita.'));
    slides.forEach((s, i) => {
      grid.append(h('div', {
        class: 'slide', 'data-i': i, title: 'Clique para mostrar este slide',
        onclick: () => {
          setSlide(clip, i);
          const l = layerOfClip(clip.id);
          if (l && !isLive(clip.id)) triggerClip(l, clip.id, { keepSlide: true });
        },
      }, h('span', { class: 'n' }, String(i + 1)), clip.style.uppercase ? s.toLocaleUpperCase('pt-BR') : s));
    });
    panel.append(head, grid);
    updateSlidesActive(false);
  }

  let slidesTimer;
  function renderSlidesDebounced() { clearTimeout(slidesTimer); slidesTimer = setTimeout(renderSlides, 250); }

  function updateSlidesActive(scroll) {
    const target = slidesTarget();
    if ((target ? target.id : null) !== ui.slidesClip) { renderSlides(); return; }
    if (!target) return;
    const live = isLive(target.id);
    const pill = $('#spPill');
    if (pill) { pill.textContent = live ? 'NO AR' : 'fora do ar'; pill.classList.toggle('live', live); }
    const btn = $('#spLive');
    if (btn) btn.textContent = live ? '✕ Tirar do ar' : '▶ Colocar no ar';
    if (target.type === 'holyrics') { updateHolyPanel(scroll); return; }
    let cur = null;
    for (const e of $$('#slidesPanel .slide')) {
      const on = +e.dataset.i === target.slide;
      e.classList.toggle('current', on);
      e.classList.toggle('onair', on && live);
      if (on) cur = e;
    }
    if (scroll && cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // =====================================================================
  // Inspetor (propriedades)
  // =====================================================================
  function field(label, control) { return h('label', { class: 'f' }, h('span', { class: 'fl' }, label), control, h('span')); }
  function rangeF(label, obj, key, min, max, step, onCh, fmt) {
    fmt = fmt || ((v) => String(v));
    const out = h('span', { class: 'fv' }, fmt(obj[key]));
    const inp = h('input', {
      type: 'range', min, max, step, value: obj[key],
      oninput: () => { obj[key] = parseFloat(inp.value); out.textContent = fmt(obj[key]); if (onCh) onCh(); scheduleSave(); },
    });
    return h('div', { class: 'f' }, h('span', { class: 'fl' }, label), inp, out);
  }
  function selectF(label, obj, key, opts, onCh) {
    const s = h('select', { onchange: () => { obj[key] = s.value; if (onCh) onCh(); scheduleSave(); } },
      opts.map(([v, t]) => h('option', { value: v }, t)));
    s.value = obj[key];
    return field(label, s);
  }
  function checkF(label, obj, key, onCh) {
    const c = h('input', { type: 'checkbox', checked: !!obj[key], onchange: () => { obj[key] = c.checked; if (onCh) onCh(); scheduleSave(); } });
    return h('label', { class: 'f chk' }, c, h('span', {}, label));
  }
  function colorInput(obj, key, onCh) {
    const c = h('input', { type: 'color', value: obj[key], oninput: () => { obj[key] = c.value; if (onCh) onCh(); scheduleSave(); } });
    return c;
  }
  function colorF(label, obj, key, onCh) { return field(label, colorInput(obj, key, onCh)); }
  function textF(label, obj, key, onCh) {
    const t = h('input', { type: 'text', value: obj[key] || '', oninput: () => { obj[key] = t.value; if (onCh) onCh(); scheduleSave(); } });
    return field(label, t);
  }

  function renderInspector() {
    const box = $('#inspector');
    box.innerHTML = '';
    const clip = P.clips[ui.selClip];
    const layer = clip ? layerOfClip(clip.id) : layerById(ui.selLayer);
    if (clip) box.append(clipSection(clip));
    if (layer) box.append(layerSection(layer));
    if (!clip && !layer) {
      box.append(h('section', { class: 'insp-sec' },
        h('h3', {}, 'Começando'),
        h('ol', { class: 'hint', style: 'font-size:12px;line-height:1.7;padding-left:18px' },
          h('li', {}, 'Clique em “Abrir projetor” e arraste a janela para o projetor/TV. Dois cliques = tela cheia.'),
          h('li', {}, 'Arraste vídeos e imagens do computador para as células da grade.'),
          h('li', {}, 'Clique num clipe para colocá-lo no ar. A camada de cima fica por cima.'),
          h('li', {}, 'Crie clipes de texto para as letras e use as setas (ou o passador) para trocar os slides.'),
          h('li', {}, 'Clique com o botão direito num clipe para editar sem colocar no ar.'))));
    }
  }

  function clipSection(clip) {
    const sec = h('section', { class: 'insp-sec' });
    sec.append(h('h3', {}, TYPE_LABEL[clip.type] || 'Clipe'));
    sec.append(textF('Nome', clip, 'name', () => { refreshCell(clip); if (clip.type === 'text') renderSlidesDebounced(); }));
    const m = rt.media[clip.id];
    const reCell = () => refreshCell(clip);

    switch (clip.type) {
      case 'video': {
        sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS, () => { clip.thumb = null; makeThumb(clip); }));
        sec.append(checkF('Repetir em loop', clip, 'loop', () => { if (m && m.el) m.el.loop = clip.loop; }));
        sec.append(rangeF('Velocidade', clip, 'speed', 0.25, 2, 0.05, () => { if (m && m.el) m.el.playbackRate = clip.speed; }, (v) => v.toFixed(2) + '×'));
        sec.append(checkF('Sem áudio (mudo)', clip, 'muted', () => { if (m && m.el) m.el.muted = clip.muted; reCell(); }));
        sec.append(rangeF('Volume', clip, 'volume', 0, 1, 0.01, null, (v) => Math.round(v * 100) + '%'));
        if (m && m.el && m.el.videoWidth) {
          const d = m.el.duration || 0;
          sec.append(h('div', { class: 'hint' }, `${m.el.videoWidth}×${m.el.videoHeight} · ${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`));
        }
        sec.append(h('div', { class: 'hint' }, 'O áudio do vídeo sai pelo computador e acompanha as transições e a opacidade da camada.'));
        break;
      }
      case 'image':
        sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS, () => { clip.thumb = null; makeThumb(clip); }));
        break;
      case 'color':
        sec.append(colorF('Cor', clip, 'color', reCell));
        sec.append(checkF('Degradê', clip, 'gradient', () => { reCell(); renderInspector(); }));
        if (clip.gradient) {
          sec.append(colorF('Cor 2', clip, 'color2', reCell));
          sec.append(selectF('Direção', clip, 'dir', [['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['diagonal', 'Diagonal'], ['radial', 'Radial (centro)']], reCell));
        }
        break;
      case 'text':
        textControls(sec, clip);
        break;
      case 'holyrics':
        holyControls(sec, clip);
        break;
      case 'obs':
        obsClipControls(sec, clip);
        break;
      case 'holybg':
        holyBgControls(sec, clip);
        break;
      case 'camera': {
        const sel = h('select', {
          onchange: () => {
            clip.deviceId = sel.value; scheduleSave();
            stopStream(clip.id);
            if (isLive(clip.id)) startStream(clip, ensureMedia(clip));
          },
        }, h('option', { value: '' }, 'Padrão do sistema'));
        const fill = async () => {
          try {
            const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
            sel.innerHTML = '';
            sel.append(h('option', { value: '' }, 'Padrão do sistema'));
            devs.forEach((d, i) => sel.append(h('option', { value: d.deviceId }, (/ndi/i.test(d.label) ? '📡 ' : '') + (d.label || `Câmera ${i + 1}`))));
            sel.value = clip.deviceId || '';
          } catch (_) { /* sem permissão */ }
        };
        fill();
        sec.append(field('Dispositivo', sel));
        sec.append(h('div', { class: 'hint' }, 'Placas de captura HDMI/USB e fontes NDI (pelo “NDI Webcam Input” do NDI Tools) aparecem aqui como câmera. Se os nomes não aparecerem, coloque o clipe no ar uma vez e clique em “Atualizar lista”.'));
        sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS));
        sec.append(checkF('Espelhar imagem', clip, 'mirror'));
        sec.append(h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: fill }, '↻ Atualizar lista'),
          h('button', { class: 'btn small', onclick: () => { stopStream(clip.id); startStream(clip, ensureMedia(clip)); } }, 'Reconectar'),
          h('button', { class: 'btn small', onclick: () => stopStream(clip.id) }, 'Desligar câmera')));
        break;
      }
      case 'screen':
        sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS));
        sec.append(h('div', { class: 'hint' }, 'Mostra uma janela (ex.: PowerPoint, navegador, Holyrics) ou a tela inteira. O navegador pergunta qual janela ao colocar no ar.'));
        sec.append(h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: () => { stopStream(clip.id); startStream(clip, ensureMedia(clip)); } }, 'Escolher janela/tela…'),
          h('button', { class: 'btn small', onclick: () => stopStream(clip.id) }, 'Parar captura')));
        break;
    }

    sec.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: () => { const l = layerOfClip(clip.id); if (l) triggerClip(l, clip.id, { keepSlide: true }); } }, '▶ Colocar no ar'),
      h('button', { class: 'btn small', onclick: () => duplicateClip(clip.id) }, '⧉ Duplicar'),
      h('button', { class: 'btn small danger', onclick: () => removeClip(clip.id) }, '🗑 Remover')));
    return sec;
  }

  function textControls(sec, clip) {
    const ta = h('textarea', {
      rows: 10, value: clip.text, spellcheck: true,
      placeholder: 'Cole a letra aqui.\n\nDeixe uma linha em branco\nentre as estrofes.',
      oninput: () => {
        clip.text = ta.value;
        const n = getSlides(clip).length;
        if (clip.slide >= n) clip.slide = Math.max(0, n - 1);
        refreshCell(clip);
        renderSlidesDebounced();
        scheduleSave();
      },
    });
    sec.append(h('div', { class: 'f full' }, ta));
    sec.append(h('div', { class: 'hint' }, 'Uma linha em branco = novo slide. O texto diminui sozinho se não couber.'));
    styleControls(sec, clip);
  }

  function styleControls(sec, clip) {
    const s = clip.style;
    const redo = () => { renderInspector(); renderSlidesDebounced(); };
    const testar = () => Animador.reset(clip.id);

    sec.append(h('h4', {}, 'Visual pronto (estilo Resolume)'));
    sec.append(h('div', { class: 'look-grid' }, Object.keys(TEXT_PRESETS).map((name) =>
      h('button', { class: 'btn small look', onclick: () => { Object.assign(s, BASE_LOOK, TEXT_PRESETS[name]); TX.garantirFonte(s.font); scheduleSave(); testar(); redo(); } }, name))));

    // ---- fonte
    sec.append(h('h4', {}, 'Fonte'));
    const fsel = h('select', { onchange: () => { s.font = fsel.value; TX.garantirFonte(s.font); scheduleSave(); testar(); } },
      h('optgroup', { label: 'Fontes da web (precisam de internet)' }, TX.FONTES_WEB.map((f) => h('option', { value: f }, f))),
      h('optgroup', { label: 'Fontes do Windows' }, TX.FONTES_SISTEMA.map((f) => h('option', { value: f }, f))),
      P.fontesLocais.length ? h('optgroup', { label: 'Instaladas neste computador' }, P.fontesLocais.map((f) => h('option', { value: f }, f))) : null);
    if (![...TX.FONTES_WEB, ...TX.FONTES_SISTEMA, ...P.fontesLocais].includes(s.font)) fsel.prepend(h('option', { value: s.font }, s.font));
    fsel.value = s.font;
    sec.append(field('Fonte', fsel));
    if ('queryLocalFonts' in window) {
      sec.append(h('div', { class: 'btn-row', style: 'margin-top:0' }, h('button', {
        class: 'btn small', onclick: async () => {
          try {
            const fams = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
            P.fontesLocais = fams; scheduleSave(); redo();
            toast(`${fams.length} fontes do computador adicionadas à lista.`);
          } catch (_) { toast('O navegador não deu acesso às fontes do computador.'); }
        },
      }, '🔎 Usar fontes instaladas no computador')));
    }
    sec.append(selectF('Peso', s, 'weight', [['400', 'Normal'], ['700', 'Negrito'], ['900', 'Extra negrito']], () => { s.weight = +s.weight; testar(); }));
    sec.append(rangeF('Tamanho', s, 'size', 20, 240, 1, null, (v) => v + 'px'));
    sec.append(rangeF('Espaço letras', s, 'letterSpacing', -5, 40, 1, null, (v) => v + 'px'));
    sec.append(h('div', { class: 'inline' }, checkF('Itálico', s, 'italic'), checkF('MAIÚSCULAS', s, 'uppercase', () => renderSlidesDebounced())));

    // ---- cor e acabamento
    sec.append(h('h4', {}, 'Cor e acabamento'));
    sec.append(colorF('Cor do texto', s, 'color'));
    sec.append(checkF('Degradê na letra', s, 'gradient', redo));
    if (s.gradient) sec.append(colorF('Cor de baixo', s, 'color2'));
    sec.append(h('div', { class: 'f' }, h('span', { class: 'fl' }, 'Contorno'),
      (() => {
        const out = h('span', { class: 'fv' }, String(s.outline));
        const r = h('input', { type: 'range', min: 0, max: 12, step: 1, value: s.outline, oninput: () => { s.outline = +r.value; out.textContent = r.value; scheduleSave(); } });
        return h('div', { class: 'inline' }, r, colorInput(s, 'outlineColor'), out);
      })(), h('span')));
    sec.append(h('div', { class: 'f' }, h('span', { class: 'fl' }, 'Brilho (glow)'),
      (() => {
        const out = h('span', { class: 'fv' }, String(s.glow));
        const r = h('input', { type: 'range', min: 0, max: 60, step: 1, value: s.glow, oninput: () => { s.glow = +r.value; out.textContent = r.value; scheduleSave(); } });
        return h('div', { class: 'inline' }, r, colorInput(s, 'glowColor'), out);
      })(), h('span')));
    sec.append(checkF('Sombra', s, 'shadow'));

    // ---- animação
    sec.append(h('h4', {}, 'Animação'));
    const opts = (o) => Object.entries(o);
    sec.append(selectF('Entrada', s, 'anim', opts(TX.ANIMS), () => { testar(); redo(); }));
    if (s.anim !== 'maquina' && s.anim !== 'nenhuma') sec.append(rangeF('Duração', s, 'animDur', 0.1, 3, 0.05, null, (v) => v.toFixed(2) + 's'));
    if (['subir', 'cair', 'palavra', 'letra', 'maquina', 'escala', 'tracking'].includes(s.anim)) {
      sec.append(rangeF(s.anim === 'maquina' ? 'Velocidade' : 'Atraso entre partes', s, 'stagger', 0.01, 0.4, 0.01, null, (v) => v.toFixed(2) + 's'));
    }
    sec.append(selectF('Saída', s, 'exitAnim', opts(TX.SAIDAS)));
    if (s.exitAnim !== 'nenhuma') sec.append(rangeF('Duração saída', s, 'exitDur', 0.1, 2, 0.05, null, (v) => v.toFixed(2) + 's'));
    sec.append(selectF('Enquanto no ar', s, 'idle', opts(TX.IDLES)));
    sec.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: testar }, '▶ Repetir a animação')));
    sec.append(h('div', { class: 'hint' }, 'A animação roda a cada troca de slide (também quando o Holyrics avança) e vale para o projetor e as saídas do OBS.'));

    // ---- posição
    sec.append(h('h4', {}, 'Posição'));
    sec.append(selectF('Vertical', s, 'valign', [['top', 'Topo'], ['middle', 'Centro'], ['bottom', 'Rodapé']]));
    sec.append(selectF('Alinhamento', s, 'align', [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']]));
    sec.append(rangeF('Margem', s, 'margin', 0, 400, 5, null, (v) => v + 'px'));
    sec.append(rangeF('Entrelinhas', s, 'lineHeight', 0.8, 2, 0.05, null, (v) => v.toFixed(2)));

    sec.append(h('h4', {}, 'Fundo atrás do texto'));
    sec.append(selectF('Tipo', s, 'box', [['none', 'Nenhum'], ['box', 'Caixa'], ['band', 'Faixa (largura toda)']]));
    sec.append(colorF('Cor do fundo', s, 'boxColor'));
    sec.append(rangeF('Opacidade', s, 'boxOpacity', 0, 1, 0.05, null, (v) => Math.round(v * 100) + '%'));
  }

  function layerSection(layer) {
    const sec = h('section', { class: 'insp-sec' });
    const fx = layer.fx;
    sec.append(h('h3', {}, 'Camada ', h('span', { class: 'muted' }, `${P.layers.indexOf(layer) + 1} de ${P.layers.length}`)));
    sec.append(textF('Nome', layer, 'name', () => {
      const n = $(`.layer-head[data-layer="${layer.id}"] .lh-name`);
      if (n) n.textContent = layer.name;
    }));
    sec.append(h('div', { class: 'hint' }, 'Opacidade, modo de mistura e tempo de transição ficam no cabeçalho da camada, na grade.'));
    sec.append(h('h4', {}, 'Efeitos'));
    const pct = (v) => v + '%';
    sec.append(rangeF('Brilho', fx, 'brightness', 0, 200, 1, null, pct));
    sec.append(rangeF('Contraste', fx, 'contrast', 0, 200, 1, null, pct));
    sec.append(rangeF('Saturação', fx, 'saturate', 0, 200, 1, null, pct));
    sec.append(rangeF('Matiz', fx, 'hue', -180, 180, 1, null, (v) => v + '°'));
    sec.append(rangeF('Desfoque', fx, 'blur', 0, 30, 0.5, null, (v) => v + 'px'));
    sec.append(rangeF('Preto e branco', fx, 'gray', 0, 100, 1, null, pct));
    sec.append(rangeF('Vinheta', fx, 'vignette', 0, 100, 1, null, pct));
    sec.append(h('div', { class: 'f' }, h('span', { class: 'fl' }, 'Tom de cor'),
      (() => {
        const out = h('span', { class: 'fv' }, fx.tint + '%');
        const r = h('input', { type: 'range', min: 0, max: 80, step: 1, value: fx.tint, oninput: () => { fx.tint = +r.value; out.textContent = r.value + '%'; scheduleSave(); } });
        return h('div', { class: 'inline' }, r, colorInput(fx, 'tintColor'), out);
      })(), h('span')));
    sec.append(h('h4', {}, 'Tamanho e posição'));
    sec.append(rangeF('Zoom', fx, 'zoom', 10, 200, 1, null, pct));
    sec.append(rangeF('Posição X', fx, 'posX', -50, 50, 1, null, pct));
    sec.append(rangeF('Posição Y', fx, 'posY', -50, 50, 1, null, pct));
    sec.append(checkF('Espelhar', fx, 'mirror'));
    sec.append(h('h4', {}, 'Looks prontos'));
    sec.append(h('div', { class: 'look-grid' }, Object.keys(FX_PRESETS).map((name) =>
      h('button', { class: 'btn small look', onclick: () => { layer.fx = Object.assign(defaultFx(), FX_PRESETS[name]); scheduleSave(); renderInspector(); } }, name))));
    sec.append(h('div', { class: 'hint' }, 'Dica: câmera em P&B ou desfocada atrás da letra é muito usada em igrejas para a letra ler melhor. “Quadro no canto” deixa a câmera pequena sobre o fundo.'));
    sec.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: () => { layer.fx = defaultFx(); scheduleSave(); renderInspector(); } }, 'Zerar efeitos'),
      h('button', { class: 'btn small', title: 'Mover para cima (fica por cima)', onclick: () => { moveLayer(layer, 1); renderInspector(); } }, '▲ Subir'),
      h('button', { class: 'btn small', onclick: () => { moveLayer(layer, -1); renderInspector(); } }, '▼ Descer'),
      h('button', { class: 'btn small danger', onclick: () => removeLayer(layer) }, 'Remover camada')));
    return sec;
  }

  function renderAll() {
    renderDeck();
    renderInspector();
    renderSlides();
  }

  // =====================================================================
  // Barra superior e atalhos
  // =====================================================================
  function setupTopbar() {
    const sel = $('#selRes');
    sel.innerHTML = RESOLUTIONS.map(([w, hh, n]) => `<option value="${w}x${hh}">${w}×${hh} — ${n}</option>`).join('');
    const cur = `${P.width}x${P.height}`;
    if (!RESOLUTIONS.some(([w, hh]) => `${w}x${hh}` === cur)) sel.insertAdjacentHTML('afterbegin', `<option value="${cur}">${P.width}×${P.height}</option>`);
    sel.value = cur;
    const master = $('#master');
    master.value = P.master;
    $('#masterVal').textContent = Math.round(P.master * 100) + '%';
  }

  $('#selRes').addEventListener('change', (e) => {
    const [w, hh] = e.target.value.split('x').map(Number);
    P.width = w; P.height = hh;
    TX.limparCache();
    scheduleSave();
  });
  $('#master').addEventListener('input', (e) => {
    P.master = parseFloat(e.target.value);
    $('#masterVal').textContent = Math.round(P.master * 100) + '%';
    scheduleSave();
  });
  $('#master').addEventListener('dblclick', (e) => { P.master = 1; e.target.value = 1; $('#masterVal').textContent = '100%'; scheduleSave(); });
  $('#btnOutput').addEventListener('click', openOutput);
  $('#btnBlackout').addEventListener('click', () => setBlackout(!rt.blackout));
  $('#btnClearAll').addEventListener('click', clearAll);
  $('#btnMenu').addEventListener('click', (e) => {
    if (!mainMenu.classList.contains('hidden')) { hidePopovers(); return; }
    showPopover(mainMenu, e.currentTarget);
  });
  mainMenu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    hidePopovers();
    switch (b.dataset.menu) {
      case 'addlayer': addLayer(); break;
      case 'addcol': addColumns(1); renderDeck(); scheduleSave(); break;
      case 'screen2': moveOutputToSecondScreen(); break;
      case 'help': $('#helpDlg').showModal(); break;
      case 'new':
        if (!confirm('Apagar TODO o projeto (clipes, letras e vídeos guardados) e começar do zero?')) return;
        for (const id of Object.keys(rt.media)) disposeMedia(id);
        rt.layers = {}; rt.liveText = null;
        pendingBlobs.clear(); slidesCache.clear(); TX.limparCache();
        try { await DB.clear('media'); } catch (_) {}
        P = defaultProject();
        ui.selClip = ui.selLayer = null;
        setupTopbar(); renderAll(); saveNow();
        break;
    }
  });
  $('#helpDlg').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#helpDlg').close(); });

  // Sliders/selects soltam o foco depois de usados, para as setas voltarem a trocar os slides
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[type=range], select, input[type=checkbox], input[type=color]')) e.target.blur();
  });

  function handleKey(e) {
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('#helpDlg').open) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown':
        e.preventDefault(); stepSlide(1); return;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
        e.preventDefault(); stepSlide(-1); return;
      case 'b': case 'B': case '.':
        e.preventDefault(); setBlackout(!rt.blackout); return;
      case 'c': case 'C':
        e.preventDefault(); clearLyrics(); return;
      case 'Escape':
        hidePopovers(); return;
      case 'Delete':
        if (ui.selClip) { e.preventDefault(); removeClip(ui.selClip); }
        return;
      case '?': case 'F1':
        e.preventDefault(); $('#helpDlg').showModal(); return;
    }
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); triggerColumn(+e.key - 1); }
  }
  window.addEventListener('keydown', handleKey);

  window.addEventListener('beforeunload', (e) => {
    clearTimeout(saveTimer);
    saveNow();
    if (rt.outWin && !rt.outWin.closed) { e.preventDefault(); e.returnValue = ''; }
  });


  // =====================================================================
  // Holyrics (API Server do Holyrics)
  //   - "Holyrics ao vivo": espelha o slide que está no ar no Holyrics
  //   - Importar músicas (culto atual / busca) como clipes de texto
  //   - Importar fundos da pasta de mídia (precisa da ponte local)
  // =====================================================================
  const Holy = {
    status: 'off', error: '', text: '', pres: null, slides: [], presKey: '',
    bridge: false, bridgeKind: '', timer: null,
    async call(action, params) {
      const cfg = P.holyrics;
      if (!cfg.token) throw new Error('configure o token do Holyrics');
      const body = JSON.stringify(params || {});
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5000);
      let res;
      try {
        if (Holy.bridge) {
          res = await fetch('ponte/holyrics', {
            method: 'POST', signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', 'X-Ponte': '1' },
            body: JSON.stringify({ host: cfg.host, port: cfg.port, token: cfg.token, action, params: body }),
          });
        } else {
          res = await fetch(`http://${cfg.host}:${cfg.port}/api/${encodeURIComponent(action)}?token=${encodeURIComponent(cfg.token)}`, {
            method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body,
          });
        }
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('o Holyrics não respondeu (tempo esgotado)');
        throw new Error(Holy.bridge ? 'a ponte local não respondeu'
          : 'o navegador não conseguiu falar com o Holyrics. Abra o programa pelo “Iniciar-Windows.bat” (ponte) e confira IP e porta');
      } finally { clearTimeout(to); }
      let j;
      try { j = await res.json(); } catch (_) { throw new Error(`resposta inválida do Holyrics (HTTP ${res.status})`); }
      if (!j || j.status !== 'ok') {
        const er = j && j.error;
        let msg = typeof er === 'string' ? er : '';
        if (er && er.unauthorized_actions) msg = 'o token não tem permissão para: ' + [].concat(er.unauthorized_actions).join(', ');
        if (msg === 'invalid token') msg = 'token inválido';
        throw new Error(msg || 'erro desconhecido');
      }
      return j.data;
    },
  };

  async function detectBridge() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const r = await fetch('ponte/info', { headers: { 'X-Ponte': '1' } });
      const j = await r.json();
      Holy.bridge = !!(j && j.ok);
      Holy.bridgeKind = (j && j.ponte) || '';
    } catch (_) { Holy.bridge = false; }
  }

  function cleanHolyText(t) {
    return String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim();
  }

  const holyClips = () => Object.values(P.clips).filter((c) => c.type === 'holyrics');
  let holyBusy = false;

  async function holyPoll() {
    clearTimeout(Holy.timer);
    if (holyBusy) return;
    if (!P.holyrics.token || !Object.values(P.clips).some((c) => c.type === 'holyrics' || c.type === 'holybg')) {
      if (Holy.status !== 'off') { Holy.status = 'off'; holyChanged(); }
      Holy.timer = setTimeout(holyPoll, 1500);
      return;
    }
    holyBusy = true;
    let delay = 350;
    try {
      const d = await Holy.call('GetCurrentPresentation', { include_slides: true });
      const was = Holy.status;
      Holy.status = 'ok'; Holy.error = '';
      applyPresentation(d);
      if (was !== 'ok') holyChanged();
    } catch (e) {
      const changed = Holy.status !== 'error' || Holy.error !== e.message;
      Holy.status = 'error'; Holy.error = e.message;
      setHolyText('');
      if (changed) holyChanged();
      delay = 3000;
    } finally { holyBusy = false; }
    Holy.timer = setTimeout(holyPoll, delay);
  }

  function applyPresentation(d) {
    Holy.pres = d || null;
    if (d && Array.isArray(d.slides)) Holy.slides = d.slides;
    else if (!d) Holy.slides = [];
    let text = '';
    if (d && (!d.slide_type || d.slide_type === 'default')) {
      const n = d.slide_number;
      const sl = Holy.slides.find((x) => x.number === n) || Holy.slides[n - 1];
      text = sl ? cleanHolyText(sl.text) : '';
    }
    setHolyText(text);
    const key = d ? [d.id, d.name, d.slide_number, d.total_slides, d.slide_type, Holy.slides.length].join('|') : 'none';
    if (key !== Holy.presKey) { Holy.presKey = key; holyChanged(); }
  }

  function setHolyText(t) {
    if (t === Holy.text) return;
    Holy.text = t;
    holyClips().forEach(refreshCell);
  }

  function holyStatusText() {
    if (!P.holyrics.token) return 'Não configurado — clique em “Holyrics” na barra de cima.';
    if (Holy.status === 'error') return '⚠ ' + Holy.error;
    if (Holy.status !== 'ok') return 'Aguardando…';
    const d = Holy.pres;
    if (!d) return '✔ Conectado · nada sendo apresentado no Holyrics';
    const tipos = { song: 'Música', verse: 'Bíblia', text: 'Texto', announcement: 'Aviso', image: 'Imagem', audio: 'Áudio' };
    const st = d.slide_type && d.slide_type !== 'default' ? ` · (${{ black: 'tela preta', blank: 'tela limpa', wallpaper: 'papel de parede', final_slide: 'slide final' }[d.slide_type] || d.slide_type})` : '';
    return `✔ ${tipos[d.type] || d.type || ''}${d.name ? ': ' + d.name : ''} · slide ${d.slide_number || '-'} de ${d.total_slides || '-'}${st}`;
  }

  function holyChanged() {
    const b = $('#btnHoly');
    if (b) b.dataset.state = !P.holyrics.token ? 'off' : Holy.status;
    holyClips().forEach(refreshCell);
    const st = $('#holyInspStatus');
    if (st) st.textContent = holyStatusText();
    const target = slidesTarget();
    if (target && target.type === 'holyrics') updateHolyPanel(true);
  }

  function holyControls(sec, clip) {
    sec.append(h('div', { class: 'holy-status', id: 'holyInspStatus' }, holyStatusText()));
    sec.append(h('div', { class: 'hint' }, 'Mostra, com o estilo abaixo, o slide que está no ar no Holyrics. Opere o Holyrics normalmente ou use as setas / passador por aqui.'));
    sec.append(checkF('Setas e passador controlam o Holyrics', P.holyrics, 'arrows'));
    sec.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => openHolyDialog() }, '⚙ Conexão com o Holyrics')));
    styleControls(sec, clip);
  }

  function renderHolyPanel(panel, clip) {
    panel.innerHTML = '';
    panel.append(
      h('div', { class: 'sp-head' },
        h('b', {}, clip.name),
        h('span', { class: 'pill', id: 'spPill' }),
        h('span', { class: 'muted', id: 'holyInfo' }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', title: 'Slide anterior no Holyrics', onclick: () => Holy.call('ActionPrevious').catch((e) => toast('Holyrics: ' + e.message)) }, '◀ Anterior'),
        h('button', { class: 'btn small', title: 'Próximo slide no Holyrics', onclick: () => Holy.call('ActionNext').catch((e) => toast('Holyrics: ' + e.message)) }, 'Próximo ▶'),
        h('button', {
          class: 'btn small', id: 'spLive',
          onclick: () => { const l = layerOfClip(clip.id); if (!l) return; if (isLive(clip.id)) clearLayer(l); else triggerClip(l, clip.id); },
        })),
      h('div', { class: 'slides', id: 'holySlides' }));
    updateSlidesActive(false);
  }

  function updateHolyPanel(scroll) {
    const grid = $('#holySlides');
    if (!grid) return;
    const target = slidesTarget();
    const live = !!target && isLive(target.id);
    const info = $('#holyInfo');
    if (info) info.textContent = holyStatusText();
    const d = Holy.pres;
    const key = d ? `${d.id}|${d.name}|${Holy.slides.map((x) => x.text).join('\u0001').length}|${Holy.slides.length}` : '';
    if (grid.dataset.key !== key) {
      grid.dataset.key = key;
      grid.innerHTML = '';
      if (!d) grid.append(h('div', { class: 'muted' }, Holy.status === 'ok' ? 'Nada sendo apresentado no Holyrics. Abra uma música lá.' : 'Sem conexão com o Holyrics.'));
      else if (!Holy.slides.length) grid.append(h('div', { class: 'muted' }, 'O Holyrics não envia a lista de slides deste tipo de apresentação (ex.: Bíblia). O texto no ar continua aparecendo.'));
      Holy.slides.forEach((sl, i) => {
        grid.append(h('div', {
          class: 'slide', 'data-n': sl.number || i + 1, title: 'Ir para este slide no Holyrics',
          onclick: () => {
            Holy.call('ActionGoToIndex', { index: (sl.number || i + 1) - 1 }).catch((e) => toast('Holyrics: ' + e.message));
            const l = target && layerOfClip(target.id);
            if (l && !isLive(target.id)) triggerClip(l, target.id);
          },
        }, h('span', { class: 'n' }, `${sl.number || i + 1}${sl.slide_description ? ' · ' + sl.slide_description : ''}`), cleanHolyText(sl.text)));
      });
    }
    let cur = null;
    for (const e of $$('.slide', grid)) {
      const on = !!d && +e.dataset.n === d.slide_number && (!d.slide_type || d.slide_type === 'default');
      e.classList.toggle('current', on);
      e.classList.toggle('onair', on && live);
      if (on) cur = e;
    }
    if (scroll && cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- janela de conexão / importação ----------
  const holyUi = { tab: 'musicas', layerId: null };

  function defaultLayerFor(tab) {
    if (tab === 'fundos') return P.layers[0].id;
    const l = P.layers.slice().reverse().find((x) => /letra/i.test(x.name)) || P.layers[P.layers.length - 1];
    return l.id;
  }

  function openHolyDialog(tab, layerId) {
    if (tab) holyUi.tab = tab;
    holyUi.layerId = layerId || defaultLayerFor(holyUi.tab);
    renderHolyDialog();
    const dlg = $('#holyDlg');
    if (!dlg.open) dlg.showModal();
  }

  function renderHolyDialog() {
    const body = $('#holyBody');
    const cfg = P.holyrics;
    body.innerHTML = '';
    const testOut = h('div', { class: 'hint', id: 'holyTest' }, P.holyrics.token ? holyStatusText() : '');
    const conn = h('section', { class: 'holy-conn' },
      h('div', { class: 'holy-row' },
        h('label', {}, 'IP do computador do Holyrics', (() => { const i = h('input', { type: 'text', value: cfg.host, placeholder: '127.0.0.1', oninput: () => { cfg.host = i.value.trim(); scheduleSave(); } }); return i; })()),
        h('label', {}, 'Porta', (() => { const i = h('input', { type: 'number', value: cfg.port, min: 1, max: 65535, oninput: () => { cfg.port = parseInt(i.value, 10) || 8091; scheduleSave(); } }); return i; })()),
        h('label', { class: 'grow' }, 'Token', (() => { const i = h('input', { type: 'text', value: cfg.token, placeholder: 'token criado no API Server do Holyrics', oninput: () => { cfg.token = i.value.trim(); scheduleSave(); holyChanged(); } }); return i; })()),
        h('button', {
          class: 'btn primary', onclick: async () => {
            testOut.textContent = 'Testando…';
            try {
              const v = await Holy.call('GetTokenInfo').catch(() => Holy.call('GetVersion'));
              testOut.textContent = `✔ Conectado ao Holyrics${v && v.version ? ' ' + v.version : ''}.` + (v && v.permissions ? ` Permissões do token: ${v.permissions}` : '');
              holyPoll();
            } catch (e) { testOut.textContent = '⚠ ' + e.message; }
          },
        }, 'Testar conexão')),
      testOut,
      h('div', { class: 'hint' },
        'No Holyrics: menu Arquivo → Configurações → API Server. Ative o servidor, anote a porta e crie um token em “gerenciar permissões” ',
        '(libere pelo menos: GetCurrentPresentation, GetCurrentBackground, GetThumbnail, ActionNext, ActionPrevious, ActionGoToIndex, GetCurrentSchedule, GetLyricsPlaylist, SearchLyrics, GetLyrics). ',
        'Se o Holyrics estiver neste mesmo computador, use o IP 127.0.0.1.'),
      h('div', { class: 'hint' }, Holy.bridge
        ? `✔ Ponte local ativa (${Holy.bridgeKind}). A conexão com o Holyrics passa por ela.`
        : '⚠ Ponte local desligada. O navegador pode bloquear a conexão direta com o Holyrics. Para garantir, abra o programa pelo arquivo “Iniciar-Windows.bat”.'));

    conn.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn small primary', onclick: () => { $('#holyDlg').close(); setupHolyLayers(); } }, '🎶 Montar Holyrics em camadas (fundo + letra)')));
    const tabs = h('div', { class: 'tabs' },
      [['musicas', '🎵 Músicas do culto'], ['buscar', '🔎 Buscar música'], ['fundos', '🖼 Fundos (pasta de mídia)']].map(([id, label]) =>
        h('button', { class: 'tab' + (holyUi.tab === id ? ' active' : ''), onclick: () => { holyUi.tab = id; holyUi.layerId = defaultLayerFor(id); renderHolyDialog(); } }, label)));

    const layerSel = h('select', { onchange: () => { holyUi.layerId = layerSel.value; } },
      P.layers.slice().reverse().map((l) => h('option', { value: l.id }, l.name)));
    layerSel.value = holyUi.layerId;
    const opts = h('div', { class: 'holy-row' }, h('label', {}, 'Colocar na camada', layerSel),
      holyUi.tab !== 'fundos' ? checkF('Usar a ordem da música no Holyrics (repete o refrão)', cfg, 'useOrder') : null);

    const list = h('div', { class: 'holy-list' });
    body.append(conn, tabs, opts);

    if (holyUi.tab === 'musicas') {
      body.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => loadSchedule(list) }, '↻ Carregar músicas do culto')), list);
      if (cfg.token) loadSchedule(list);
    } else if (holyUi.tab === 'buscar') {
      const q = h('input', { type: 'text', placeholder: 'Título ou artista', onkeydown: (e) => { if (e.key === 'Enter') go(); } });
      const go = async () => {
        list.textContent = 'Buscando…';
        try { renderSongList(list, (await Holy.call('SearchLyrics', { input: q.value.trim() })) || []); } catch (e) { list.textContent = '⚠ ' + e.message; }
      };
      body.append(h('div', { class: 'holy-row' }, q, h('button', { class: 'btn small', onclick: go }, 'Buscar')), list);
      setTimeout(() => q.focus(), 30);
    } else {
      body.append(renderFundosTab(list), list);
    }
  }

  async function loadSchedule(list) {
    list.textContent = 'Carregando…';
    try {
      let songs = [], origem = '';
      try {
        const sch = await Holy.call('GetCurrentSchedule', { include_lyrics_slides: true });
        songs = (sch && sch.lyrics_playlist) || [];
        origem = sch && sch.name ? `${sch.name}${sch.datetime ? ' · ' + sch.datetime : ''}` : '';
      } catch (_) { /* tenta a lista de músicas */ }
      if (!songs.length) { songs = (await Holy.call('GetLyricsPlaylist')) || []; origem = 'Lista de músicas'; }
      renderSongList(list, songs, origem);
    } catch (e) { list.textContent = '⚠ ' + e.message; }
  }

  function renderSongList(list, songs, origem) {
    list.innerHTML = '';
    songs = [].concat(songs || []).filter((x) => x && x.id);
    if (!songs.length) { list.append(h('div', { class: 'muted' }, 'Nenhuma música encontrada.')); return; }
    const all = h('button', {
      class: 'btn small primary', onclick: async () => {
        all.disabled = true;
        let ok = 0;
        for (const s of songs) { all.textContent = `Importando ${ok + 1}/${songs.length}…`; if (await importSong(s, true)) ok++; }
        all.textContent = `✔ ${ok} importadas`;
        renderDeck();
        toast(`${ok} música(s) importada(s) do Holyrics.`);
      },
    }, `⬇ Importar todas (${songs.length})`);
    list.append(h('div', { class: 'holy-list-head' }, h('span', { class: 'muted' }, origem || ''), all));
    for (const s of songs) {
      const btn = h('button', {
        class: 'btn small', onclick: async () => {
          btn.disabled = true; btn.textContent = '…';
          const ok = await importSong(s, false);
          btn.textContent = ok ? '✔ Importada' : 'Tentar de novo';
          btn.disabled = ok;
        },
      }, '⬇ Importar');
      list.append(h('div', { class: 'holy-item' },
        h('div', {}, h('b', {}, s.title || '(sem título)'), s.artist ? h('span', { class: 'muted' }, ' — ' + s.artist) : null),
        btn));
    }
  }

  async function fetchSongFull(song) {
    if (Array.isArray(song.slides) && song.slides.length) return song;
    let full = await Holy.call('GetLyrics', { id: song.id });
    if (!full || !Array.isArray(full.slides) || !full.slides.length) {
      full = await Holy.call('GetLyrics', { id: song.id, fields: 'id,title,artist,slides,order' });
    }
    return Object.assign({}, song, full || {});
  }

  function songToText(song) {
    const slides = (song.slides || []).map((x) => cleanHolyText(x && x.text));
    let seq = slides;
    if (P.holyrics.useOrder && song.order) {
      const idx = String(song.order).split(',').map((n) => parseInt(n, 10) - 1).filter((i) => i >= 0 && i < slides.length);
      if (idx.length) seq = idx.map((i) => slides[i]);
    }
    return seq.filter(Boolean).join('\n\n');
  }

  async function importSong(song, silent) {
    try {
      const full = await fetchSongFull(song);
      const text = songToText(full);
      if (!text) throw new Error('a música não tem slides');
      const layer = layerById(holyUi.layerId) || P.layers[P.layers.length - 1];
      let col = layer.clips.findIndex((x) => !x);
      if (col < 0) { col = P.columns; addColumns(1); }
      const clip = newTextClip(full.title || song.title || 'Música', text);
      // usa o mesmo visual dos outros textos da camada
      const ref = layer.clips.map((id) => P.clips[id]).find((c) => c && c.type === 'text');
      if (ref) clip.style = JSON.parse(JSON.stringify(ref.style));
      clip.holyricsId = song.id;
      P.clips[clip.id] = clip;
      layer.clips[col] = clip.id;
      scheduleSave();
      if (!silent) { renderDeck(); toast(`“${clip.name}” importada na camada ${layer.name}.`); }
      return true;
    } catch (e) {
      toast(`Não foi possível importar “${song.title || ''}”: ${e.message}`, 6000);
      return false;
    }
  }

  function renderFundosTab(list) {
    const cfg = P.holyrics;
    if (!Holy.bridge) {
      return h('div', { class: 'empty-hint' },
        h('p', {}, 'A API do Holyrics não envia os arquivos de vídeo e imagem dos fundos. Para trazer os fundos com qualidade total há dois jeitos:'),
        h('ol', {},
          h('li', {}, 'Abra o programa pelo “Iniciar-Windows.bat” (ponte local). Esta aba passa a listar os vídeos e imagens da pasta de mídia do Holyrics para importar com um clique.'),
          h('li', {}, 'Ou abra a pasta de mídia do Holyrics no Explorer e arraste os arquivos direto para as células da grade.')));
    }
    const dir = h('input', { type: 'text', value: cfg.mediaDir, placeholder: 'Pasta de mídia do Holyrics (vazio = tentar encontrar sozinho)', oninput: () => { cfg.mediaDir = dir.value.trim(); scheduleSave(); } });
    const go = async () => {
      list.textContent = 'Procurando arquivos…';
      try {
        const r = await fetch('ponte/arquivos?dir=' + encodeURIComponent(cfg.mediaDir), { headers: { 'X-Ponte': '1' } });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'pasta não encontrada');
        if (!cfg.mediaDir && j.dir) { cfg.mediaDir = j.dir; dir.value = j.dir; scheduleSave(); }
        renderFileGrid(list, [].concat(j.files || []), j.truncated);
      } catch (e) { list.textContent = '⚠ ' + e.message; }
    };
    if (cfg.mediaDir) setTimeout(go, 0);
    return h('div', {},
      h('div', { class: 'holy-row' }, h('label', { class: 'grow' }, 'Pasta', dir), h('button', { class: 'btn small', onclick: go }, 'Listar arquivos')),
      h('div', { class: 'hint' }, 'Dica: no Holyrics, clique com o botão direito num vídeo/imagem e escolha abrir a pasta para descobrir o caminho. Qualquer pasta com vídeos e imagens funciona.'));
  }

  function renderFileGrid(list, files, truncated) {
    list.innerHTML = '';
    if (!files.length) { list.append(h('div', { class: 'muted' }, 'Nenhum vídeo ou imagem nesta pasta.')); return; }
    if (truncated) list.append(h('div', { class: 'hint' }, `Mostrando os primeiros ${files.length} arquivos.`));
    const grid = h('div', { class: 'file-grid' });
    for (const f of files) {
      const src = 'ponte/arquivo?path=' + encodeURIComponent(f.path);
      const tile = h('div', { class: 'file-tile', title: f.path },
        f.kind === 'image' ? h('img', { src, loading: 'lazy', alt: '' }) : h('div', { class: 'ithumb' }, '🎬'),
        h('div', { class: 'cname' }, f.name));
      tile.addEventListener('click', async () => {
        if (tile.classList.contains('busy')) return;
        tile.classList.add('busy');
        try {
          const r = await fetch(src);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const file = new File([blob], f.name, { type: blob.type });
          const layer = layerById(holyUi.layerId) || P.layers[0];
          const col = Math.max(0, layer.clips.findIndex((x) => !x));
          importFiles([file], layer, col < 0 ? P.columns : col);
          tile.classList.add('done');
          toast(`“${f.name}” importado na camada ${layer.name}.`);
        } catch (e) { toast('Falha ao importar: ' + e.message); }
        tile.classList.remove('busy');
      });
      grid.append(tile);
    }
    list.append(grid);
  }

  $('#btnHoly').addEventListener('click', () => openHolyDialog());
  $('#holyDlg').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#holyDlg').close(); });


  // =====================================================================
  // Fundo do Holyrics ao vivo: segue o fundo que está no ar no Holyrics.
  //   Vídeos/imagens: arquivo original da pasta de mídia (pela ponte), qualidade total.
  //   Sem arquivo (tema, outro computador sem pasta compartilhada): miniatura enviada pelo Holyrics.
  // =====================================================================
  const HolyBg = { key: '', info: null, cur: null, prev: null, t0: 0, cache: new Map(), files: null, filesAt: 0, thumb: null, timer: null, busy: false };

  function newHolyBgClip() {
    return { id: uid(), type: 'holybg', name: 'Fundo do Holyrics', fit: 'cover', transition: 0.8 };
  }

  const holyBgClips = () => Object.values(P.clips).filter((c) => c.type === 'holybg');
  const stripExt = (n) => String(n || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '').trim().toLowerCase();

  async function holyMediaFiles(force) {
    if (!Holy.bridge) return [];
    if (HolyBg.files && !force && Date.now() - HolyBg.filesAt < 60000) return HolyBg.files;
    if (force && HolyBg.files && Date.now() - HolyBg.filesAt < 5000) return HolyBg.files;
    try {
      const r = await fetch('ponte/arquivos?dir=' + encodeURIComponent(P.holyrics.mediaDir || ''), { headers: { 'X-Ponte': '1' } });
      const j = await r.json();
      if (j.ok) {
        HolyBg.files = [].concat(j.files || []);
        if (!P.holyrics.mediaDir && j.dir) { P.holyrics.mediaDir = j.dir; scheduleSave(); }
      } else HolyBg.files = [];
    } catch (_) { HolyBg.files = []; }
    HolyBg.filesAt = Date.now();
    return HolyBg.files;
  }

  async function holyFindFile(bg) {
    const want = [bg.name, bg.id].filter(Boolean).map(stripExt).filter(Boolean);
    if (!want.length) return null;
    const kind = /image/.test(bg.type) ? 'image' : /video/.test(bg.type) ? 'video' : null;
    const match = (files) => files.find((f) => (!kind || f.kind === kind) && want.includes(stripExt(f.name)));
    return match(await holyMediaFiles(false)) || match(await holyMediaFiles(true)) || null;
  }

  function loadBgElement(src, kind) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('tempo esgotado')), 15000);
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
        v.addEventListener('loadeddata', () => { clearTimeout(to); res(v); }, { once: true });
        v.addEventListener('error', () => { clearTimeout(to); rej(new Error('vídeo não suportado')); }, { once: true });
        v.src = src;
      } else {
        const img = new Image();
        img.onload = () => { clearTimeout(to); res(img); };
        img.onerror = () => { clearTimeout(to); rej(new Error('imagem inválida')); };
        img.src = src;
      }
    });
  }

  async function holyBgEntry(bg) {
    const k = bg.type + ':' + bg.id;
    if (HolyBg.cache.has(k)) { const e = HolyBg.cache.get(k); HolyBg.cache.delete(k); HolyBg.cache.set(k, e); return e; }
    let e = null;
    if (bg.type !== 'theme') {
      try {
        const f = await holyFindFile(bg);
        if (f) {
          const blob = await (await fetch('ponte/arquivo?path=' + encodeURIComponent(f.path))).blob();
          const url = URL.createObjectURL(blob);
          try { e = { el: await loadBgElement(url, f.kind), url, source: 'arquivo', file: f.name }; } catch (err) { URL.revokeObjectURL(url); }
        }
      } catch (_) { /* tenta a miniatura */ }
    }
    let thumb = null;
    const types = bg.type === 'theme' ? ['theme', 'background'] : /video/.test(bg.type) ? ['background', 'video'] : ['background', 'image'];
    for (const t of types) {
      try {
        const r = await Holy.call('GetThumbnail', { id: bg.id, type: t });
        const item = [].concat(r || []).find((x) => x && x.image);
        if (item) { thumb = String(item.image).startsWith('data:') ? item.image : 'data:image/jpeg;base64,' + item.image; break; }
      } catch (_) { /* próximo tipo */ }
    }
    if (!e && thumb) { try { e = { el: await loadBgElement(thumb, 'image'), source: 'miniatura' }; } catch (_) { /* nada */ } }
    if (!e) return null;
    e.thumb = thumb;
    e.name = bg.name || bg.id;
    e.type = bg.type;
    HolyBg.cache.set(k, e);
    // limita o cache (vídeos ocupam memória)
    for (const [ck, ce] of HolyBg.cache) {
      if (HolyBg.cache.size <= 8) break;
      if (ce === HolyBg.cur || ce === HolyBg.prev || ce === e) continue;
      try { if (ce.el.tagName === 'VIDEO') { ce.el.pause(); ce.el.removeAttribute('src'); ce.el.load(); } } catch (_) { /* ok */ }
      if (ce.url) URL.revokeObjectURL(ce.url);
      HolyBg.cache.delete(ck);
    }
    return e;
  }

  function holyBgSetPlaying() {
    const live = holyBgClips().some((c) => isLive(c.id));
    for (const e of [HolyBg.cur, HolyBg.prev]) {
      if (!e || !e.el || e.el.tagName !== 'VIDEO') continue;
      if (live && e.el.paused) e.el.play().catch(() => {});
      else if (!live && !e.el.paused) e.el.pause();
    }
  }

  async function holyBgPoll() {
    clearTimeout(HolyBg.timer);
    const clips = holyBgClips();
    if (!clips.length || !P.holyrics.token || Holy.status !== 'ok') { HolyBg.timer = setTimeout(holyBgPoll, 1200); return; }
    try {
      const pres = Holy.pres;
      let target = null;
      if (pres && pres.slide_type === 'black') target = { key: 'black' };
      else {
        const bg = await Holy.call('GetCurrentBackground');
        if (bg && bg.id) target = { key: `${bg.type}:${bg.id}`, bg };
      }
      const key = target ? target.key : '';
      if (key !== HolyBg.key) {
        HolyBg.key = key;
        HolyBg.info = target && target.bg ? target.bg : null;
        let entry = null;
        if (target && target.key === 'black') entry = { black: true, name: 'tela preta' };
        else if (target) entry = await holyBgEntry(target.bg);
        if (HolyBg.key === key) holyBgSwitch(entry);
      }
      holyBgSetPlaying();
    } catch (_) { /* tenta de novo no próximo ciclo */ }
    HolyBg.timer = setTimeout(holyBgPoll, 700);
  }

  function holyBgSwitch(entry) {
    if (entry === HolyBg.cur) return;
    const old = HolyBg.prev;
    HolyBg.prev = HolyBg.cur;
    HolyBg.cur = entry;
    HolyBg.t0 = performance.now();
    if (old && old !== entry && old.el && old.el.tagName === 'VIDEO') old.el.pause();
    if (entry && entry.el && entry.el.tagName === 'VIDEO') { try { entry.el.currentTime = 0; } catch (_) { /* ok */ } }
    HolyBg.thumb = entry ? (entry.thumb || (entry.el && entry.el.tagName === 'IMG' ? entry.el.src : null)) : null;
    holyBgClips().forEach(refreshCell);
    const st = $('#holyBgStatus');
    if (st) st.textContent = holyBgStatusText();
  }

  function holyBgStatusText() {
    if (!P.holyrics.token) return 'Holyrics não configurado — clique em “Holyrics” na barra de cima.';
    if (Holy.status === 'error') return '⚠ ' + Holy.error;
    const e = HolyBg.cur;
    if (!e) return HolyBg.key ? '⚠ Não consegui carregar o fundo atual do Holyrics.' : '✔ Conectado · sem fundo no ar no Holyrics';
    if (e.black) return '✔ Holyrics em tela preta';
    if (e.source === 'arquivo') return `✔ Fundo: ${e.name} (arquivo original: ${e.file})`;
    return `✔ Fundo: ${e.name} — ⚠ em baixa resolução (miniatura). ` + (Holy.bridge
      ? 'Não achei o arquivo na pasta de mídia; confira a pasta abaixo.'
      : 'Abra o programa pelo Iniciar-Windows.bat para usar o arquivo original.');
  }

  function drawHolyBgEntry(c, e, alpha, fit, W, H) {
    if (!e || alpha <= 0.001) return false;
    c.globalAlpha = alpha;
    if (e.black) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return true; }
    const el = e.el;
    if (el.tagName === 'VIDEO' && el.readyState < 2) return false;
    const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
    if (!sw || !sh) return false;
    drawFit(c, el, sw, sh, fit, W, H);
    return true;
  }

  function drawHolyBg(c, clip, alpha, now, W, H) {
    const d = Math.max(0, clip.transition || 0) * 1000;
    const p = d > 0 ? Math.min(1, (now - HolyBg.t0) / d) : 1;
    if (p >= 1 && HolyBg.prev) {
      const old = HolyBg.prev; HolyBg.prev = null;
      if (old !== HolyBg.cur && old.el && old.el.tagName === 'VIDEO') old.el.pause();
    }
    let drew = false;
    if (HolyBg.prev) drew = drawHolyBgEntry(c, HolyBg.prev, HolyBg.cur ? alpha : alpha * (1 - p), clip.fit, W, H);
    drew = drawHolyBgEntry(c, HolyBg.cur, alpha * p, clip.fit, W, H) || drew;
    return drew;
  }

  function holyBgControls(sec, clip) {
    sec.append(h('div', { class: 'holy-status', id: 'holyBgStatus' }, holyBgStatusText()));
    sec.append(h('div', { class: 'hint' }, 'Mostra o fundo que está no ar no Holyrics (vídeo, imagem ou tema) e troca junto com ele. Combine com o clipe “Holyrics ao vivo (letra)” em outra camada.'));
    sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS));
    sec.append(rangeF('Transição', clip, 'transition', 0, 3, 0.1, null, (v) => v.toFixed(1) + 's'));
    const dir = h('input', { type: 'text', value: P.holyrics.mediaDir, placeholder: 'vazio = tentar encontrar sozinho', oninput: () => { P.holyrics.mediaDir = dir.value.trim(); HolyBg.files = null; HolyBg.cache.clear(); HolyBg.key = ''; scheduleSave(); } });
    sec.append(field('Pasta de mídia', dir));
    sec.append(h('div', { class: 'hint' },
      'Para o fundo vir em qualidade total, o programa procura o mesmo arquivo na pasta de mídia do Holyrics (precisa do Iniciar-Windows.bat). ',
      'Se o Holyrics estiver em OUTRO computador, compartilhe a pasta de mídia dele na rede e cole aqui o caminho (ex.: \\\\PC-HOLYRICS\\Holyrics). ',
      'Sem o arquivo, o programa usa a miniatura que o Holyrics envia (baixa resolução).'));
    sec.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: () => { HolyBg.files = null; HolyBg.cache.clear(); HolyBg.key = ''; holyBgPoll(); } }, '↻ Recarregar fundo'),
      h('button', { class: 'btn small', onclick: () => openHolyDialog() }, '⚙ Conexão com o Holyrics')));
  }

  // Cria, na mesma coluna, o fundo do Holyrics na camada de fundo e a letra na camada de letras
  function setupHolyLayers() {
    let fundo = P.layers.find((l) => /fundo/i.test(l.name)) || P.layers[0];
    let letras = P.layers.slice().reverse().find((l) => /letra/i.test(l.name)) || P.layers[P.layers.length - 1];
    if (fundo === letras) { addLayer(); letras = P.layers[P.layers.length - 1]; letras.name = 'Letras'; }
    let col = 0;
    while (col < P.columns && (fundo.clips[col] || letras.clips[col])) col++;
    if (col >= P.columns) addColumns(1);
    const bg = newHolyBgClip();
    const txt = { id: uid(), type: 'holyrics', name: 'Holyrics ao vivo (letra)', style: defaultTextStyle() };
    const ref = letras.clips.map((id) => P.clips[id]).find((c) => c && c.type === 'text');
    if (ref) txt.style = JSON.parse(JSON.stringify(ref.style));
    P.clips[bg.id] = bg; fundo.clips[col] = bg.id;
    P.clips[txt.id] = txt; letras.clips[col] = txt.id;
    renderDeck(); select(txt.id, letras.id); scheduleSave();
    holyPoll(); holyBgPoll();
    toast(`Pronto: coluna ${col + 1} tem o fundo (camada ${fundo.name}) e a letra (camada ${letras.name}) do Holyrics. Aperte ${col < 9 ? 'a tecla ' + (col + 1) : '▶ ' + (col + 1)} para colocar no ar.`, 8000);
    if (!P.holyrics.token) openHolyDialog();
  }

  // =====================================================================
  // NDI (via NDI Webcam Input do NDI Tools)
  // =====================================================================
  async function addNdiClip(layer, col) {
    const clip = { id: uid(), type: 'camera', name: 'NDI', deviceId: '', fit: 'cover', mirror: false };
    placeClip(layer, col, clip);
    try {
      const list = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      let devs = await list();
      if (!devs.some((d) => d.label)) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach((t) => t.stop());
        devs = await list();
      }
      const ndi = devs.filter((d) => /ndi/i.test(d.label));
      if (!ndi.length) {
        toast('Nenhuma fonte NDI encontrada. Instale o NDI Tools e abra o “NDI Webcam Input” (veja ☰ → Atalhos e ajuda → NDI).', 9000);
        return;
      }
      const used = new Set(Object.values(P.clips).filter((c) => c.type === 'camera' && c.id !== clip.id).map((c) => c.deviceId));
      const pick = ndi.find((d) => !used.has(d.deviceId)) || ndi[0];
      clip.deviceId = pick.deviceId;
      clip.name = pick.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
      refreshCell(clip);
      if (ui.selClip === clip.id) renderInspector();
      scheduleSave();
      toast('Fonte NDI selecionada: ' + clip.name);
    } catch (_) {
      toast('O navegador não deu acesso às câmeras. Clique no ícone de câmera na barra de endereço e permita.', 7000);
    }
  }


  // =====================================================================
  // Saídas: HDMI (janela do projetor), imagem de teste e OBS (navegador)
  // =====================================================================
  function drawTestPattern(c, W, H, now) {
    c.save();
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
    c.fillStyle = '#202020'; c.fillRect(0, 0, W, H);
    // barras de cor
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const bw = W / bars.length, by = H * 0.62, bh = H * 0.18;
    bars.forEach((b, i) => { c.fillStyle = b; c.fillRect(i * bw, by, Math.ceil(bw), bh); });
    // degradê de cinza
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
    c.fillStyle = g; c.fillRect(0, by + bh, W, H * 0.06);
    // grade
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = Math.max(1, H / 540);
    for (let i = 1; i < 16; i++) { const x = (W / 16) * i; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let i = 1; i < 9; i++) { const y = (H / 9) * i; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // círculo e diagonais
    c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, H / 360);
    c.beginPath(); c.arc(W / 2, H / 2, H * 0.4, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(W, H); c.moveTo(W, 0); c.lineTo(0, H); c.stroke();
    // borda (se não aparecer inteira, a TV/projetor está cortando a imagem)
    c.strokeStyle = '#ff3b3b'; c.lineWidth = Math.max(4, H / 135);
    c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, W - c.lineWidth, H - c.lineWidth);
    // área segura (90%)
    c.setLineDash([H / 60, H / 90]); c.strokeStyle = '#f5a524'; c.lineWidth = Math.max(2, H / 540);
    c.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); c.setLineDash([]);
    // textos
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${Math.round(H / 12)}px Arial, sans-serif`;
    c.fillText(`${W} × ${H}`, W / 2, H * 0.36);
    c.font = `${Math.round(H / 30)}px Arial, sans-serif`;
    c.fillText('Imagem de teste — Cara de Leão Projeção', W / 2, H * 0.46);
    c.fillText('A borda vermelha deve aparecer inteira · o círculo deve ficar redondo', W / 2, H * 0.52);
    // ponto em movimento (mostra se a saída está travada)
    const t = (now / 2000) % 1;
    c.fillStyle = '#2ecc71';
    c.beginPath(); c.arc(W * 0.1 + t * W * 0.8, H * 0.57, H / 70, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ---------- OBS: "programa" por WebRTC + "só letras" (PNG transparente) ----------
  const OBS_QUALITY = {
    alta: { label: 'Alta — resolução cheia, 30 fps', bitrate: 12e6, h: 0, fps: 30 },
    alta60: { label: 'Alta — resolução cheia, 60 fps', bitrate: 18e6, h: 0, fps: 60 },
    media: { label: 'Média — 720p, 30 fps', bitrate: 6e6, h: 720, fps: 30 },
    leve: { label: 'Leve — 540p, 30 fps (computador fraco)', bitrate: 3e6, h: 540, fps: 30 },
  };
  const Obs = { peers: new Map(), stream: null, timer: null };

  async function ponte(method, path, body, headers) {
    const r = await fetch('ponte/' + path, { method, body, headers: Object.assign({ 'X-Ponte': '1' }, headers || {}) });
    return r;
  }

  function obsStream() {
    const tr = Obs.stream && Obs.stream.getVideoTracks()[0];
    if (!tr || tr.readyState === 'ended') Obs.stream = comp.captureStream();
    return Obs.stream;
  }

  function iceDone(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      const t = setTimeout(res, 1500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }

  async function applyObsQuality(peer) {
    const q = OBS_QUALITY[P.obs.quality] || OBS_QUALITY.alta;
    try {
      const params = peer.sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = q.bitrate;
      params.encodings[0].maxFramerate = q.fps;
      params.encodings[0].scaleResolutionDownBy = q.h && P.height > q.h ? P.height / q.h : 1;
      params.degradationPreference = 'maintain-resolution';
      await peer.sender.setParameters(params);
    } catch (e) { console.warn('OBS: qualidade', e); }
  }

  function closePeer(id) {
    const peer = Obs.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch (_) { /* ok */ }
    Obs.peers.delete(id);
    updateObsCount();
  }

  async function obsHandle(msg) {
    if (!msg || !msg.from) return;
    if (msg.type === 'hello') {
      closePeer(msg.from);
      const pc = new RTCPeerConnection({ iceServers: [] });
      const stream = obsStream();
      const sender = pc.addTrack(stream.getVideoTracks()[0], stream);
      const peer = { pc, sender };
      Obs.peers.set(msg.from, peer);
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(msg.from);
        updateObsCount();
      });
      await pc.setLocalDescription(await pc.createOffer());
      await iceDone(pc);
      await ponte('POST', 'caixa/obs-' + msg.from, JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }), { 'Content-Type': 'application/json' });
    } else if (msg.type === 'answer') {
      const peer = Obs.peers.get(msg.from);
      if (!peer) return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      applyObsQuality(peer);
    } else if (msg.type === 'bye') closePeer(msg.from);
  }

  async function obsPoll() {
    clearTimeout(Obs.timer);
    try {
      const r = await ponte('GET', 'caixa/controle');
      const msgs = await r.json();
      for (const m of [].concat(msgs || [])) await obsHandle(m).catch((e) => console.warn('OBS', e));
    } catch (_) { /* ponte fechada */ }
    Obs.timer = setTimeout(obsPoll, 600);
  }

  function obsStart() {
    if (!Holy.bridge || !window.RTCPeerConnection) return;
    obsPoll();
  }

  function obsConnected() {
    let n = 0;
    for (const p of Obs.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }
  function updateObsCount() {
    const e = $('#obsCount');
    if (e) { const n = obsConnected(); e.textContent = n ? `● ${n} conectado${n > 1 ? 's' : ''}` : 'nenhum OBS conectado'; e.classList.toggle('on', n > 0); }
  }

  // Saída "só letras": manda para a página do OBS o texto, o estilo e a opacidade das letras no ar.
  // A página do OBS anima com o mesmo motor de texto (js/texto.js), com fundo transparente.
  const Overlay = { sig: null, ids: '', busy: false, again: false, pending: null };

  function overlayState() {
    const items = [];
    if (!rt.blackout) {
      for (const layer of P.layers) {
        const L = rt.layers[layer.id];
        const clip = L && L.current && P.clips[L.current.clipId];
        if (!isTextLike(clip) || layer.bypass || layer.opacity <= 0) continue;
        items.push({ id: clip.id, text: clipText(clip), style: clip.style, opacity: layer.opacity, filter: fxFilter(layer.fx), fade: layer.fade || 0 });
      }
    }
    const sig = `${P.width}x${P.height}|` + JSON.stringify(items);
    return { sig, items, ids: items.map((i) => i.id).join(',') };
  }

  function overlayCheck() {
    const st = overlayState();
    if (st.sig === Overlay.sig) return;
    let fade = 0.3;
    if (Overlay.sig !== null) {
      const layers = new Set();
      for (const id of [...st.ids.split(','), ...Overlay.ids.split(',')].filter(Boolean)) { const l = layerOfClip(id); if (l) layers.add(l); }
      fade = rt.blackout ? (P.masterFade || 0.5) : Math.max(0, ...[...layers].map((l) => l.fade || 0));
    }
    Overlay.sig = st.sig;
    Overlay.ids = st.ids;
    Overlay.pending = JSON.stringify({ w: P.width, h: P.height, fade, items: st.items });
    overlaySend();
  }

  async function overlaySend() {
    if (Overlay.busy) { Overlay.again = true; return; }
    Overlay.busy = true;
    try {
      do {
        Overlay.again = false;
        await ponte('POST', 'estado/letras', Overlay.pending, { 'Content-Type': 'application/json' });
      } while (Overlay.again);
    } catch (e) { console.warn('Saída de letras', e); }
    Overlay.busy = false;
  }

  // ---------- janela "Saídas" ----------
  async function renderOutputsDialog() {
    const body = $('#saidasBody');
    body.innerHTML = '';
    const on = !!(rt.outWin && !rt.outWin.closed);
    const base = /^https?:$/.test(location.protocol) ? location.href.replace(/[^/]*([?#].*)?$/, '') : '';
    const urlProg = base + 'saida.html';
    const urlLetras = base + 'saida.html?letras';
    const copy = (txt) => h('button', {
      class: 'btn small', onclick: async (e) => {
        try { await navigator.clipboard.writeText(txt); e.target.textContent = '✔ Copiado'; } catch (_) { prompt('Copie o endereço:', txt); }
      },
    }, '📋 Copiar');

    // HDMI
    const screens = h('div', { class: 'screens' });
    const hdmi = h('section', { class: 'out-sec' },
      h('h3', {}, '🖥 Saída HDMI (projetor / TV)'),
      h('div', { class: 'out-row' },
        h('span', { class: 'status ' + (on ? 'on' : 'off') }, on ? '● Janela do projetor aberta' : 'Janela do projetor fechada'),
        h('button', { class: 'btn primary small', onclick: () => { openOutput(); setTimeout(renderOutputsDialog, 300); } }, on ? 'Mostrar janela do projetor' : 'Abrir janela do projetor'),
        h('button', { class: 'btn small', onclick: () => detectScreens(screens) }, '🔍 Detectar telas')),
      screens,
      h('div', { class: 'hint' },
        'Ligue o cabo HDMI e deixe o Windows em “Estender” (tecla Win+P). Abra a janela do projetor, envie para a tela do projetor ',
        'e dê dois cliques nela (ou tecle F) para tela cheia. Coloque a resolução do programa igual à da tela.'),
      checkF('Mostrar imagem de teste em todas as saídas (para ajustar o projetor)', rt, 'testPattern'));

    // OBS
    const q = h('select', { onchange: () => { P.obs.quality = q.value; scheduleSave(); for (const p of Obs.peers.values()) applyObsQuality(p); } },
      Object.entries(OBS_QUALITY).map(([k, v]) => h('option', { value: k }, v.label)));
    q.value = P.obs.quality;
    const obs = h('section', { class: 'out-sec' }, h('h3', {}, '📡 Saída pelo navegador (OBS)'));
    if (!Holy.bridge) {
      obs.append(h('div', { class: 'warn' },
        'Para a saída do OBS, abra o programa pelo “Iniciar-Windows.bat” (ponte local). ',
        'Agora ele está aberto direto do arquivo, e o OBS não consegue se conectar.'),
      h('div', { class: 'hint' }, 'Sem a ponte, ainda dá para usar no OBS a fonte “Captura de janela” apontando para a janela “Projetor — Cara de Leão”.'));
    } else {
      obs.append(
        h('h4', {}, 'Programa completo (o mesmo que vai para o projetor)'),
        h('div', { class: 'out-row' }, h('code', {}, urlProg), copy(urlProg), h('span', { class: 'status', id: 'obsCount' })),
        h('label', { class: 'f' }, h('span', { class: 'fl' }, 'Qualidade'), q, h('span')),
        h('h4', {}, 'Só as letras, com fundo transparente (para colocar por cima da câmera no OBS)'),
        h('div', { class: 'out-row' }, h('code', {}, urlLetras), copy(urlLetras)),
        h('div', { class: 'hint' },
          h('b', {}, 'No OBS: '), `Fontes → + → Navegador → cole o endereço → Largura ${P.width} e Altura ${P.height}. `,
          'Para o programa completo, marque também “Atualizar navegador quando a cena se tornar ativa” se quiser. ',
          'O OBS precisa estar neste mesmo computador e esta janela de controle precisa ficar aberta.'),
        h('div', { class: 'hint' }, 'Também funciona no navegador comum (para conferir) e com a fonte “Captura de janela” do OBS.'));
      setTimeout(updateObsCount, 0);
    }
    body.append(hdmi, obs);
  }

  async function detectScreens(box) {
    box.innerHTML = '';
    if (!('getScreenDetails' in window)) {
      box.append(h('div', { class: 'hint' }, 'Este navegador não lista as telas. Use o Chrome ou o Edge, ou arraste a janela do projetor manualmente.'));
      return;
    }
    let sd;
    try { sd = await window.getScreenDetails(); } catch (_) {
      box.append(h('div', { class: 'warn' }, 'Permissão negada. Clique no cadeado da barra de endereço e permita “Gerenciamento de janelas”.'));
      return;
    }
    for (const scr of sd.screens) {
      const pw = Math.round(scr.width * (scr.devicePixelRatio || 1)), ph = Math.round(scr.height * (scr.devicePixelRatio || 1));
      box.append(h('div', { class: 'screen-item' },
        h('div', {}, h('b', {}, scr.label || 'Tela'), h('span', { class: 'muted' }, ` · ${pw}×${ph}${scr.isPrimary ? ' · principal (esta)' : ''}${scr === sd.currentScreen ? ' · painel de controle' : ''}`)),
        h('div', { class: 'btn-row', style: 'margin:0' },
          h('button', { class: 'btn small', onclick: () => moveOutputToScreen(scr) }, 'Enviar projetor para esta tela'),
          h('button', {
            class: 'btn small', onclick: () => {
              P.width = pw; P.height = ph; TX.limparCache(); setupTopbar(); scheduleSave();
              toast(`Resolução do programa: ${pw}×${ph}`);
            },
          }, 'Usar esta resolução'))));
    }
  }

  // ao recarregar/fechar o painel, avisa os OBS conectados para reconectarem na hora
  window.addEventListener('pagehide', () => {
    for (const id of Obs.peers.keys()) {
      fetch('ponte/caixa/obs-' + id, { method: 'POST', keepalive: true, headers: { 'X-Ponte': '1', 'Content-Type': 'application/json' }, body: '{"type":"reset"}' }).catch(() => {});
    }
  });

  $('#btnSaidas').addEventListener('click', () => { renderOutputsDialog(); $('#saidasDlg').showModal(); });
  $('#saidasDlg').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#saidasDlg').close(); });
  $('#saidasDlg').addEventListener('change', (e) => { if (e.target.type === 'checkbox') $('#btnSaidas').classList.toggle('active', !!rt.testPattern); });


  // =====================================================================
  // OBS Studio (servidor WebSocket que já vem no OBS 28 ou mais novo)
  //   - lista cenas e fontes do OBS e usa qualquer uma como clipe (por imagens, até ~15 qps)
  //   - liga a câmera virtual do OBS para trazer a câmera (placa de captura) em vídeo ao vivo
  // =====================================================================
  const ObsWs = {
    ws: null, status: 'off', error: '', pending: new Map(), seq: 0, imgFormat: 'png',
    scenes: [], inputs: [], vcam: null, retry: null, authFail: false, wasOk: false,
  };

  async function sha256b64(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    let bin = '';
    new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function setObsWsStatus(status, error) {
    const changed = ObsWs.status !== status;
    ObsWs.status = status;
    ObsWs.error = error || '';
    const b = $('#btnObs');
    if (b) b.dataset.state = status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'off';
    const st = $('#obsWsStatus');
    if (st) st.textContent = obsWsStatusText();
    const ist = $('#obsInspStatus');
    if (ist) ist.textContent = obsWsStatusText();
    if (changed && $('#obsDlg').open) renderObsDialog();
  }

  function obsWsStatusText() {
    if (ObsWs.status === 'ok') return '✔ Conectado ao OBS' + (ObsWs.vcam === true ? ' · câmera virtual ligada' : ObsWs.vcam === false ? ' · câmera virtual desligada' : '');
    if (ObsWs.status === 'connecting') return 'Conectando…';
    if (ObsWs.status === 'error') return '⚠ ' + ObsWs.error;
    return 'Desconectado';
  }

  function obsWsConnect() {
    clearTimeout(ObsWs.retry);
    if (ObsWs.ws && ObsWs.ws.readyState <= 1) return;
    const cfg = P.obsWs;
    let ws;
    try { ws = new WebSocket(`ws://${cfg.host}:${cfg.port}`, 'obswebsocket.json'); } catch (_) {
      setObsWsStatus('error', 'IP ou porta inválidos'); return;
    }
    ObsWs.ws = ws;
    ObsWs.authFail = false;
    ObsWs.wasOk = false;
    setObsWsStatus('connecting');
    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      const d = msg.d || {};
      if (msg.op === 0) { // Hello
        const id = { rpcVersion: 1, eventSubscriptions: 4 | 8 | 64 }; // cenas, entradas, saídas
        if (d.authentication) {
          if (!cfg.password) { ObsWs.authFail = true; ws.close(); return; }
          const secret = await sha256b64(cfg.password + d.authentication.salt);
          id.authentication = await sha256b64(secret + d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: id }));
      } else if (msg.op === 2) { // Identified
        ObsWs.wasOk = true;
        P.obsWs.enabled = true; scheduleSave();
        setObsWsStatus('ok');
        obsWsReady();
      } else if (msg.op === 7) { // RequestResponse
        const p = ObsWs.pending.get(d.requestId);
        if (!p) return;
        ObsWs.pending.delete(d.requestId);
        clearTimeout(p.t);
        const rs = d.requestStatus || {};
        if (rs.result) p.res(d.responseData || {});
        else p.rej(Object.assign(new Error(rs.comment || `erro ${rs.code}`), { code: rs.code }));
      } else if (msg.op === 5) obsWsEvent(d.eventType, d.eventData || {});
    };
    ws.onclose = (ev) => {
      if (ObsWs.ws !== ws) return;
      ObsWs.ws = null;
      for (const p of ObsWs.pending.values()) { clearTimeout(p.t); p.rej(new Error('conexão com o OBS fechada')); }
      ObsWs.pending.clear();
      let msg;
      if (ev.code === 4009) msg = 'senha do OBS incorreta';
      else if (ObsWs.authFail) msg = 'o OBS pede senha: preencha a senha do servidor WebSocket';
      else if (ObsWs.wasOk) msg = 'a conexão com o OBS caiu, tentando de novo…';
      else msg = 'OBS não encontrado. Abra o OBS e ative Ferramentas → Configurações do servidor WebSocket';
      setObsWsStatus('error', msg);
      if (ev.code !== 4009 && !ObsWs.authFail && P.obsWs.enabled) ObsWs.retry = setTimeout(obsWsConnect, 5000);
    };
  }

  function obsWsDisconnect() {
    P.obsWs.enabled = false; scheduleSave();
    clearTimeout(ObsWs.retry);
    const ws = ObsWs.ws;
    ObsWs.ws = null;
    if (ws) try { ws.close(); } catch (_) { /* ok */ }
    setObsWsStatus('off');
  }

  function obsCall(requestType, requestData) {
    return new Promise((res, rej) => {
      const ws = ObsWs.ws;
      if (!ws || ws.readyState !== 1 || ObsWs.status !== 'ok') { rej(new Error('OBS não conectado')); return; }
      const requestId = 'r' + (++ObsWs.seq);
      const t = setTimeout(() => { ObsWs.pending.delete(requestId); rej(new Error('o OBS não respondeu')); }, 6000);
      ObsWs.pending.set(requestId, { res, rej, t });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
    });
  }

  async function obsWsReady() {
    try {
      const v = await obsCall('GetVersion');
      const f = (v.supportedImageFormats || []).map((x) => String(x).toLowerCase());
      ObsWs.imgFormat = f.includes('jpg') ? 'jpg' : f.includes('jpeg') ? 'jpeg' : 'png';
    } catch (_) { /* usa png */ }
    await obsRefreshLists();
    try { ObsWs.vcam = !!(await obsCall('GetVirtualCamStatus')).outputActive; } catch (_) { ObsWs.vcam = null; }
    setObsWsStatus('ok');
    if ($('#obsDlg').open) renderObsDialog();
  }

  async function obsRefreshLists() {
    try {
      const sl = await obsCall('GetSceneList');
      ObsWs.scenes = (sl.scenes || []).slice().sort((a, b) => (b.sceneIndex || 0) - (a.sceneIndex || 0));
      const il = await obsCall('GetInputList');
      ObsWs.inputs = (il.inputs || []).filter((i) => !/wasapi|pulse|coreaudio|alsa|jack|audio_|_audio|sck_audio/i.test(i.inputKind || i.unversionedInputKind || ''));
    } catch (_) { /* mantém as listas */ }
    if ($('#obsDlg').open) renderObsSources();
  }

  let obsListTimer;
  function obsWsEvent(type, data) {
    if (type === 'VirtualcamStateChanged') { ObsWs.vcam = !!data.outputActive; setObsWsStatus('ok'); if ($('#obsDlg').open) renderObsDialog(); return; }
    if (type === 'InputNameChanged') {
      for (const c of Object.values(P.clips)) if (c.type === 'obs' && c.sourceName === data.oldInputName) { c.sourceName = data.inputName; refreshCell(c); }
      scheduleSave();
    }
    if (type === 'SceneNameChanged') {
      for (const c of Object.values(P.clips)) if (c.type === 'obs' && c.sourceName === data.oldSceneName) { c.sourceName = data.sceneName; refreshCell(c); }
      scheduleSave();
    }
    if (/^(Scene(ListChanged|Created|Removed|NameChanged)|Input(Created|Removed|NameChanged))$/.test(type)) {
      clearTimeout(obsListTimer);
      obsListTimer = setTimeout(obsRefreshLists, 300);
    }
  }

  function obsSourceRef(clip) {
    return clip.sourceUuid ? { sourceUuid: clip.sourceUuid } : { sourceName: clip.sourceName };
  }

  async function obsScreenshot(ref, width, quality) {
    const q = Object.assign({ imageFormat: ObsWs.imgFormat, imageWidth: Math.max(8, Math.round(width)) }, ref);
    if (ObsWs.imgFormat !== 'png') q.imageCompressionQuality = quality || 85;
    const r = await obsCall('GetSourceScreenshot', q);
    const data = String(r.imageData || '');
    return data.startsWith('data:') ? data : `data:image/${ObsWs.imgFormat === 'jpg' ? 'jpeg' : ObsWs.imgFormat};base64,${data}`;
  }

  // Quadros das fontes do OBS que estão no ar (pede uma imagem de cada vez por clipe)
  const OBS_RES = { baixa: 640, media: 1280, alta: 1920 };
  function obsClipActive(id) {
    return P.layers.some((l) => { const r = rt.layers[l.id]; return r && ((r.current && r.current.clipId === id) || (r.prev && r.prev.clipId === id)); });
  }
  setInterval(() => {
    if (ObsWs.status !== 'ok') return;
    const now = performance.now();
    for (const clip of Object.values(P.clips)) {
      if (clip.type !== 'obs' || !obsClipActive(clip.id)) continue;
      const m = ensureMedia(clip);
      if (m.busy || now - (m.last || 0) < 1000 / (clip.fps || 10)) continue;
      m.busy = true; m.last = now;
      obsScreenshot(obsSourceRef(clip), Math.min(P.width, OBS_RES[clip.res] || 1280))
        .then(async (url) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          m.el = img; m.ready = true;
          if (m.error) { m.error = null; refreshCell(clip); }
        })
        .catch((e) => {
          if (e.code === 600 && !m.error) { m.error = 'Fonte não encontrada no OBS'; refreshCell(clip); toast(`OBS: a fonte “${clip.sourceName}” não existe mais.`); }
        })
        .finally(() => { m.busy = false; });
    }
  }, 20);

  async function findVideoDevice(re) {
    const list = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    let devs = await list();
    if (!devs.some((d) => d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
      devs = await list();
    }
    const d = devs.find((x) => re.test(x.label));
    return d ? d.deviceId : '';
  }
  const OBS_VCAM_RE = /obs.*virtual|virtual.*obs/i;

  async function prepareObsVirtualCam(clip) {
    if (ObsWs.status === 'ok') {
      try {
        const st = await obsCall('GetVirtualCamStatus');
        if (!st.outputActive) { await obsCall('StartVirtualCam'); await new Promise((r) => setTimeout(r, 900)); }
      } catch (_) { /* segue com o que tiver */ }
    }
    try {
      const id = await findVideoDevice(OBS_VCAM_RE);
      if (id && id !== clip.deviceId) { clip.deviceId = id; scheduleSave(); }
    } catch (_) { /* sem permissão: o getUserMedia logo abaixo vai avisar */ }
  }

  async function addObsVirtualCamClip(layer, col) {
    const clip = { id: uid(), type: 'camera', name: 'Câmera virtual do OBS', deviceId: '', fit: 'cover', mirror: false, obsVirtual: true };
    placeClip(layer, col, clip);
    if (!P.obsWs.enabled) toast('Dica: conecte o OBS (botão “OBS” lá em cima) para o programa ligar a câmera virtual sozinho.', 7000);
    try {
      const id = await findVideoDevice(OBS_VCAM_RE);
      if (!id) toast('Não achei a “OBS Virtual Camera”. Abra o OBS e clique uma vez em “Iniciar câmera virtual”.', 8000);
      else { clip.deviceId = id; scheduleSave(); if (ui.selClip === clip.id) renderInspector(); }
    } catch (_) { toast('O navegador não deu acesso às câmeras. Clique no ícone de câmera na barra de endereço e permita.', 7000); }
  }

  function obsClipControls(sec, clip) {
    sec.append(h('div', { class: 'holy-status', id: 'obsInspStatus' }, obsWsStatusText()));
    const sel = h('select', {
      onchange: () => {
        const [kind, uuid] = sel.value.split('|');
        const item = (kind === 's' ? ObsWs.scenes : ObsWs.inputs).find((x) => (x.sceneUuid || x.inputUuid) === uuid);
        if (!item) return;
        clip.sourceUuid = uuid;
        clip.sourceName = item.sceneName || item.inputName;
        clip.thumb = null;
        const m = rt.media[clip.id]; if (m) m.error = null;
        refreshCell(clip); scheduleSave();
      },
    });
    const opts = [];
    if (!ObsWs.scenes.some((x) => x.sceneUuid === clip.sourceUuid) && !ObsWs.inputs.some((x) => x.inputUuid === clip.sourceUuid)) {
      opts.push(h('option', { value: '' }, clip.sourceName || '(escolha)'));
    }
    if (ObsWs.scenes.length) opts.push(h('optgroup', { label: 'Cenas' }, ObsWs.scenes.map((x) => h('option', { value: 's|' + x.sceneUuid }, x.sceneName))));
    if (ObsWs.inputs.length) opts.push(h('optgroup', { label: 'Fontes' }, ObsWs.inputs.map((x) => h('option', { value: 'i|' + x.inputUuid }, x.inputName))));
    sel.append(...opts);
    sel.value = ObsWs.scenes.some((x) => x.sceneUuid === clip.sourceUuid) ? 's|' + clip.sourceUuid
      : ObsWs.inputs.some((x) => x.inputUuid === clip.sourceUuid) ? 'i|' + clip.sourceUuid : '';
    sec.append(field('Cena / fonte', sel));
    sec.append(selectF('Quadros/s', clip, 'fps', [['5', '5 (leve)'], ['10', '10'], ['15', '15 (pesado)']], () => { clip.fps = +clip.fps; }));
    sec.append(selectF('Qualidade', clip, 'res', [['baixa', 'Baixa (640)'], ['media', 'Média (1280)'], ['alta', 'Alta (1920)']]));
    sec.append(selectF('Ajuste', clip, 'fit', FIT_OPTS));
    sec.append(h('div', { class: 'hint' }, 'Este modo copia imagens do OBS (bom para slides, logos e cenas paradas). Para câmera em movimento, use “OBS — câmera virtual”, que é vídeo ao vivo de verdade.'));
    sec.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => openObsDialog() }, '⚙ Conexão com o OBS')));
  }

  function obsClipFor(item, isScene) {
    return {
      id: uid(), type: 'obs', name: (isScene ? item.sceneName : item.inputName) || 'OBS',
      sourceName: isScene ? item.sceneName : item.inputName, sourceUuid: isScene ? item.sceneUuid : item.inputUuid,
      fps: 10, res: 'media', fit: 'cover', thumb: null,
    };
  }

  // ---------- janela do OBS ----------
  const obsUi = { layerId: null, col: 0 };
  function openObsDialog(layerId, col) {
    obsUi.layerId = layerId || obsUi.layerId || (P.layers[1] || P.layers[0]).id;
    obsUi.col = col || 0;
    renderObsDialog();
    if (!$('#obsDlg').open) $('#obsDlg').showModal();
    if (ObsWs.status === 'ok') obsRefreshLists();
  }

  function renderObsDialog() {
    const body = $('#obsBody');
    const cfg = P.obsWs;
    body.innerHTML = '';
    const inp = (key, type, ph, conv) => { const i = h('input', { type, value: cfg[key], placeholder: ph || '', oninput: () => { cfg[key] = conv ? conv(i.value) : i.value; scheduleSave(); } }); return i; };
    body.append(h('section', { class: 'holy-conn' },
      h('div', { class: 'holy-row' },
        h('label', {}, 'IP do computador do OBS', inp('host', 'text', '127.0.0.1', (v) => v.trim())),
        h('label', {}, 'Porta', inp('port', 'number', '4455', (v) => parseInt(v, 10) || 4455)),
        h('label', { class: 'grow' }, 'Senha do WebSocket', inp('password', 'password', 'deixe vazio se não tiver senha')),
        h('button', { class: 'btn primary', onclick: () => { obsWsDisconnect(); P.obsWs.enabled = true; obsWsConnect(); } }, 'Conectar'),
        ObsWs.status === 'ok' ? h('button', { class: 'btn small', onclick: () => { obsWsDisconnect(); renderObsDialog(); } }, 'Desconectar') : null),
      h('div', { class: 'hint', id: 'obsWsStatus' }, obsWsStatusText()),
      h('div', { class: 'hint' }, 'No OBS: menu Ferramentas → Configurações do servidor WebSocket → marque “Ativar servidor WebSocket”. ',
        'Em “Mostrar informações de conexão” estão a porta e a senha. Funciona com o OBS neste mesmo computador (IP 127.0.0.1).')));

    // câmera virtual
    const vc = h('section', { class: 'out-sec' },
      h('h3', {}, '🎥 Câmera do OBS em vídeo ao vivo (câmera virtual)'),
      h('div', { class: 'hint' },
        'A placa de captura só pode ser usada por um programa de cada vez — como ela já está no OBS, o OBS repassa a imagem pela “câmera virtual”. ',
        h('b', {}, 'No OBS 30 ou mais novo: '), 'clique na engrenagem ⚙ ao lado de “Iniciar câmera virtual” → Tipo de saída: ', h('b', {}, 'Fonte'),
        ' → escolha a placa de captura. Assim vem só a câmera, e o que vai para a transmissão não muda.'),
      h('div', { class: 'out-row' },
        h('span', { class: 'status' + (ObsWs.vcam ? ' on' : '') }, ObsWs.vcam ? '● Câmera virtual ligada' : ObsWs.vcam === false ? 'Câmera virtual desligada' : 'Estado desconhecido'),
        h('button', { class: 'btn small', disabled: ObsWs.status !== 'ok', onclick: () => obsCall(ObsWs.vcam ? 'StopVirtualCam' : 'StartVirtualCam').catch((e) => toast('OBS: ' + e.message)) }, ObsWs.vcam ? 'Desligar' : 'Ligar'),
        h('button', {
          class: 'btn small primary', onclick: () => {
            const layer = layerById(obsUi.layerId) || P.layers[0];
            let col = layer.clips.findIndex((x, i) => !x && i >= obsUi.col);
            if (col < 0) { col = P.columns; addColumns(1); }
            $('#obsDlg').close();
            addObsVirtualCamClip(layer, col);
          },
        }, '＋ Adicionar câmera virtual como clipe')));

    // cenas e fontes
    const layerSel = h('select', { onchange: () => { obsUi.layerId = layerSel.value; } }, P.layers.slice().reverse().map((l) => h('option', { value: l.id }, l.name)));
    layerSel.value = obsUi.layerId;
    const src = h('section', { class: 'out-sec' },
      h('h3', {}, '📺 Cenas e fontes do OBS'),
      h('div', { class: 'hint' }, 'Clique numa cena ou fonte para criar um clipe com ela. A imagem é copiada do OBS de 5 a 15 vezes por segundo: ótimo para slides, logos, Bíblia e cenas paradas.'),
      h('div', { class: 'holy-row' }, h('label', {}, 'Colocar na camada', layerSel), h('button', { class: 'btn small', onclick: () => obsRefreshLists() }, '↻ Atualizar lista')),
      h('div', { id: 'obsSources', class: 'holy-list' }));
    body.append(vc, src);
    renderObsSources();
  }

  let obsThumbToken = 0;
  async function renderObsSources() {
    const box = $('#obsSources');
    if (!box) return;
    box.innerHTML = '';
    if (ObsWs.status !== 'ok') { box.append(h('div', { class: 'muted' }, 'Conecte ao OBS para ver as cenas e fontes.')); return; }
    const items = [...ObsWs.scenes.map((x) => [x, true]), ...ObsWs.inputs.map((x) => [x, false])];
    if (!items.length) { box.append(h('div', { class: 'muted' }, 'Nenhuma cena ou fonte encontrada.')); return; }
    const grid = h('div', { class: 'file-grid' });
    const tiles = [];
    for (const [item, isScene] of items) {
      const img = h('img', { alt: '' });
      const tile = h('div', { class: 'file-tile', title: 'Criar clipe com esta ' + (isScene ? 'cena' : 'fonte') },
        h('div', { class: 'ithumb tile-ph' }, isScene ? '🎬' : '📺'), img,
        h('div', { class: 'cname' }, h('span', { class: 'muted' }, isScene ? 'Cena · ' : 'Fonte · '), (isScene ? item.sceneName : item.inputName)));
      tile.addEventListener('click', () => {
        const layer = layerById(obsUi.layerId) || P.layers[0];
        let col = layer.clips.findIndex((x, i) => !x && i >= obsUi.col);
        if (col < 0) { col = P.columns; addColumns(1); }
        const clip = obsClipFor(item, isScene);
        if (img.src) clip.thumb = img.src;
        P.clips[clip.id] = clip;
        layer.clips[col] = clip.id;
        renderDeck(); scheduleSave();
        tile.classList.add('done');
        toast(`“${clip.name}” adicionado na camada ${layer.name}.`);
      });
      tiles.push([tile, img, item, isScene]);
      grid.append(tile);
    }
    box.append(grid);
    // miniaturas, uma de cada vez
    const tok = ++obsThumbToken;
    for (const [tile, img, item, isScene] of tiles) {
      if (tok !== obsThumbToken || !$('#obsDlg').open) return;
      try {
        img.src = await obsScreenshot(isScene ? { sourceUuid: item.sceneUuid } : { sourceUuid: item.inputUuid }, 192, 70);
        tile.classList.add('has-img');
      } catch (_) { /* fonte sem imagem (ex.: áudio) */ }
    }
  }

  $('#btnObs').addEventListener('click', () => openObsDialog());
  $('#obsDlg').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('#obsDlg').close(); });

  // =====================================================================
  // Inicialização
  // =====================================================================
  async function init() {
    let saved = null;
    try { saved = await DB.get('kv', 'project'); } catch (e) { console.warn('IndexedDB indisponível', e); }
    P = saved && saved.version === 1 ? normalize(saved) : defaultProject();
    setupTopbar();
    renderAll();
    for (const clip of Object.values(P.clips)) if (clip.type === 'video' || clip.type === 'image') ensureMedia(clip);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    keepAwake();
    schedule();
    if (!saved) saveNow();
    await detectBridge();
    holyPoll();
    holyBgPoll();
    obsStart();
    if (P.obsWs.enabled) obsWsConnect();
    // expõe para depuração no console
    window.CDL = { get project() { return P; }, rt, Holy, HolyBg, Obs, ObsWs, triggerColumn, clearAll };
  }
  init();
})();
