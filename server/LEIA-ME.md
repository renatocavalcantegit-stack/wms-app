# Servidor do WMS (Fase 1c)

API em Node.js (Fastify) com banco PostgreSQL, em SQL puro. O servidor também entrega as telas do app.
- Fase 1a: o servidor APLICA as ações da Separação que chegam pelo `/api/sincronizar`.
- Fase 1b: o coletor da Separação entra pelo servidor e manda as ações por uma fila de envio,
  que funciona sem rede (`js/dados/fila.js` e `js/sincronizacao.js`).
- Fase 1c (esta): a Gestão ganha a aba **Ao vivo** (`gestao-ao-vivo.js`), com a separação de verdade:
  andamento dos pedidos, último contato de cada separador e as ações não aplicadas (conflitos).
  O coletor dá sinal de vida a cada 30 s (o "batimento"), mesmo sem ação nova.

As outras telas (Conferência, Estoque...) e os outros quadros da Gestão continuam com os dados só no aparelho,
como na demonstração. A aba Ao vivo só aparece quando o app é aberto pelo servidor.

## Estrutura

```
db/migracoes/001_base.sql   todas as tabelas, comentadas (comece por aqui)
db/migracoes/002_...sql     mudanças depois da 001: 002 quantidade quebrada · 003 resultado de cada ação
                            · 004 último contato do aparelho e "visto" das ações não aplicadas
db/migrar.js                cria o banco e aplica os .sql de db/migracoes/ que ainda não rodaram
db/semear.js                apaga e carrega a demonstração (os mesmos js/demo-*.js do app)

src/banco.js                conexão com o PostgreSQL e transação
src/senha.js                PIN guardado com hash (scrypt), nunca o PIN
src/consultas/              TODO o SQL, separado por assunto
  sessoes.js                usuário, criar sessão de turno, quem é o dono do token
  produtos.js               produto pelo código de barras ou código interno
  pedidos.js                lista e detalhe dos pedidos da separação
  acoes.js                  grava as ações sincronizadas sem repetir e aplica cada uma
  aplicar-acoes.js          lê o pedido, pergunta à regra o que muda e grava
  painel.js                 o painel Ao vivo da Gestão: pedidos, separadores e ações não aplicadas
src/rotas-api/              os endereços da API (validam a entrada e chamam as consultas)
src/tempo-real.js           canal SSE: avisa as telas conectadas na hora
src/telas.js                entrega as telas do app (só a lista do que é do app: nunca server/, .env, .git...)
src/servidor.js             junta tudo e faz o controle de login
src/iniciar.js              liga o servidor

testes/                     testes contra um banco SÓ de teste (wms_teste), recriado a cada execução
```

## Ordem sugerida para ler

1. `db/migracoes/001_base.sql`: o que o sistema guarda. Depois, a `002` e a `003`, que mudam o que veio depois.
2. `src/consultas/`: como lê e grava (cada função é um ou dois SQL comentados).
3. `src/rotas-api/`: o que a API recebe e devolve.
4. `src/servidor.js`: como o login protege as rotas.
5. `testes/api.test.js`: exemplos de uso de cada rota.
6. `../compartilhado/regras/acoes-separacao.js` e `testes/separacao.test.js`: o que cada ação da Separação faz.

## Primeira vez

1. Copie `.env.example` para `.env` e preencha a senha do usuário `postgres` (o `.env` não vai para o git).
2. Instale as dependências:

```bash
npm install
```

3. Crie o banco e as tabelas:

```bash
npm run migrar
```

4. Carregue a demonstração:

```bash
npm run semear
```

## Rodar

```bash
npm run dev
```

O servidor atende em http://localhost:3000 (porta `PORTA` do `.env`). Para conferir: http://localhost:3000/api/saude

Abra http://localhost:3000 no navegador para usar o app **com o servidor**: o login do separador é conferido
no servidor e cada ação da separação vai para o banco. A linha embaixo do nome mostra o envio
("Tudo enviado", "Enviando…", "Sem rede há X min · N a enviar").

Como o app sabe que tem servidor? Ele lê o `modo.json`. No GitHub Pages é o arquivo do repositório
(`{ "servidor": false }`, modo demonstração); este servidor responde `{ "servidor": true }`.

## Testes

```bash
npm test
```

## API

