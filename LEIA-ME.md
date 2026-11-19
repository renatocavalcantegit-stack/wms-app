# WMS Beach Bike

App dos operadores (Separação, Conferência, Embarque e Estoque) e painéis de Gestão (Expedição, Montagem e Estoque).
Hoje roda só no navegador, com dados de demonstração guardados no próprio aparelho. Está publicado no GitHub Pages.

## Interface aprovada (referência)

A interface e o layout aprovados são os da **versão 40** (17/11/2026), a última antes do servidor.
Cópia congelada para consultar: https://renatocavalcantegit-stack.github.io/wms-interface-aprovada/
(no Git: a marca `interface-aprovada-v40`). Ajustes técnicos, validações e travas podem entrar;
qualquer mudança visível na interface aprovada precisa ser aprovada antes.

### Mudanças aprovadas depois da v40

Estas decisões valem mais que a v40: **não voltam** ao que era na v40 sem nova aprovação.
Cada mudança de tela aprovada daqui para frente entra nesta lista.

| Versão | Tela | O que foi decidido |
| --- | --- | --- |
| v42 | todas | quantidade quebrada aceita (101,5 UN, 20,935 PR) |
| v43–v47 | coletor | campo de bipe já focado, sem teclado da tela (só sobe ao tocar); modo compacto no C6000 (tela de até 600 px) e faixa vermelha de erro; **sem** atalhos F1/F2; aviso "TECLADO NO MODO Fn · aperte Num" |
| v48–v52 | coletor | trabalha sem esperar a rede (fila de envio); a lista vem do servidor |
| v49 / v53 | Gestão | aba **Ao vivo** (em standby desde a v53) |
| v50 | coletor · lote | a quantidade é pedida **por caixa** (A, B…), não o total da parada; falta por caixa; endereço vazio pergunta pelas outras caixas |
| v51 | etiqueta de volume | endereço em destaque (cidade · UF, bairro, rua e número) e nome da rota na faixa de baixo; sai a linha de itens e o "P PRIOR." |
| v53 | todas | pedido **AGUARDANDO** (o cliente retira): etiqueta no lugar da rota, chip nas caixas de entrada, aba no Acompanhamento, coluna "Aguardando retirada" no Embarque; na conferência, o pedido comum na fila diz "Na fila"; interruptor de **distribuição inteligente** no lugar de "Distribuir automaticamente" |
| v54 | Gestão · Separação | ✓ do pedido marcado para lote; **Ações no alto da gaveta**, antes dos itens; o quadro rola sozinho ao arrastar perto da borda |
| v55–v57 | expedição | **sem a etiqueta PRIORIDADE** (cards, lote, faturamento, gaveta), sem o filtro "Prioridade" e sem o botão de prioridade; só o aguardando é prioridade (coletor e conferência também). Na Montagem (OP) a prioridade continua |
| v58 | Gestão | aviso "Simulação" nas abas que ainda não usam o servidor; **Dispositivos** no menu do usuário; coletor: aviso de login recusado em outro aparelho, Sair não sai sem rede |
| v59–v61 | coletor | toque (uma vez) e vibração quando chega pedido novo na fila |
| v62 | Gestão · Separação | com o servidor, o card abre a **mesma gaveta da demonstração** (o que o servidor ainda não tem aparece "—") |
| v63 | Gestão · gaveta do pedido | a bolinha do item da vez enche pelos passos do coletor: endereço lido 1/3, produto bipado 2/3, quantidade digitada cheia (sem texto novo na tela) |
| v64 | coletor · lista | etiqueta da **rota** (bolinha com a cor e o nome, a mesma da Gestão) no lugar da cidade · UF no card; o aguardando continua com a cidade; no lote, uma etiqueta por rota (quebra a linha quando não cabe) |
| v65 | conferência · fila | clicar no pedido (ou bipar) abre o resumo **"Iniciar conferência"**: quem separou, a doca, itens e unidades, e os itens separados; **Iniciar conferência** (Enter) ou **Voltar** (Esc). O conferente não precisa bipar o pedido. Pedido em conferência abre direto; conferido continua perguntando "Conferir novamente?" |
| v67 | Gestão · Conferência | com o servidor, a aba Conferência é o **quadro de verdade**, igual ao da demonstração: "Separados" + uma coluna por conferente, arrastar para a fila (o posto mostra na mesma ordem), card e gaveta ao vivo com o conferido de cada item. Na Montagem, "Pular conferência" e "Entregues à montagem". O que o servidor ainda não tem (vendedor, embarque, setor de cada conferente) não aparece ou fica "—" |
| v68 | Conferência · posto | **excesso trava o pedido**: contou a mais que o separado, ou bipou produto que não é do pedido → o F10 não finaliza ("Retire o excesso do volume antes de finalizar (F9)"). O F9 liga "retirar": cada bipe tira 1 unidade do que sobra; quando não sobra nada, destrava. Falta continua finalizando com divergência. O servidor também recusa finalizar com excesso |
| v69 | Etiqueta de volume | o **endereço quebra a linha** em vez de cortar com "…" (bairro e rua até 2 linhas; o número sempre aparece à direita). A faixa de baixo (rota, data, conferente) ficou mais estreita e o QR passou para 27 mm, para dar espaço ao endereço |

