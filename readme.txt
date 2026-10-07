PESCARIA NO MOGI — PROTÓTIPO DE NAVEGAÇÃO

Resumo
-------
O jogador navega uma canoa de 6 metros de comprimento e 1,2 m de largura,
com motor de popa de 5 HP e quatro bancos, cada um ocupado por um pescador.
O pescador no banco de popa pilota;
os outros três são passageiros. O percurso sinuoso tem 18 km: começa no meio,
segue 9 km rio acima até o ponto 1 e outros 9 km rio abaixo até o ponto 2.

Como jogar
----------
Abra index.html em um navegador atualizado e selecione "Começar o passeio".

←/→ ou A/D: virar para a esquerda ou direita (comandos invertidos em ré).
Virar com ←/→ também muda a direção e a orientação do barco.
↑ ou W: acelerar; uma pressão aumenta a velocidade e manter pressionado acelera
mais. Ao soltar, o barco mantém a velocidade atingida.
↓ ou S: reduzir; mantendo pressionado, desacelera até parar e continua em ré.
↑ segue rio abaixo; ↓ reduz e, em seguida, conduz rio acima em marcha à ré.
No ponto 1, só é possível seguir rio abaixo; no ponto 2, só é possível subir
o rio. O cenário fica parado com velocidade zero e acompanha a canoa.
Evite curvas fechadas acima de aproximadamente 10 km/h: a canoa pode virar e
encerrar a partida. Ao ver o aviso de curva perigosa, reduza a velocidade.
O motor de 5 HP e 2 tempos usa cinco níveis simulados de rotação/ruído: de
800 a 9.000 RPM, com frequências fundamentais de 13,3 a 150 Hz e cinco
componentes harmônicas. O painel mostra RPM e nível de ruído. A simulação de
áudio não é uma medição calibrada em dB; o controle de volume ajusta a saída.
O consumo segue motor.txt: 8 L rio acima (contra a correnteza) e 4 L rio
abaixo (a favor da correnteza), por trecho de 9 km. O tempo de 30 min rio
acima e 20 min rio abaixo, em velocidade maxima, corresponde a 18 km/h e
27 km/h, respectivamente. O tanque comporta 10 L e comeca com 3 L. O audio do
motor e atenuado para evitar volume agressivo no nivel 5 / 9.000 RPM.
P ou espaço: pausar ou continuar.
Celular: use os botões na parte inferior da tela.
O botão de som e o controle de volume ajustam o ambiente sonoro.

Estrutura do projeto
--------------------
index.html          Página principal do jogo.
css/game.css        Estilos e adaptação para celular.
js/game.js          Navegação, desenho do rio, barco, obstáculos e áudio.
motor.txt          Especificação do motor, consumo, rotação e ruído.
mapas.txt          Especificação sincronizada do minimapa e da cena principal.
assets/images/      Imagens .jpg e outros recursos visuais.
assets/audio/       Gravações de ambiente e efeitos sonoros.
modelo.html         Arquivo de referência do projeto anterior.
foto1.jpg           Referência visual fornecida para a vista do rio.

O protótipo gera o rio e os sons de água, vento, motor e pássaros no próprio
navegador. A canoa, os quatro bancos, pescadores e motor são desenhados em
vista superior pelo próprio jogo. As pastas de imagens e áudio estão prontas
para receber novos recursos sem depender deles para iniciar o jogo.

Trajeto
-------
O minimapa usa a própria foto2.jpg como fundo para preservar exatamente o mapa
de referência e sobrepõe um ponto vermelho na posição da canoa. O percurso
rastreado segue os meandros da imagem: ponto 1 no extremo rio acima (km 0),
início no meio (km 9) e ponto 2 no extremo rio abaixo (km 18). O marcador anda
para cima ou para baixo ao longo do mesmo traçado conforme a canoa navega.

Paisagem
--------
A vista é sempre superior: a tela principal usa os mesmos caminhos vetoriais
do minimapa para desenhar o leito do rio e as duas margens; a canoa permanece
sobre esse trajeto e não atravessa terra nas curvas. A largura do rio varia
entre 30 e 90 m, enquanto a canoa mede 6 m por 1,2 m e é desenhada nessa
proporção em relação à água.
As margens são preenchidas com copas sobrepostas
em tons de verde escuro e claro inspirados na foto de referência, usando dez
modelos reutilizáveis de árvores,
incluindo figueira, farinha-seca, coqueiro, bambu e palmeiras. A água tem cor
escura acinzentada-esverdeada, semelhante à foto.
As praias são curtas e espaçadas, aparecendo em aproximadamente 10% do percurso.
A câmera amplia as curvas do trajeto no cenário principal; a proa do marcador
do minimapa acompanha o sentido de deslocamento da canoa.

Motor
-----
Os valores de motor.txt estão espelhados no objeto motor em js/game.js porque
o jogo deve funcionar ao abrir index.html diretamente com file://. Ao mudar
qualquer parâmetro do motor, atualize a especificação e o objeto do jogo;
confira também os efeitos correspondentes na física, no consumo, no painel e
no áudio. Os dois mapas seguem a especificação mantida em mapas.txt; sincronize
esse arquivo ao modificar qualquer mapa.