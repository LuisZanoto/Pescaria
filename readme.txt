PESCARIA NO MOGI — PROTÓTIPO DE NAVEGAÇÃO

Resumo
-------
O início do jogo é um passeio em visão superior pelo rio Mogi. O jogador conduz
um barco equipado com motor de popa de 15 HP por um rio sinuoso, com vegetação
nas margens, praias de água doce, pedras, galhos e passagens estreitas.
Nesta primeira etapa, o foco é navegar e desviar de obstáculos; a mecânica de
pescaria poderá ser acrescentada em uma fase futura.

Como jogar
----------
Abra index.html em um navegador atualizado e selecione "Começar o passeio".

←/→ ou A/D: virar para a esquerda ou direita (comandos invertidos em ré).
↑ ou W: acelerar; uma pressão aumenta a velocidade e manter pressionado acelera
mais. Ao soltar, o barco mantém a velocidade atingida.
↓ ou S: reduzir; mantendo pressionado, desacelera até parar e continua em ré.
O cenário fica parado com velocidade zero e acompanha o barco para frente ou ré.
P ou espaço: pausar ou continuar.
Celular: use os botões na parte inferior da tela.
O botão de som e o controle de volume ajustam o ambiente sonoro.

Estrutura do projeto
--------------------
index.html          Página principal do jogo.
css/game.css        Estilos e adaptação para celular.
js/game.js          Navegação, desenho do rio, barco, obstáculos e áudio.
assets/images/      Imagens .jpg e outros recursos visuais.
assets/audio/       Gravações de ambiente e efeitos sonoros.
modelo.html         Arquivo de referência do projeto anterior.
foto1.jpg           Referência visual fornecida para a vista do rio.

O protótipo gera o rio e os sons de água, vento, motor e pássaros no próprio
navegador. As pastas de imagens e áudio estão prontas para receber novos
recursos sem depender deles para iniciar o jogo.

Paisagem
--------
A vista é sempre superior: as margens são preenchidas com copas sobrepostas
em tons de verde escuro e claro, usando dez modelos reutilizáveis de árvores,
incluindo figueira, farinha-seca, coqueiro, bambu e palmeiras. O rio ocupa
aproximadamente 60% da largura normal da cena; cada margem arborizada ocupa
cerca de 20%. As praias são curtas e espaçadas, aparecendo em aproximadamente
10% do percurso representado.