## Estrutura

```
compartilhado/regras/    regras de negócio puras (sem tela, sem armazenamento)
  rotas.js               horário de corte e data de embarque de cada rota
  volumes.js             observação dos volumes e texto [WMS] enviado ao Sankhya
  etiqueta-volume.js     conteúdo do QR da etiqueta e leitura no embarque
  produtos.js            busca por EAN/SKU, ordem de separação pelo endereço e conferência por checkout (bipe por unidade) ou granel
  enderecos.js           endereço numérico da prateleira (R3001-P7-A100-AP101), cadastro um a um e em lote, desativar/reativar, endereço padrão
  embalagens.js          embalagens e código de barras único, busca de produto, importação do ERP
  etiqueta-produto.js    etiqueta de produto com QR: rolo 90 × 20 mm, 3 por linha
  recebimento.js         recebimento: status da nota, conferência (soma, bloqueia acima da nota), volumes, armazenamento da doca
  movimentacao.js        mínimo/máximo, origens do abastecimento (menor saldo, mais perto), passos da tarefa, transferência
  inventario.js          contagens C1 a C5, situação do item e do endereço, decisão, sincronização atômica
  separacao.js           doca de expedição, lote (2 a 6 pedidos numa viagem, caixas A–F), pedido dividido entre separadores (2 a 4 partes)
  ocorrencias.js         corte de item e cancelamento do pedido (o que diminui, o que volta pela doca de devolução, o que bloqueia)

js/
  sessao.js              login de demonstração e sessão guardada no aparelho
  demo-dados.js          equipe, catálogo, endereços e pedidos de demonstração
  demo-catalogo.js       produtos mais vendidos (gerado por ferramentas/gerar-dados-demo.py)
  demo-estoque-real.js   endereços, produtos e saldos reais do WMS (gerado por ferramentas/gerar-estoque-real.py)
  demo-clientes.js       clientes do ranking, com cidade, rota e vendedor (gerado pelo mesmo script)
  dados/separacao.js     camada de dados da Separação (único lugar que sabe onde os pedidos ficam)
  dados/conferencia.js   camada de dados da Conferência (e os pedidos que chegam da Separação)
  dados/estoque.js       camada de dados do Estoque: endereços, produtos, embalagens, endereço padrão e saldos
  dados/recebimento.js   camada de dados do Recebimento: notas, conferências, volumes, armazenamento, notas do ERP
  dados/movimentacao.js  camada de dados da Movimentação: tarefas de abastecimento, limites, transferência, baixa da separação
  dados/inventario.js    camada de dados do Inventário: criar, incluir, finalizar contagem, decidir, finalizar e sincronizar; divergências de saldo
  dados/ocorrencias.js   corte e cancelamento do pedido: mexe na Separação, na Conferência e no Embarque ao mesmo tempo, com histórico
  dados/embarque.js      consulta às cargas do Embarque (pedido em carregamento) e retirada de pedido cancelado
  qr.js                  desenho do QR Code em SVG
  etiqueta-produto.js    desenho da etiqueta de produto (QR em SVG, linhas de 3)
  etiqueta-recebimento.js   etiqueta do volume do recebimento (80 × 60 mm, QR com o código do volume)
  ui-estoque.js          pedaços de tela do coletor do Estoquista (mensagem, confirmação, cartão do produto)
  util.js                atalhos de tela: $, $$ e esc
  ui-coletor.js          aviso, bipe, troca de tela, sheets e câmera do app do coletor

index.html + app.js      app do coletor: login e Separação (pedido, lote "Separar vários", parte de pedido dividido, leitura da doca)
embarque.js              Embarque (também no app do coletor)
conferencia.html + .js   Conferência (notebook com leitor)
etiqueta.js              desenho e impressão da etiqueta de volume
gestao.html, montagem.html + gestao.js   painéis de Gestão (ainda com simulador próprio): lotes, divisão de pedido e doca
estoque.html + .js       coletor do Estoquista: consulta de produto, embalagem, endereçar produto
estoque-recepcao.js      coletor do Estoquista, Recepção: conferência, armazenamento e consulta de recebimentos
gestao-estoque.html + .js   Gestão de Estoque (WEB): endereços, produtos/embalagens, endereçamento
gestao-entrada.js        Gestão de Estoque (WEB), aba Entrada: notas, detalhe, volumes, cancelar pendente
estoque-movimentacao.js  coletor do Estoquista, Movimentação: abastecimento (aéreo → picking) e transferência
gestao-movimentacao.js   Gestão de Estoque (WEB), aba Movimentação: tarefas de abastecimento e mínimo/máximo do picking
estoque-inventario.js    coletor do Estoquista, Auditoria: contagem do inventário (endereço → produto → quantidade → INCLUIR)
gestao-inventario.js     Gestão de Estoque (WEB), aba Inventário: criar, acompanhar, aprovar divergências, finalizar, sincronizar, histórico
gestao-ocorrencias.js    Gestão de Expedição (WEB), aba Ocorrências: corte de item e cancelamento do pedido, com motivo e referência do Sankhya
sw.js                    service worker: guarda os arquivos para abrir sem rede
teste-leitor.html        página de diagnóstico do leitor do coletor (fora dos menus) — ver "Configurar o coletor"

server/                  servidor (Fase 0): API Fastify + PostgreSQL em SQL puro — ver server/LEIA-ME.md

testes/                  testes automatizados das regras e dados (rodam no Node, sem instalar nada)
e2e/                     testes de ponta a ponta: abrem as telas num navegador automático e conferem se uma tela
                         enxerga o que a outra fez (separação → estoque → conferência → embarque, estoque, perfis)
```

