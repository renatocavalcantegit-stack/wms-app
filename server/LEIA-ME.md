# Servidor do WMS (Fase 1a)

API em Node.js (Fastify) com banco PostgreSQL, em SQL puro.
O app ainda não usa o servidor: ele continua com os dados no aparelho.
- Fase 1a (esta): o servidor já APLICA as ações da Separação que chegam pelo `/api/sincronizar`.
- Fase 1b: o coletor da Separação passa a mandar essas ações, com fila de envio para funcionar sem rede.
- Fase 1c: a Gestão acompanha em tempo real e vê os conflitos.

## Estrutura

```
db/migracoes/001_base.sql   todas as tabelas, comentadas (comece por aqui)
db/migracoes/002_...sql     mudanças depois da 001: 002 quantidade quebrada · 003 resultado de cada ação
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
src/rotas-api/              os endereços da API (validam a entrada e chamam as consultas)
src/tempo-real.js           canal SSE: avisa as telas conectadas na hora
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
| `POST /api/sincronizar` | sim | `{ acoes: [{ id, tipo, dados, feitaEm }] }` → `{ novas, repetidas, recusadas }` |
| `GET /api/tempo-real?token=...` | sim | canal SSE; evento `acoes` quando chegam ações |

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
- `conflito`: o pedido já está com outro separador. Nada é aplicado; o coordenador decide (tela na Fase 1c).
- `recusada`: ação inválida (item que não existe, quantidade errada, perfil que não é separador...).
- `desconhecida`: tipo que o servidor ainda não aplica. Fica guardada, sem mexer em nada.

As três últimas voltam em `recusadas: [{ id, resultado, motivo }]`. Todas as ações, mesmo as recusadas,
saem da fila do aparelho: elas já estão no servidor.

Ainda não fazem parte: baixar o saldo do picking no servidor e conferir se a Conferência já começou
antes de "separar novamente". Entram quando o Estoque e a Conferência passarem pelo servidor.
