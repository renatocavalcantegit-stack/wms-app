# WMS Beach Bike

App dos operadores (Separação, Conferência, Embarque e Estoque) e painéis de Gestão (Expedição, Montagem e Estoque).
Hoje roda só no navegador, com dados de demonstração guardados no próprio aparelho. Está publicado no GitHub Pages.

## Estrutura

```
compartilhado/regras/    regras de negócio puras (sem tela, sem armazenamento)
  rotas.js               horário de corte e data de embarque de cada rota
  volumes.js             observação dos volumes e texto [WMS] enviado ao Sankhya
  etiqueta-volume.js     conteúdo do QR da etiqueta e leitura no embarque
  produtos.js            busca por EAN/SKU e ordem de separação pelo endereço
  enderecos.js           endereço numérico da prateleira (R3001-P7-A100-AP101), cadastro um a um e em lote, desativar/reativar, endereço padrão
  embalagens.js          embalagens e código de barras único, busca de produto, importação do ERP
  etiqueta-produto.js    etiqueta de produto com QR: rolo 90 × 20 mm, 3 por linha
  recebimento.js         recebimento: status da nota, conferência (soma, bloqueia acima da nota), volumes, armazenamento da doca
  movimentacao.js        mínimo/máximo, origens do abastecimento (menor saldo, mais perto), passos da tarefa, transferência
  inventario.js          contagens C1 a C5, situação do item e do endereço, decisão, sincronização atômica

js/
  sessao.js              login de demonstração e sessão guardada no aparelho
  demo-dados.js          equipe, catálogo, endereços e pedidos de demonstração
  demo-catalogo.js       produtos mais vendidos (gerado por ferramentas/gerar-dados-demo.py)
  demo-clientes.js       clientes do ranking, com cidade, rota e vendedor (gerado pelo mesmo script)
  dados/separacao.js     camada de dados da Separação (único lugar que sabe onde os pedidos ficam)
  dados/conferencia.js   camada de dados da Conferência (e os pedidos que chegam da Separação)
  dados/estoque.js       camada de dados do Estoque: endereços, produtos, embalagens, endereço padrão e saldos
  dados/recebimento.js   camada de dados do Recebimento: notas, conferências, volumes, armazenamento, notas do ERP
  dados/movimentacao.js  camada de dados da Movimentação: tarefas de abastecimento, limites, transferência, baixa da separação
  dados/inventario.js    camada de dados do Inventário: criar, incluir, finalizar contagem, decidir, finalizar e sincronizar
  qr.js                  desenho do QR Code em SVG
  etiqueta-produto.js    desenho da etiqueta de produto (QR em SVG, linhas de 3)
  etiqueta-recebimento.js   etiqueta do volume do recebimento (80 × 60 mm, QR com o código do volume)
  ui-estoque.js          pedaços de tela do coletor do Estoquista (mensagem, confirmação, cartão do produto)
  util.js                atalhos de tela: $, $$ e esc
  ui-coletor.js          aviso, bipe, troca de tela, sheets e câmera do app do coletor

index.html + app.js      app do coletor: login e Separação
embarque.js              Embarque (também no app do coletor)
conferencia.html + .js   Conferência (notebook com leitor)
etiqueta.js              desenho e impressão da etiqueta de volume
gestao.html, montagem.html + gestao.js   painéis de Gestão (ainda com simulador próprio)
estoque.html + .js       coletor do Estoquista: consulta de produto, embalagem, endereçar produto
estoque-recepcao.js      coletor do Estoquista, Recepção: conferência, armazenamento e consulta de recebimentos
gestao-estoque.html + .js   Gestão de Estoque (WEB): endereços, produtos/embalagens, endereçamento
gestao-entrada.js        Gestão de Estoque (WEB), aba Entrada: notas, detalhe, volumes, cancelar pendente
estoque-movimentacao.js  coletor do Estoquista, Movimentação: abastecimento (aéreo → picking) e transferência
gestao-movimentacao.js   Gestão de Estoque (WEB), aba Movimentação: tarefas de abastecimento e mínimo/máximo do picking
estoque-inventario.js    coletor do Estoquista, Auditoria: contagem do inventário (endereço → produto → quantidade → INCLUIR)
gestao-inventario.js     Gestão de Estoque (WEB), aba Inventário: criar, acompanhar, aprovar divergências, finalizar, sincronizar, histórico
sw.js                    service worker: guarda os arquivos para abrir sem rede

testes/                  testes automatizados (rodam no Node, sem instalar nada)
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

## Rodar o app no computador

Qualquer servidor de arquivos estáticos na pasta do projeto, por exemplo:

```bash
python -m http.server 5174
```

e abrir http://localhost:5174.

## Publicar uma versão nova

Subir o número da versão (`?v=N`) em todos os `.html`, e `CACHE` / `V` no `sw.js`. Arquivo novo entra na lista `ASSETS` do `sw.js`.
