# Servidor do WMS (Fase 0)

API em Node.js (Fastify) com banco PostgreSQL, em SQL puro.
Nesta fase o app ainda não usa o servidor: ele continua com os dados no aparelho.
A Fase 1 liga a Separação ao servidor, com fila de sincronização para funcionar sem rede.

## Estrutura

```
db/migracoes/001_base.sql   todas as tabelas, comentadas (comece por aqui)
db/migrar.js                cria o banco e aplica os .sql de db/migracoes/ que ainda não rodaram
db/semear.js                apaga e carrega a demonstração (os mesmos js/demo-*.js do app)

src/banco.js                conexão com o PostgreSQL e transação
src/senha.js                PIN guardado com hash (scrypt), nunca o PIN
src/consultas/              TODO o SQL, separado por assunto
  sessoes.js                usuário, criar sessão de turno, quem é o dono do token
  produtos.js               produto pelo código de barras ou código interno
  pedidos.js                lista e detalhe dos pedidos da separação
  acoes.js                  grava as ações sincronizadas sem repetir
src/rotas-api/              os endereços da API (validam a entrada e chamam as consultas)
src/tempo-real.js           canal SSE: avisa as telas conectadas na hora
src/servidor.js             junta tudo e faz o controle de login
src/iniciar.js              liga o servidor

testes/                     testes contra um banco SÓ de teste (wms_teste), recriado a cada execução
```

## Ordem sugerida para ler

1. `db/migracoes/001_base.sql`: o que o sistema guarda.
2. `src/consultas/`: como lê e grava (cada função é um ou dois SQL comentados).
3. `src/rotas-api/`: o que a API recebe e devolve.
4. `src/servidor.js`: como o login protege as rotas.
5. `testes/api.test.js`: exemplos de uso de cada rota.

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
| `POST /api/sincronizar` | sim | `{ acoes: [{ id, tipo, dados, feitaEm }] }` → `{ novas, repetidas }` |
| `GET /api/tempo-real?token=...` | sim | canal SSE; evento `acoes` quando chegam ações |

Login: mande o token no cabeçalho `Authorization: Bearer <token>`.
A sessão vale 14 horas (um turno).

Na Fase 0 o `/api/sincronizar` só **registra** as ações em `acoes_recebidas`. Cada ação tem um ID criado no aparelho:
se o aparelho reenviar o lote porque a rede caiu antes da resposta, a ação não é gravada de novo.
**Aplicar** as ações (baixar saldo, concluir o pedido) é a Fase 1.
