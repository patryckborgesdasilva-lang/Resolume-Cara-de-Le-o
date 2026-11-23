/*
 * Motor de texto animado — Cara de Leão Projeção
 * Usado pelo painel (app.js) e pela saída de letras do OBS (saida.js), para os dois animarem igual.
 *
 * Inspirado no jeito que igrejas operam letras no Resolume (Text Animator): entrada por linha,
 * palavra ou letra com atraso escalonado, desfoque, escala com "pulo", espaçamento abrindo,
 * e efeitos contínuos enquanto a letra está no ar (respirar, flutuar, brilho, onda).
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

  // ---------------------------------------------------------------- fontes
  // Fontes da web (Google Fonts): carregadas só quando usadas. Sem internet, cai na fonte do sistema.
  const FONTES_WEB = {
    'Montserrat': '400;700;900', 'Poppins': '400;700;900', 'Bebas Neue': '400', 'Oswald': '400;700',
    'Anton': '400', 'Archivo Black': '400', 'League Spartan': '400;700;900', 'Raleway': '400;700;900',
    'Inter': '400;700;900', 'Lato': '400;700;900', 'Open Sans': '400;700', 'Nunito': '400;700;900',
    'Barlow Condensed': '400;700;900', 'Playfair Display': '400;700;900', 'Lora': '400;700',
    'Cinzel': '400;700;900', 'Roboto Slab': '400;700;900', 'Dancing Script': '400;700',
    'Great Vibes': '400', 'Caveat': '400;700',
  };
  const FONTES_SISTEMA = ['Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI',
    'Calibri', 'Georgia', 'Times New Roman', 'Impact', 'Courier New'];

  const cache = new Map();
  const injetadas = new Set();
  const ouvintes = new Set();
  function limparCache() { cache.clear(); ouvintes.forEach((f) => { try { f(); } catch (_) { /* ok */ } }); }
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', limparCache);
  }

  function garantirFonte(family) {
    if (!FONTES_WEB[family] || injetadas.has(family) || typeof document === 'undefined') return;
    injetadas.add(family);
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${FONTES_WEB[family]}&display=swap`;
    l.onload = () => {
      const pesos = FONTES_WEB[family].split(';');
      Promise.all(pesos.map((w) => document.fonts.load(`${w} 40px "${family}"`).catch(() => null))).then(limparCache);
    };
    document.head.appendChild(l);
  }

  function fonteCss(s, px) {
    return `${s.italic ? 'italic ' : ''}${s.weight || 700} ${Math.max(1, Math.round(px))}px "${s.font}", Arial, sans-serif`;
  }

  // ---------------------------------------------------------------- animações
  const ANIMS = {
    nenhuma: 'Nenhuma (corte seco)', fade: 'Suave (fade)', subir: 'Subir linha a linha', cair: 'Descer linha a linha',
    palavra: 'Palavra por palavra', letra: 'Letra por letra', maquina: 'Máquina de escrever',
    desfoque: 'Desfoque → nítido', zoom: 'Zoom suave', escala: 'Pulo (palavra por palavra)', tracking: 'Espaçamento abrindo',
  };
  const SAIDAS = { nenhuma: 'Nenhuma (corte seco)', fade: 'Suave (fade)', subir: 'Subir e sumir', desfoque: 'Desfocar', zoom: 'Zoom e sumir', mesma: 'Igual à entrada, invertida' };
  const IDLES = { nenhum: 'Nenhum', respirar: 'Respirar (zoom lento)', flutuar: 'Flutuar', brilho: 'Brilho pulsando', onda: 'Onda nas letras' };
  const UNIDADE = { subir: 'linha', cair: 'linha', palavra: 'palavra', escala: 'palavra', letra: 'letra', maquina: 'letra', tracking: 'letra' };

  // ---------------------------------------------------------------- layout
  function layout(c, s, text, W, H) {
    const key = `${W}x${H}|${s.font}|${s.weight}|${s.italic}|${s.size}|${s.uppercase}|${s.margin}|${s.lineHeight}|${s.letterSpacing}|${s.align}|${s.valign}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    garantirFonte(s.font);
    const k = H / 1080;
    const margin = (s.margin || 0) * k;
    const maxW = Math.max(50, W - 2 * margin), maxH = Math.max(50, H - 2 * margin);
    const txt = s.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
    const base = (s.size || 80) * k;
    let size = base, out = null;
    for (let i = 0; i < 40; i++) {
      const font = fonteCss(s, size);
      c.font = font;
      const ls = (s.letterSpacing || 0) * k * (size / base);
      const medir = (str) => c.measureText(str).width + Math.max(0, Array.from(str).length - 1) * ls;
      const linhas = [];
      for (const para of txt.split('\n')) {
        const words = para.split(/\s+/).filter(Boolean);
        if (!words.length) { linhas.push(''); continue; }
        let line = words[0];
        for (let w = 1; w < words.length; w++) {
          const test = line + ' ' + words[w];
          if (medir(test) <= maxW) line = test; else { linhas.push(line); line = words[w]; }
        }
        linhas.push(line);
      }
      let widest = 0;
      for (const ln of linhas) widest = Math.max(widest, medir(ln));
      const lineH = size * (s.lineHeight || 1.2);
      out = { font, size, ls, lineH, linhas, widest, blockH: linhas.length * lineH, medir };
      if ((out.blockH <= maxH && widest <= maxW) || size <= 14 * k) break;
      size *= 0.93;
    }
    // posições de cada letra (para as animações por letra/palavra)
    c.font = out.font;
    const y0 = s.valign === 'top' ? margin : s.valign === 'bottom' ? H - margin - out.blockH : (H - out.blockH) / 2;
    let gi = 0, wi = 0;
    const lines = out.linhas.map((ln, li) => {
      const width = out.medir(ln);
      const x0 = s.align === 'left' ? margin : s.align === 'right' ? W - margin - width : (W - width) / 2;
      const chars = Array.from(ln);
      const glyphs = [];
      let prefix = '', emPalavra = false;
      chars.forEach((ch, i) => {
        const x = c.measureText(prefix).width + i * out.ls;
        const w = c.measureText(ch).width;
        const espaco = /\s/.test(ch);
        if (!espaco && !emPalavra) { emPalavra = true; } else if (espaco && emPalavra) { emPalavra = false; wi++; }
        if (!espaco) glyphs.push({ ch, x, w, gi: gi++, wi });
        prefix += ch;
      });
      if (emPalavra) wi++;
      return { text: ln, width, x0, y: y0 + out.lineH * (li + 0.5), li, glyphs };
    });
    const res = {
      font: out.font, size: out.size, ls: out.ls, lineH: out.lineH, blockW: out.widest, blockH: out.blockH, y0, k,
      lines, nLetras: gi, nPalavras: wi, nLinhas: lines.length,
      cx: s.align === 'left' ? margin + out.widest / 2 : s.align === 'right' ? W - margin - out.widest / 2 : W / 2,
      cy: y0 + out.blockH / 2,
    };
    if (cache.size > 400) cache.clear();
    cache.set(key, res);
    return res;
  }

  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // pinta um trecho de texto (brilho, contorno com sombra, preenchimento com cor ou degradê)
  function pintar(c, s, L, str, x, y, glowMul) {
    const k = L.k;
    const glow = (s.glow || 0) > 0 || s.idle === 'brilho';
    if (glow) {
      c.shadowColor = s.glowColor || '#ffffff';
      c.shadowBlur = (s.glow || 18) * k * glowMul;
      c.shadowOffsetX = 0; c.shadowOffsetY = 0;
      c.fillStyle = s.glowColor || '#ffffff';
      c.fillText(str, x, y);
    }
    const sombra = (on) => {
      c.shadowColor = on ? 'rgba(0,0,0,0.85)' : 'transparent';
      c.shadowBlur = on ? 14 * k : 0;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = on ? 4 * k : 0;
    };
    if ((s.outline || 0) > 0) {
      sombra(s.shadow);
      c.strokeStyle = s.outlineColor || '#000';
      c.lineWidth = s.outline * 2 * k;
      c.strokeText(str, x, y);
      sombra(false);
    } else sombra(s.shadow);
    if (s.gradient) {
      const g = c.createLinearGradient(0, y - L.size * 0.5, 0, y + L.size * 0.5);
      g.addColorStop(0, s.color || '#fff');
      g.addColorStop(1, s.color2 || '#f5a524');
      c.fillStyle = g;
    } else c.fillStyle = s.color || '#fff';
    c.fillText(str, x, y);
    sombra(false);
  }

  // parâmetros de uma "parte" (linha, palavra, letra ou bloco) num momento da animação
  function parametros(anim, p, k) {
    const e = easeOut(p);
    switch (anim) {
      case 'nenhuma': return { a: p > 0 ? 1 : 0 };
      case 'subir': return { a: e, dy: (1 - e) * 42 * k };
      case 'cair': return { a: e, dy: -(1 - e) * 42 * k };
      case 'palavra': return { a: e, dy: (1 - e) * 20 * k };
      case 'letra': return { a: e, dy: (1 - e) * 14 * k };
      case 'maquina': return { a: p > 0 ? 1 : 0 };
      case 'desfoque': return { a: e, blur: (1 - e) * 16 * k };
      case 'zoom': return { a: e, sc: 1.14 - 0.14 * e };
      case 'escala': return { a: Math.min(1, p * 2.2), sc: 0.55 + 0.45 * easeBack(p) };
      case 'tracking': return { a: e, track: (1 - e) };
      default: return { a: e };
    }
  }
  function parametrosSaida(anim, p, k) {
    const e = easeOut(p);
    switch (anim) {
      case 'nenhuma': return { a: 0 };
      case 'subir': return { a: 1 - e, dy: -34 * k * e };
      case 'desfoque': return { a: 1 - e, blur: 16 * k * e };
      case 'zoom': return { a: 1 - e, sc: 1 + 0.12 * e };
      default: return { a: 1 - e };
    }
  }

  function totalEntrada(s, L) {
    const anim = s.anim || 'fade';
    const un = UNIDADE[anim];
    const n = un === 'linha' ? L.nLinhas : un === 'palavra' ? L.nPalavras : un === 'letra' ? L.nLetras : 1;
    const dur = anim === 'maquina' ? 0 : Math.max(0.01, s.animDur == null ? 0.6 : s.animDur);
    return dur + Math.max(0, n - 1) * stagger(s, anim);
  }
  function stagger(s, anim) {
    const v = s.stagger == null ? 0.05 : s.stagger;
    return anim === 'maquina' ? Math.max(0.01, v) : v;
  }

  /*
   * Desenha o texto.
   *   fase 'in'  → t = segundos desde o começo da entrada
   *   fase 'out' → t = segundos desde o começo da saída
   *   relogio    → segundos absolutos (para os efeitos contínuos)
   * Retorna false quando não há mais nada para desenhar (saída terminada).
   */
  function desenhar(c, s, text, W, H, alpha, fase, t, relogio) {
    if (!text || alpha <= 0.001) return fase !== 'out';
    const L = layout(c, s, text, W, H);
    const k = L.k;
    const animIn = s.anim || 'fade';
    let anim, dur, rev = false;
    if (fase === 'out' && s.exitAnim === 'mesma') { anim = animIn; rev = true; dur = Math.max(0.01, s.exitDur == null ? 0.35 : s.exitDur); }
    else if (fase === 'out') { anim = s.exitAnim || 'fade'; dur = Math.max(0.01, s.exitDur == null ? 0.35 : s.exitDur); }
    else { anim = animIn; dur = Math.max(0.01, s.animDur == null ? 0.6 : s.animDur); }

    const unidade = (fase === 'in' || rev) ? UNIDADE[anim] : null;
    const n = unidade === 'linha' ? L.nLinhas : unidade === 'palavra' ? L.nPalavras : unidade === 'letra' ? L.nLetras : 1;
    const stg = stagger(s, anim);
    const fimEntrada = fase === 'in' && t >= totalEntrada(s, L);
    const fimSaida = fase === 'out' && t >= (rev ? dur + (n - 1) * stg * 0.5 : dur);
    if (fimSaida) return false;

    const prog = (idx) => {
      if (fase === 'in') {
        if (anim === 'maquina') return t >= idx * stg ? 1 : 0;
        return clamp((t - idx * stg) / dur, 0, 1);
      }
      return 1 - clamp((t - (n - 1 - idx) * stg * 0.5) / dur, 0, 1); // invertida
    };
    const blocoP = fase === 'in' ? clamp(t / dur, 0, 1) : rev ? 1 - clamp(t / (dur + (n - 1) * stg * 0.5), 0, 1) : 0;
    const bloco = fase === 'out' && !rev ? parametrosSaida(anim, clamp(t / dur, 0, 1), k)
      : unidade ? { a: anim === 'maquina' ? 1 : easeOut(blocoP) } : parametros(anim, blocoP, k);

    // efeitos contínuos
    const idle = s.idle || 'nenhum';
    let sc = bloco.sc || 1, dy = bloco.dy || 0, glowMul = 1;
    if (idle === 'respirar') sc *= 1 + 0.02 * Math.sin(relogio * 0.9);
    if (idle === 'flutuar') dy += 6 * k * Math.sin(relogio * 1.3);
    if (idle === 'brilho') glowMul = 0.55 + 0.45 * Math.sin(relogio * 2.2);
    const porLetra = (!!unidade && !(fase === 'in' && fimEntrada)) || idle === 'onda';

    c.save();
    c.globalAlpha = alpha;
    // fundo atrás do texto
    if (s.box && s.box !== 'none') {
      const pad = L.size * 0.45;
      c.save();
      c.globalAlpha = alpha * (unidade ? easeOut(blocoP) : (bloco.a == null ? 1 : bloco.a)) * (s.boxOpacity == null ? 0.55 : s.boxOpacity);
      c.fillStyle = hexToRgba(s.boxColor, 1);
      if (s.box === 'band') c.fillRect(0, L.y0 - pad, W, L.blockH + pad * 2);
      else if (s.box === 'degrade') {
        // degradê suave atrás do texto (no rodapé, vai até a borda de baixo) — típico de transmissão
        const noRodape = s.valign === 'bottom';
        const top = Math.max(0, L.y0 - pad * 3.2);
        const bottom = noRodape ? H : Math.min(H, L.y0 + L.blockH + pad * 3.2);
        const g = c.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, hexToRgba(s.boxColor, 0));
        g.addColorStop(noRodape ? 0.55 : 0.5, hexToRgba(s.boxColor, 1));
        g.addColorStop(1, hexToRgba(s.boxColor, noRodape ? 1 : 0));
        c.fillStyle = g;
        c.fillRect(0, top, W, bottom - top);
      } else c.fillRect(L.cx - L.blockW / 2 - pad, L.y0 - pad, L.blockW + pad * 2, L.blockH + pad * 2);
      c.restore();
    }
    c.font = L.font;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.miterLimit = 2;
    if (bloco.blur) c.filter = `blur(${bloco.blur.toFixed(1)}px)`;
    if (sc !== 1 || dy) { c.translate(L.cx, L.cy + dy); c.scale(sc, sc); c.translate(-L.cx, -L.cy); }
    const aBloco = bloco.a == null ? 1 : bloco.a;

    if (!porLetra) {
      if ('letterSpacing' in c) c.letterSpacing = L.ls ? L.ls.toFixed(2) + 'px' : '0px';
      c.globalAlpha = alpha * aBloco;
      for (const ln of L.lines) if (ln.text) pintar(c, s, L, ln.text, ln.x0, ln.y, glowMul);
      if ('letterSpacing' in c) c.letterSpacing = '0px';
    } else {
      if ('letterSpacing' in c) c.letterSpacing = '0px';
      let cursor = null;
      for (const ln of L.lines) {
        const nG = ln.glyphs.length;
        for (let i = 0; i < nG; i++) {
          const g = ln.glyphs[i];
          const idx = unidade === 'linha' ? ln.li : unidade === 'palavra' ? g.wi : g.gi;
          const pr = unidade ? (fase === 'in' && fimEntrada ? 1 : prog(idx)) : 1;
          const pp = unidade ? parametros(anim, pr, k) : { a: 1 };
          if (pp.a <= 0.001) continue;
          let gx = ln.x0 + g.x, gy = ln.y + (pp.dy || 0);
          if (pp.track) gx += (i - (nG - 1) / 2) * pp.track * L.size * 0.35;
          if (idle === 'onda') gy += 6 * k * Math.sin(relogio * 3 + g.gi * 0.45);
          c.save();
          c.globalAlpha = alpha * pp.a * (fase === 'out' && !rev ? aBloco : 1);
          if (pp.sc && pp.sc !== 1) { c.translate(gx + g.w / 2, gy); c.scale(pp.sc, pp.sc); c.translate(-(gx + g.w / 2), -gy); }
          pintar(c, s, L, g.ch, gx, gy, glowMul);
          c.restore();
          if (anim === 'maquina' && fase === 'in' && pr > 0) cursor = { x: gx + g.w + L.size * 0.06, y: ln.y };
        }
      }
      if (cursor && !fimEntrada) {
        c.globalAlpha = alpha;
        c.fillStyle = s.color || '#fff';
        c.fillRect(cursor.x, cursor.y - L.size * 0.4, Math.max(2, L.size * 0.07), L.size * 0.8);
      }
    }
    c.restore();
    return true;
  }

  /*
   * Animador: guarda, por clipe, o texto atual e os que estão saindo.
   * Quando o texto muda (slide novo, Holyrics avançou), o antigo sai e o novo entra.
   */
  function criarAnimador() {
    const estado = new Map();
    return {
      reset(id) { estado.delete(id); },
      desenhar(c, id, s, text, W, H, alpha, agora) {
        let e = estado.get(id);
        if (!e) { e = { cur: { text, t0: agora }, saindo: [] }; estado.set(id, e); }
        else if (e.cur.text !== text) {
          const tinha = !!e.cur.text;
          if (tinha) e.saindo.push({ text: e.cur.text, t0: agora, s });
          const atraso = tinha && s.exitAnim !== 'nenhuma' ? Math.min(0.5, (s.exitDur == null ? 0.35 : s.exitDur) * 0.55) : 0;
          e.cur = { text, t0: agora + atraso };
        }
        e.saindo = e.saindo.filter((o) => desenhar(c, s, o.text, W, H, alpha, 'out', agora - o.t0, agora));
        if (e.cur.text && agora >= e.cur.t0) desenhar(c, s, e.cur.text, W, H, alpha, 'in', agora - e.cur.t0, agora);
      },
    };
  }

  window.CDLTexto = {
    FONTES_WEB: Object.keys(FONTES_WEB), FONTES_SISTEMA, ANIMS, SAIDAS, IDLES,
    garantirFonte, limparCache, layout, desenhar, criarAnimador,
    aoCarregarFonte: (f) => ouvintes.add(f),
  };
})();
