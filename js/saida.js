/*
 * Saída pelo navegador — para o OBS (fonte "Navegador") ou qualquer navegador neste computador.
 *   saida.html          → programa completo (vídeo ao vivo do painel de controle, via WebRTC)
 *   saida.html?letras   → só as letras, com fundo transparente
 * Precisa do painel de controle aberto pela ponte local (Iniciar-Windows.bat).
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const modoLetras = params.has('letras');
  const noObs = !!window.obsstudio;           // dentro do OBS não mostramos mensagens na imagem
  const statusEl = document.getElementById('status');
  function status(msg) {
    if (noObs && !params.has('debug')) return;
    statusEl.textContent = msg || '';
    statusEl.style.display = msg ? 'block' : 'none';
  }
  const ponte = (method, path, body, headers) =>
    fetch('ponte/' + path, { method, body, cache: 'no-store', headers: Object.assign({ 'X-Ponte': '1' }, headers || {}) });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // -------------------------------------------------------------------
  // Só letras: fundo transparente, animadas aqui mesmo com o motor js/texto.js
  // -------------------------------------------------------------------
  async function letras() {
    document.title = 'Letras — Cara de Leão';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;display:block';
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    const anim = window.CDLTexto.criarAnimador();
    const itens = new Map(); // id -> { text, style, filter, alvo, alpha, fade }
    let W = 1920, H = 1080, versao = '', ultimo = performance.now();

    function quadro(agoraMs) {
      const dt = Math.min(0.1, (agoraMs - ultimo) / 1000);
      ultimo = agoraMs;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      c.clearRect(0, 0, W, H);
      for (const [id, it] of itens) {
        const passo = it.fade > 0 ? dt / it.fade : 1;
        it.alpha = it.alvo > it.alpha ? Math.min(it.alvo, it.alpha + passo) : Math.max(it.alvo, it.alpha - passo);
        if (it.alvo === 0 && it.alpha <= 0.001) { itens.delete(id); anim.reset(id); continue; }
        c.filter = it.filter || 'none';
        anim.desenhar(c, id, it.style, it.text, W, H, it.alpha, agoraMs / 1000);
        c.filter = 'none';
      }
      requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);

    status('Aguardando o painel de controle…');
    for (;;) {
      try {
        const r = await ponte('GET', 'estado/letras?v=' + encodeURIComponent(versao));
        if (r.status === 200) {
          versao = r.headers.get('X-Versao') || '';
          const st = await r.json();
          W = st.w || W; H = st.h || H;
          const vivos = new Set();
          for (const n of st.items || []) {
            vivos.add(n.id);
            const it = itens.get(n.id);
            if (!it) itens.set(n.id, { text: n.text, style: n.style, filter: n.filter, alvo: n.opacity, alpha: 0, fade: n.fade || st.fade || 0 });
            else Object.assign(it, { text: n.text, style: n.style, filter: n.filter, alvo: n.opacity, fade: n.fade || st.fade || 0 });
          }
          for (const [id, it] of itens) if (!vivos.has(id)) { it.alvo = 0; it.fade = st.fade || 0; }
          status('');
        } else if (r.status !== 204) status('Ponte respondeu ' + r.status);
        await espera(100);
      } catch (_) {
        status('Sem conexão com a ponte local. Abra o programa pelo Iniciar-Windows.bat.');
        await espera(1500);
      }
    }
  }

  // -------------------------------------------------------------------
  // Programa completo (WebRTC, sinalização pela ponte)
  // -------------------------------------------------------------------
  function iceDone(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      const t = setTimeout(res, 1500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }

  async function programa() {
    document.body.classList.add('programa');
    const video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true;
    document.body.appendChild(video);
    const id = Math.random().toString(36).slice(2, 10);
    let pc = null, desde = 0, conectado = false, ultimoTempo = -1, ultimoAvanco = Date.now();

    const reiniciar = async () => {
      if (pc) { try { pc.close(); } catch (_) { /* ok */ } }
      pc = null; conectado = false; desde = Date.now();
      try {
        await ponte('POST', 'caixa/controle', JSON.stringify({ type: 'hello', from: id }), { 'Content-Type': 'application/json' });
        status('Conectando ao painel de controle…');
      } catch (_) { status('Sem conexão com a ponte local. Abra o programa pelo Iniciar-Windows.bat.'); }
    };

    window.addEventListener('pagehide', () => {
      fetch('ponte/caixa/controle', { method: 'POST', keepalive: true, headers: { 'X-Ponte': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'bye', from: id }) }).catch(() => {});
    });

    await reiniciar();
    for (;;) {
      try {
        const r = await ponte('GET', 'caixa/obs-' + id);
        const msgs = [].concat((await r.json()) || []);
        for (const m of msgs) {
          if (m.type === 'reset') { conectado = false; desde = 0; status('Painel de controle recarregado, reconectando…'); continue; }
          if (m.type !== 'offer') continue;
          if (pc) { try { pc.close(); } catch (_) { /* ok */ } }
          pc = new RTCPeerConnection({ iceServers: [] });
          const atual = pc;
          pc.addEventListener('track', (e) => {
            video.srcObject = e.streams[0] || new MediaStream([e.track]);
            video.play().catch(() => {});
          });
          pc.addEventListener('connectionstatechange', () => {
            if (atual !== pc) return;
            if (pc.connectionState === 'connected') { conectado = true; ultimoAvanco = Date.now(); status(''); }
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
              conectado = false; status('Conexão perdida, reconectando…'); desde = 0;
            }
          });
          await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await iceDone(pc);
          await ponte('POST', 'caixa/controle', JSON.stringify({ type: 'answer', from: id, sdp: pc.localDescription.sdp }), { 'Content-Type': 'application/json' });
        }
      } catch (_) {
        status('Sem conexão com a ponte local. Abra o programa pelo Iniciar-Windows.bat.');
        await espera(1500);
      }
      // imagem parada por mais de 3 s mesmo "conectado" → reconecta
      if (conectado) {
        if (video.currentTime !== ultimoTempo) { ultimoTempo = video.currentTime; ultimoAvanco = Date.now(); }
        else if (Date.now() - ultimoAvanco > 3000) { conectado = false; desde = 0; ultimoAvanco = Date.now(); }
      }
      // sem conexão (painel fechado/recarregado) → tenta de novo
      if (!conectado && Date.now() - desde > 4000) await reiniciar();
      await espera(conectado ? 1000 : 250);
    }
  }

  if (modoLetras) letras(); else programa();
})();