## Ordem sugerida para ler o código

1. **`compartilhado/regras/`** e o teste de cada arquivo em `testes/`. Cada teste mostra, com exemplos, o que a regra faz.
2. **`js/dados/separacao.js`** e **`js/dados/conferencia.js`**: por onde os dados entram e saem. É aqui que a Fase 1 (offline com fila de sincronização) vai mexer.
3. **`js/sessao.js`** e **`js/demo-dados.js`**.
4. As telas: **`app.js`** (Separação), **`conferencia.js`** e **`embarque.js`**. O topo de cada uma lista o que ela importa.

## Rodar os testes

Precisa só do Node (versão 22 ou mais nova):

```bash
npm test
```

Testes de ponta a ponta (navegador automático, Playwright). Na primeira vez, instalar:

```bash
npm install
```

```bash
npx playwright install chromium
```

Depois, para rodar (uns 3 minutos; o próprio teste sobe um servidor na porta 5175):

```bash
npm run e2e
```

## Configurar o coletor (Chainway C6000)

O app do coletor coloca o foco sozinho no campo de bipe **sem abrir o teclado da tela** (para não cobrir a tela pequena).
Para o código lido chegar ao campo assim, o leitor precisa "apertar as teclas" — e não escrever pelo teclado do sistema.
Configuração validada em 17/11/2026 (Chainway C6000, Android 10, tela de 4"):

| Onde | Opção | Valor |
|---|---|---|
| app **keyboardemulator** → aba Function | Enable Scanner | ligado · Barcode2D marcado (KeyCode 139) |
| keyboardemulator → **AppSettings** → Process mode | modo de saída | **Keyboard input** (o padrão "Scan content on cursor" NÃO funciona com o foco sem teclado) |
| AppSettings → End mark | fim do código | **Enter** |
| AppSettings → Prefix / Suffix | | vazios |
| AppSettings → Data Format | | default |
| teclado físico | modo | **números**: tecla **Num** até o ícone da barra de status mostrar **"1"** (não "Fn") |

Por que cada detalhe importa:
- **Process mode em "Scan content on cursor"**: o leitor apita, mas o código não entra no campo.
- **Teclado travado em "Fn"**: os números 1 a 6 do código viram F1…F6 (o F1 abre a "Ajuda do Google Chrome").
  O app avisa "TECLADO NO MODO Fn · aperte Num…" e descarta o bipe incompleto; o separador aperta **Num** e bipa de novo.
- O gatilho **SCAN** envia **F9** (KeyCode 139) antes de cada código: é normal, o app ignora.
- O app **não usa teclas F** no coletor (falta e lista de itens são por toque); **Enter** confirma.
- Para digitar (ex.: ID do endereço), basta **tocar no campo**: aí o teclado da tela sobe.

**Coletor novo, ou depois de um reset de fábrica:** aplicar a tabela acima e conferir em
`/teste-leitor.html` (ex.: https://demo.renatoflow.com.br/teste-leitor.html): tocar em **"Focar sozinho"** do campo 1 e bipar
uma etiqueta de volume — o quadro fica verde com o código inteiro (`PV-…|1/1|CLIENTE|CIDADE-UF`) e o teclado da tela não sobe.
A lista "O que chegou" mostra as teclas que o coletor enviou, para diagnosticar outro modelo.

## Rodar o app no computador

Qualquer servidor de arquivos estáticos na pasta do projeto, por exemplo:

```bash
python -m http.server 5174
```

e abrir http://localhost:5174.

## Publicar uma versão nova

Subir o número da versão (`?v=N`) em todos os `.html`, e `CACHE` / `V` no `sw.js`. Arquivo novo entra na lista `ASSETS` do `sw.js`.
