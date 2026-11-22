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
  - 📡 **Câmera NDI** (câmeras pela rede, via NDI Tools; veja abaixo)
  - 🖥 **Janela ou tela do computador** (ex.: PowerPoint, Holyrics, navegador)
  - 🎶 **Holyrics ao vivo**: mostra o slide que está no ar no Holyrics, com o seu visual (veja abaixo)
- **Janela do projetor** separada, sem bordas, em tela cheia.
- **Passador de slides (clicker) funciona**: as setas e PageUp/PageDown trocam os slides da letra no ar.
- **Blackout** com fade e **Master** para escurecer tudo.
- **Salva sozinho** no navegador, inclusive os vídeos e imagens.

## Como usar

1. Baixe este repositório (botão **Code → Download ZIP**) e descompacte.
2. **Windows:** dê dois cliques em **`Iniciar-Windows.bat`**. Ele abre uma janela preta (a "ponte", deixe aberta)
   e o programa no Chrome/Edge em `http://localhost:8090`.
   **Mac/Linux:** com o [Node.js](https://nodejs.org) instalado, rode `./iniciar-mac-linux.sh`.
   *(Sem Holyrics, dá também para abrir o `index.html` direto no Chrome/Edge.)*
3. Ligue o projetor/TV como **tela estendida** (no Windows: `Win + P` → *Estender*).
4. Clique em **📽 Abrir projetor**, arraste a janela que abriu para o projetor e dê **dois cliques** nela
   (ou tecle **F**) para ficar em tela cheia.
   - Se o navegador bloquear a janela, permita pop-ups para a página.
   - No menu ☰ existe *Mover projetor para a 2ª tela*, que faz isso automaticamente no Chrome/Edge.
5. Arraste vídeos e imagens do computador para as células da grade, ou clique num **+** para criar texto,
   cor, câmera etc.
6. Clique num clipe para colocá-lo no ar. **Botão direito** (ou o ✎) só seleciona para editar, sem ir pro ar.

> Também dá para publicar no **GitHub Pages** (Settings → Pages → branch) e abrir pelo endereço do site.

## Saídas

Botão **🖥 Saídas** na barra de cima.

### HDMI (projetor / TV)
1. Ligue o cabo HDMI e deixe o Windows em **Estender** (`Win + P`).
2. **Abrir janela do projetor** → **Detectar telas** → **Enviar projetor para esta tela**
   (ou arraste a janela até o projetor).
3. Dê **dois cliques** na imagem (ou tecle **F**) para tela cheia.
4. Na mesma lista, **Usar esta resolução** deixa o programa com a resolução exata da tela.

**Imagem de teste**: mostra grade, barras de cor, borda vermelha e área segura em todas as saídas, para ajustar
o foco, o enquadramento e o corte (overscan) da TV/projetor. O botão *Saídas* fica vermelho enquanto ela está ligada.

### Navegador / OBS
Com o programa aberto pelo `Iniciar-Windows.bat`, a janela *Saídas* mostra dois endereços:

| Endereço | O que mostra | Uso no OBS |
|---|---|---|
| `http://localhost:8090/saida.html` | **Programa completo**, igual ao projetor (ao vivo, por WebRTC) | Fonte de vídeo da cena |
| `http://localhost:8090/saida.html?letras` | **Só as letras, com fundo transparente** (com as transições) | Por cima da câmera na transmissão |

No OBS: **Fontes → + → Navegador** → cole o endereço → largura e altura iguais à resolução do programa
(ex.: 1920 × 1080). A qualidade do programa completo (alta 30/60 fps, média 720p, leve 540p) é escolhida na
janela *Saídas*. Se o painel for recarregado, o OBS reconecta sozinho em poucos segundos.

- A janela de controle precisa ficar aberta, e o OBS precisa estar **no mesmo computador**.
- A saída de letras também segue o clipe **Holyrics ao vivo** (letra do Holyrics por cima da câmera no OBS).
- Sem a ponte, ainda dá para usar no OBS a fonte **Captura de janela** na janela *Projetor — Cara de Leão*.

## Holyrics

A integração usa o **API Server** do Holyrics.

**1. No Holyrics:** menu **Arquivo → Configurações → API Server**
- ative o servidor e anote a **porta**;
- em **gerenciar permissões**, crie um **token** e libere pelo menos: `GetCurrentPresentation`,
  `GetCurrentBackground`, `GetThumbnail`, `ActionNext`,
  `ActionPrevious`, `ActionGoToIndex`, `GetCurrentSchedule`, `GetLyricsPlaylist`, `SearchLyrics`, `GetLyrics`
  (e `GetTokenInfo` para o botão de teste).

**2. Aqui:** botão **Holyrics** na barra de cima → IP (use `127.0.0.1` se o Holyrics está no mesmo computador),
porta e token → **Testar conexão**. A bolinha do botão fica verde quando está conectado.

### Holyrics em camadas (fundo + letra separados)

Clique num `+` → **🎶 Holyrics em camadas** (ou o botão na janela Holyrics). O programa cria, na mesma coluna:

- na camada **Fundo**: o clipe **Fundo do Holyrics ao vivo**, com o vídeo/imagem/tema que está no ar no Holyrics,
  trocando junto com ele (com transição);
- na camada **Letras**: o clipe **Holyrics ao vivo (letra)**, só o texto, com o visual definido aqui.

Aperte o número da coluna e pronto: o Holyrics comanda tudo, e como letra e fundo ficam em camadas separadas, dá
para pôr câmera ou logo entre eles, desfocar só o fundo, mandar só a letra para o OBS etc.
Tela preta no Holyrics deixa o fundo preto e tira a letra.

**Qualidade do fundo:** a API do Holyrics informa *qual* fundo está no ar, mas não envia o arquivo. O programa
procura o mesmo arquivo na **pasta de mídia do Holyrics** (pela ponte) e usa o original, em qualidade total.
Se o Holyrics estiver em **outro computador**, compartilhe a pasta de mídia dele na rede e informe o caminho
(ex.: `\\PC-HOLYRICS\Holyrics`) no clipe de fundo. Sem o arquivo (ou em temas), usa a miniatura enviada
pelo Holyrics, em resolução menor (o painel avisa quando isso acontece).

> Por que não usar direto as URLs que o Holyrics gera para o OBS? Elas são páginas web, e o navegador não deixa um
> programa capturar a imagem de uma página de outro endereço para misturar com as camadas. A API, com o mesmo
> IP, entrega o texto e o fundo separados, que é exatamente o que precisamos.

**O que dá para fazer:**

| Recurso | Como |
|---|---|
| **Letra ao vivo** | Clique num `+` → *Holyrics ao vivo*. O clipe mostra o slide que está no ar no Holyrics, com fonte, contorno e posição definidos aqui, por cima dos seus fundos e vídeos. Tela preta/limpa no Holyrics some daqui também. |
| **Controlar o Holyrics daqui** | Com o clipe Holyrics no ar, as setas e o passador avançam/voltam o Holyrics. O painel de baixo mostra os slides da música e um clique vai direto para o slide. |
| **Importar músicas** | Janela Holyrics → *Músicas do culto* (lista do culto atual) ou *Buscar música* → *Importar*. Cada música vira um clipe de texto, já na ordem da música (com refrão repetido). Funciona sem depender do Holyrics durante o culto. |
| **Importar fundos** | Janela Holyrics → *Fundos*: lista os vídeos e imagens da pasta de mídia do Holyrics (ou qualquer pasta) e importa com um clique, em qualidade total. Precisa da ponte (`Iniciar-Windows.bat`). |
| **Tela inteira do Holyrics** | O Holyrics tem saída NDI: dá para trazer a tela dele (com os fundos dele) como uma câmera NDI. |

> **Por que a "ponte"?** O navegador costuma bloquear um site que conversa direto com outro programa da rede
> (proteção chamada CORS). O `Iniciar-Windows.bat` liga um pequeno servidor local (PowerShell, já vem no Windows)
> que repassa as chamadas para o Holyrics. Ele só aceita conexões deste computador.
>
> A API do Holyrics não envia os arquivos de vídeo dos fundos nem o texto de versículos da Bíblia em lista
> de slides. Por isso os fundos vêm da pasta de mídia, e versículos aparecem apenas no clipe *Holyrics ao vivo*
> quando o Holyrics enviar o texto.

## OBS como entrada (cenas, fontes e a câmera da placa de captura)

O programa conversa com o OBS pelo **servidor WebSocket que já vem no OBS** (versão 28 ou mais nova).
Funciona com o OBS no mesmo computador e não precisa da ponte.

**1. No OBS:** menu **Ferramentas → Configurações do servidor WebSocket** → marque **Ativar servidor WebSocket**.
Em *Mostrar informações de conexão* estão a porta (normalmente 4455) e a senha.

**2. Aqui:** botão **OBS** na barra de cima → senha → **Conectar**. A bolinha fica verde e o programa reconecta
sozinho nas próximas vezes.

| Recurso | Como | Ideal para |
|---|---|---|
| 🎥 **OBS — câmera virtual** | `+` → *OBS — câmera virtual*. O programa liga a câmera virtual do OBS sozinho quando o clipe vai pro ar. | **Câmera da placa de captura**, em vídeo ao vivo e qualidade total |
| 📺 **Cena ou fonte do OBS** | `+` → *Cena ou fonte do OBS…* → clique na cena/fonte (aparecem com miniatura). | Slides, logos, cenas paradas (5 a 15 imagens por segundo) |

**Por que a câmera vem pela câmera virtual?** No Windows a placa de captura só pode ser aberta por **um programa
de cada vez**. Como ela já está no OBS, o OBS repassa a imagem. No **OBS 30 ou mais novo**, clique na
engrenagem ⚙ ao lado de *Iniciar câmera virtual* → **Tipo de saída: Fonte** → escolha a placa de captura.
Assim chega só a câmera, e o que vai para a transmissão não muda.

> O OBS tem uma câmera virtual só. Para trazer mais de uma câmera do OBS, use o plugin DistroAV (NDI) no OBS e o
> NDI Webcam Input (veja NDI abaixo).

## NDI (câmeras pela rede)

O navegador não recebe NDI diretamente, então usamos a ferramenta gratuita da própria NDI que transforma uma fonte
NDI em "webcam":

1. Instale o **[NDI Tools](https://ndi.video/tools/)** no computador da projeção.
2. Abra o **NDI Webcam Input** e escolha a câmera NDI (no Windows ele aceita mais de uma fonte).
3. Aqui: clique num `+` → **📡 Câmera NDI (rede)**. O programa escolhe a fonte NDI sozinho; para trocar, use
   *Dispositivo* no painel da direita (fontes NDI aparecem com 📡).

Outra opção é o OBS com o plugin DistroAV + câmera virtual do OBS. Placas de captura HDMI/USB funcionam direto,
como câmera comum.

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
Iniciar-Windows.bat   → abre o programa com a ponte (Windows)
iniciar-mac-linux.sh  → abre o programa com a ponte (Mac/Linux, precisa de Node.js)
index.html            → página principal (painel de controle)
saida.html            → saída para o OBS / navegador (js/saida.js)
css/style.css         → visual
js/app.js             → camadas, letras, projetor, Holyrics, NDI e salvamento
ponte/ponte.ps1       → ponte local em PowerShell (Windows)
ponte/ponte.js        → a mesma ponte em Node.js
```