| Método e endereço | Login? | O que faz |
|---|---|---|
| `GET /api/saude` | não | servidor e banco no ar |
| `POST /api/login` | não | `{ login, pin }` → `{ token, expiraEm, login, nome, perfil }` |
| `GET /api/produtos/:codigo` | sim | produto pelo código de barras ou código interno, com embalagens e endereços com saldo |
| `GET /api/pedidos?setor=exp` | sim | pedidos do setor (`exp` ou `mont`), opcional `&status=pendente` |
| `GET /api/pedidos/:id` | sim | pedido com os itens na ordem de separação e os códigos de barras |
| `POST /api/sincronizar` | sim | `{ acoes: [{ id, tipo, dados, feitaEm }] }` → `{ novas, repetidas, recusadas }`. Com `acoes: []` é o batimento: só grava o último contato |
| `GET /api/tempo-real?token=...` | sim | canal SSE; eventos `acoes` (chegaram ações), `contato` (batimento de um coletor) e `painel` (uma ação foi marcada como vista) |
| `GET /api/painel/separacao?setor=exp` | coordenador | `{ agora, pedidos, separadores, naoAplicadas }` para a aba Ao vivo |
| `POST /api/painel/nao-aplicadas/:id/vista` | coordenador | marca a ação não aplicada como vista (sai da lista); 404 se não existe ou já foi vista |
| `GET /modo.json` | não | `{ servidor: true }`: diz ao app que ele está sendo servido pelo servidor |
| `GET /` e os arquivos do app | não | as telas (index.html, js/, compartilhado/, assets/...) |

Login: mande o token no cabeçalho `Authorization: Bearer <token>`.
A sessão vale 14 horas (um turno).

## Sincronização: o que acontece com cada ação

Cada ação tem um ID criado no aparelho. Se o aparelho reenviar o lote porque a rede caiu antes da resposta,
a ação não é gravada nem aplicada de novo, e a resposta repete o resultado da primeira vez.

As ações são aplicadas na ordem em que foram **feitas** no aparelho (`feitaEm`), não na ordem em que chegaram.

| Tipo | `dados` | O que muda |
|---|---|---|
| `separacao.iniciar` | `{ pedido, lote?, posicao? }` | pedido fica `andamento`, com o login de quem começou e a hora |
| `separacao.item` | `{ pedido, sequencia, qtdSeparada, status, motivo? }` | `status` = `ok` (completo) ou `falta` (com motivo); a quantidade pode ser quebrada |
| `separacao.concluir` | `{ pedido, doca }` | pedido fica `concluido`, com a doca e a hora do fim |
| `separacao.reabrir` | `{ pedido }` | separar novamente: volta para `andamento` com os itens zerados |

Resultado de cada ação (coluna `resultado` em `acoes_recebidas`):
- `aplicada`: mudou o pedido.
- `conflito`: o pedido já está com outro separador. Nada é aplicado; o coordenador vê na aba Ao vivo,
  resolve com o separador e marca como visto (fica gravado quem viu e quando).
- `recusada`: ação inválida (item que não existe, quantidade errada, perfil que não é separador...).
- `desconhecida`: tipo que o servidor ainda não aplica. Fica guardada, sem mexer em nada.

As três últimas voltam em `recusadas: [{ id, resultado, motivo }]`. Todas as ações, mesmo as recusadas,
saem da fila do aparelho: elas já estão no servidor.

Ainda não fazem parte: baixar o saldo do picking no servidor e conferir se a Conferência já começou
antes de "separar novamente". Entram quando o Estoque e a Conferência passarem pelo servidor.

## Aba Ao vivo da Gestão (Fase 1c)

Abra http://localhost:3000, entre como coordenador e clique em **Ao vivo**. A aba relê o painel sempre que
o canal de tempo real avisa (e, por garantia, a cada minuto). O "há X min" é calculado com a hora do servidor.

Situação de cada separador (regra em `compartilhado/regras/painel.js`):

| Situação | Quando |
|---|---|
| Separando | tem pedido em andamento e o coletor deu sinal nos últimos 90 s |
| Livre | sem pedido em andamento, com sinal nos últimos 90 s |
| Sem contato | o coletor não dá sinal há mais de 90 s (três batimentos perdidos): sem rede, desligado ou com o app fechado |
| Não entrou no turno | nunca entrou com o servidor, ou o último contato tem mais de 14 h |

Com o coletor sem rede, as ações continuam na fila do aparelho: a Gestão só vê o andamento quando a rede volta.
