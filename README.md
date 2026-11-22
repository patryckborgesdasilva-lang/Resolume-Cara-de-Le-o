# 🦁 Cara de Leão — Projeção

Programa de projeção para a igreja, no estilo do **Resolume**, que roda direto no navegador.
Não precisa instalar nada.

![camadas](https://img.shields.io/badge/camadas-ilimitadas-orange) ![navegador](https://img.shields.io/badge/Chrome%20%2F%20Edge-recomendado-blue)

## O que ele faz

- **Camadas** (começa com 3: *Fundo*, *Mídia* e *Letras*; dá para adicionar mais). A camada de cima fica por cima.
  Cada uma tem opacidade, modo de mistura (Normal, Screen, Add, Multiplicar…), tempo de transição (fade) e efeitos
  (brilho, contraste, saturação, matiz, desfoque e zoom).
- **Grade de clipes** igual à do Resolume: clicou, entrou no ar com transição suave. Os botões ▶ 1, ▶ 2… colocam
  a coluna inteira no ar.
- **Tipos de clipe**
  - 🎬 **Vídeo** (em loop, com velocidade e volume; o áudio acompanha o fade)
  - 🖼 **Imagem** (JPG, PNG com transparência, etc.)
  - 🔤 **Texto / letra de música**: cole a letra e deixe uma **linha em branco** entre as estrofes; cada bloco vira
    um slide. Fonte, contorno, sombra, faixa de fundo, posição (centro/rodapé) e modelos prontos
    (Letra, Legenda, Versículo, Título). O texto diminui sozinho se não couber.
  - 🎨 **Cor ou degradê**
  - 📷 **Câmera / placa de captura** (HDMI/USB aparecem como câmera)
  - 🖥 **Janela ou tela do computador** (ex.: PowerPoint, Holyrics, navegador)
- **Janela do projetor** separada, sem bordas, em tela cheia.
- **Passador de slides (clicker) funciona**: as setas e PageUp/PageDown trocam os slides da letra no ar.
- **Blackout** com fade e **Master** para escurecer tudo.
- **Salva sozinho** no navegador, inclusive os vídeos e imagens.

## Como usar

1. Baixe este repositório (botão **Code → Download ZIP**) e descompacte.
2. Abra o arquivo **`index.html`** no **Google Chrome** ou **Microsoft Edge**.
3. Ligue o projetor/TV como **tela estendida** (no Windows: `Win + P` → *Estender*).
4. Clique em **📽 Abrir projetor**, arraste a janela que abriu para o projetor e dê **dois cliques** nela
   (ou tecle **F**) para ficar em tela cheia.
   - Se o navegador bloquear a janela, permita pop-ups para a página.
   - No menu ☰ existe *Mover projetor para a 2ª tela*, que faz isso automaticamente no Chrome/Edge.
5. Arraste vídeos e imagens do computador para as células da grade, ou clique num **+** para criar texto,
   cor, câmera etc.
6. Clique num clipe para colocá-lo no ar. **Botão direito** (ou o ✎) só seleciona para editar, sem ir pro ar.

> Também dá para publicar no **GitHub Pages** (Settings → Pages → branch) e abrir pelo endereço do site.

## Atalhos

| Tecla | Ação |
|---|---|
| `→` `↓` `PageDown` | Próximo slide da letra |
| `←` `↑` `PageUp` | Slide anterior |
| `C` | Tira a letra do ar |
| `B` ou `.` | Blackout (tela preta) |
| `1` … `9` | Coloca a coluna no ar |
| `Delete` | Remove o clipe selecionado |
| `F` / duplo clique | Tela cheia (na janela do projetor) |

Os atalhos funcionam tanto no painel de controle quanto com a janela do projetor em foco.

## Montagem sugerida para o culto

| Camada | Uso | Dica |
|---|---|---|
| 3 · Letras | Clipes de texto (uma música por clipe) | Transição de 0,3–0,5 s |
| 2 · Mídia | Logo, avisos, vídeos de anúncio, câmera | PNG com fundo transparente fica por cima do fundo |
| 1 · Fundo | Vídeos de fundo em loop, degradês | Use *Desfoque* e *Brilho* baixo para a letra ficar legível |

Uma coluna por música ajuda: a coluna 1 tem o fundo + a letra da 1ª música, a coluna 2 tem os da 2ª, e assim por
diante — é só apertar `1`, `2`, `3`…

## Dicas e limitações

- Vídeos: prefira **MP4 (H.264)** ou **WebM**. Arquivos `.mov` em ProRes não abrem no navegador
  (converta com o HandBrake, por exemplo).
- Use **Chrome ou Edge**. Firefox e Safari funcionam parcialmente (efeitos de camada podem não aparecer).
- Não minimize a janela de controle durante o culto (pode deixá-la atrás de outras janelas, sem problema).
- Os arquivos ficam guardados **neste navegador, neste computador**. Para levar para outro computador,
  é preciso importar os arquivos de novo.
- Fechar a janela de controle não apaga nada; ao abrir de novo, tudo volta como estava.

## Arquivos

```
index.html      → página principal (painel de controle)
css/style.css   → visual
js/app.js       → motor de camadas, letras, projetor e salvamento
```
