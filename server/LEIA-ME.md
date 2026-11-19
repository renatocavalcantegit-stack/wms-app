# Servidor do WMS (Fase 1e)

API em Node.js (Fastify) com banco PostgreSQL, em SQL puro. O servidor também entrega as telas do app.
- Fase 1a: o servidor APLICA as ações da Separação que chegam pelo `/api/sincronizar`.
- Fase 1b: o coletor da Separação entra pelo servidor e manda as ações por uma fila de envio,
  que funciona sem rede (`js/dados/fila.js` e `js/sincronizacao.js`).
- Fase 1c: a Gestão ganha a aba **Ao vivo** (`gestao-ao-vivo.js`), com a separação de verdade:
  andamento dos pedidos, último contato de cada separador e as ações não aplicadas (conflitos).
  O coletor dá sinal de vida a cada 30 s (o "batimento"), mesmo sem ação nova.
- Fase 1d: a **lista do coletor vem do servidor** (`GET /api/separacao`).
  O coletor guarda uma cópia para trabalhar sem rede, e o que está na fila de envio nunca é apagado
  (regra em `compartilhado/regras/juntar-pedidos.js`).
- Fase 1e (esta, v58): o **quadro da Separação da Gestão vale de verdade** (`gestao-separacao-real.js`).
  O coordenador arrasta o pedido para a fila de um separador e o coletor dele mostra **só a fila dele**, na ordem do quadro.
  E o **login único**: separador, conferente e embarque ficam em um aparelho de cada vez; o coordenador desconecta
  o coletor perdido pela tela **Dispositivos** (menu do usuário, na Gestão).

As outras telas (Conferência, Estoque...) e os outros quadros da Gestão continuam com os dados só no aparelho,
como na demonstração; com o servidor, essas abas mostram o aviso **Simulação**.

## Estrutura

```
db/migracoes/001_base.sql   todas as tabelas, comentadas (comece por aqui)
db/migracoes/002_...sql     mudanças depois da 001: 002 quantidade quebrada · 003 resultado de cada ação
                            · 004 último contato do aparelho e "visto" das ações não aplicadas
                            · 005 fila do separador, rota e aguardando no pedido; aparelho e fim da sessão (login único)
                            · 006 passo do item da vez (a bolinha do item na gaveta da Gestão)
                            · 007 conferência: um registro por pedido (fila do conferente, volumes, observação) e o que foi contado
db/migrar.js                cria o banco e aplica os .sql de db/migracoes/ que ainda não rodaram
db/semear.js                apaga e carrega a demonstração (os mesmos js/demo-*.js do app). Pelo terminal, sem pedidos
                            na conferência (o teste operacional começa na Separação); os testes carregam também os já separados

src/banco.js                conexão com o PostgreSQL e transação
src/senha.js                PIN guardado com hash (scrypt), nunca o PIN
src/consultas/              TODO o SQL, separado por assunto
  sessoes.js                usuário, criar e encerrar sessão de turno, quem é o dono do token, Dispositivos
  produtos.js               produto pelo código de barras ou código interno
  pedidos.js                lista e detalhe dos pedidos da separação; a lista do coletor (com os itens)
  acoes.js                  grava as ações sincronizadas sem repetir e aplica cada uma
  aplicar-acoes.js          lê o pedido, pergunta à regra o que muda e grava
  aplicar-conferencia.js    o mesmo para as ações da Conferência; o pedido separado entrando na conferência
  conferencia.js            a lista do posto do conferente (pedido inteiro, com as partes e os itens separados)
  quadro-conferencia.js     o quadro da Conferência: caixa, filas dos conferentes, mover e pular conferência (Montagem)
  painel.js                 o painel Ao vivo da Gestão: pedidos, separadores e ações não aplicadas (em standby)
  quadro.js                 o quadro da Separação: caixa de entrada, fila de cada separador, rota e lotes
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

### Obrigatório antes da virada para a produção: HTTPS

Em `http://192.168.1.50:3000` o Chrome **não** trata o WMS como app seguro:
- não oferece "Instalar app" nem abre em tela cheia (o `standalone` do manifest é ignorado);
- o **service worker não funciona**: se a página recarregar sem Wi-Fi, o coletor mostra o "sem internet" do Chrome
  (a fila de envio fica guardada no aparelho e não se perde, mas o operador espera a rede voltar).

Plano combinado: um endereço `https://wms.renatoflow.com.br` (nome a confirmar) apontando para o IP fixo do servidor,
DNS na **Cloudflare** com o registro "DNS only" (nuvem cinza), certificado gratuito do Let's Encrypt validado por DNS
(o servidor não fica aberto para a internet) e renovação automática com um token da Cloudflare que só edita o DNS
dessa zona (o token fica só no servidor, nunca no chat nem no GitHub). Conferir na instalação se o roteador bloqueia
nome público apontando para IP interno ("DNS rebinding").

Enquanto isso, nos testes: não recarregar a página sem rede. Para testar "abrir o app sem rede" em um coletor,
dá para ligar em `chrome://flags` a opção "Insecure origins treated as secure" com `http://192.168.1.50:3000`.

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
| `POST /api/login` | não | `{ login, pin, aparelho? }` → `{ token, expiraEm, login, nome, perfil }`. **409** se a pessoa (separador, conferente, embarque) já está conectada em outro aparelho |
| `POST /api/logout` | sim | encerra a sessão deste aparelho (o Sair do app) |
| `GET /api/produtos/:codigo` | sim | produto pelo código de barras ou código interno, com embalagens e endereços com saldo |
| `GET /api/pedidos?setor=exp` | sim | pedidos do setor (`exp` ou `mont`), opcional `&status=pendente` |
| `GET /api/pedidos/:id` | sim | pedido com os itens na ordem de separação e os códigos de barras |
| `GET /api/separacao?setor=exp` | sim | a lista do coletor: `{ agora, pedidos }`, **só a fila de quem pediu** (na ordem do quadro), o que ele está separando e o que concluiu hoje, cada um com os itens, `separador_nome`, `doca_id` e `ordem_fila` |
| `GET /api/conferencia?setor=exp` | sim | a lista do posto: `{ agora, pedidos }`, **só a fila do conferente** (na ordem do quadro), o que ele está conferindo e o que conferiu hoje; cada pedido com cliente, rota, separador, doca (ou as partes, cada uma com a doca), os itens separados e as contagens |
| `POST /api/sincronizar` | sim | `{ acoes: [{ id, tipo, dados, feitaEm }], pendentes? }` → `{ novas, repetidas, recusadas }`. Com `acoes: []` é o batimento: só grava o último contato. `pendentes`: quanto o aparelho tem na fila (a tela de Dispositivos mostra). `passo?` = `{ passo: 1 ou 2, itens: [{ pedido, sequencia }] }`: o item da vez com o endereço lido (1) ou o produto bipado (2); só para a Gestão acompanhar, não é ação |
| `GET /api/tempo-real?token=...` | sim | canal SSE; eventos `acoes` (chegaram ações), `contato` (batimento de um coletor), `painel` (uma ação foi marcada como vista), `quadro` (o quadro mudou) e `dispositivos` (um aparelho entrou ou saiu) |
| `GET /api/quadro/separacao?setor=exp` | coordenador do setor | `{ agora, pedidos, separadores }`: o que ainda não foi separado (caixa de entrada e filas, com o andamento) e todos os separadores, com o contato e quantos separaram hoje |
| `POST /api/quadro/mover` | coordenador do setor | `{ setor, unidade, para, ordem }`: muda o pedido (ou o lote inteiro) de fila. `para` = login, `null` = caixa de entrada; `ordem` = a coluna de destino depois de soltar. **409** em separação ou sem rota |
| `POST /api/quadro/rota` | coordenador do setor | `{ setor, pedido, rota }`: define a rota do pedido que chegou sem rota |
| `POST /api/quadro/lotes` | coordenador do setor | `{ setor, pedidos }` → `{ id, posicoes }`: agrupa pedidos da caixa num lote |
| `POST /api/quadro/lotes/:id/desfazer` | coordenador do setor | `{ setor }`: desfaz o lote que ainda não começou |
| `GET /api/quadro/conferencia?setor=exp` | coordenador do setor | `{ agora, pedidos, conferentes }`: o que ainda não foi conferido (caixa e filas, com o `andamento`: itens e unidades conferidos) e todos os conferentes, com o contato e quantos conferiram hoje. Na Montagem, também os entregues à montagem hoje |
| `POST /api/quadro/conferencia/mover` | coordenador do setor | `{ setor, pedido, para, ordem }`: muda o pedido de fila (`para` = login do conferente, `null` = caixa). **409** em conferência |
| `POST /api/quadro/conferencia/pular` | coordenador da Montagem | `{ setor: "mont", pedidos }` → `{ feitos, erros }`: dispensa a conferência (status `dispensada`); o pedido vai direto para a montagem |
| `GET /api/dispositivos` | coordenador | `{ agora, esta, dispositivos }`: os aparelhos conectados (o token nunca sai do servidor) |
| `POST /api/dispositivos/:id/desconectar` | coordenador | encerra a sessão do aparelho (coletor perdido ou quebrado) |
| `GET /api/painel/separacao?setor=exp` | coordenador | `{ agora, pedidos, separadores, naoAplicadas }` para a aba Ao vivo |
| `POST /api/painel/nao-aplicadas/:id/vista` | coordenador | marca a ação não aplicada como vista (sai da lista); 404 se não existe ou já foi vista |
| `GET /modo.json` | não | `{ servidor: true }`: diz ao app que ele está sendo servido pelo servidor |
| `GET /` e os arquivos do app | não | as telas (index.html, js/, compartilhado/, assets/, vendor/...) |

Login: mande o token no cabeçalho `Authorization: Bearer <token>`.
A sessão vale 14 horas (um turno), até a pessoa sair ou o coordenador desconectar. Sessão encerrada responde
**401** com o motivo: `{ erro, motivo }`, onde `motivo` é `coordenador` (desconectado pela Gestão), `saiu` ou `novo-login`.

## Sincronização: o que acontece com cada ação

Cada ação tem um ID criado no aparelho. Se o aparelho reenviar o lote porque a rede caiu antes da resposta,
a ação não é gravada nem aplicada de novo, e a resposta repete o resultado da primeira vez.

As ações são aplicadas na ordem em que foram **feitas** no aparelho (`feitaEm`), não na ordem em que chegaram.

| Tipo | `dados` | O que muda |
|---|---|---|
| `separacao.iniciar` | `{ pedido, lote?, posicao? }` | pedido fica `andamento`, com o login de quem começou e a hora |
| `separacao.item` | `{ pedido, sequencia, qtdSeparada, status, motivo? }` | `status` = `ok` (completo) ou `falta` (com motivo); a quantidade pode ser quebrada |
| `separacao.concluir` | `{ pedido, doca }` | pedido fica `concluido`, com a doca e a hora do fim |
| `separacao.reabrir` | `{ pedido }` | separar novamente: volta para `andamento` com os itens zerados. **Recusada** se a conferência já começou ("SENDO CONFERIDO"); se ninguém começou, o pedido sai da conferência |
| `conferencia.iniciar` | `{ pedido }` | "Iniciar conferência" no posto: fica `andamento`, com o conferente e a hora. Só da fila de quem iniciou |
| `conferencia.contagem` | `{ pedido, produto, qtd }` | quanto foi contado do produto (o valor atual, não a soma). Produto que não é do pedido fica marcado como "fora" |
| `conferencia.finalizar` | `{ pedido, volumes, observacao, posto, contagens }` | `contagens` = tudo o que foi contado. O **servidor** decide: `conferido` ou `divergente` (falta, excesso ou produto fora). Expedição precisa de volumes (1 ou mais) e da observação; Montagem não |
| `conferencia.volumes` | `{ pedido, volumes, observacao }` | corrigir os volumes de um pedido conferido |
| `conferencia.reabrir` | `{ pedido }` | "Conferir novamente": volta para `andamento` com as contagens zeradas |

Resultado de cada ação (coluna `resultado` em `acoes_recebidas`):
- `aplicada`: mudou o pedido.
- `conflito`: o pedido já está com outro separador. Nada é aplicado; o coordenador vê na aba Ao vivo,
  resolve com o separador e marca como visto (fica gravado quem viu e quando).
- `recusada`: ação inválida (item que não existe, quantidade errada, perfil que não é separador...).
  Desde a Fase 1e, também quando o pedido **não está mais na fila** de quem mandou: o coordenador passou para outra
  pessoa ("O COORDENADOR PASSOU O PV-xxxx PARA OUTRA PESSOA.") ou devolveu para a caixa de entrada
  ("O COORDENADOR TIROU O PV-xxxx DA SUA FILA."), enquanto o coletor estava sem rede. O coletor avisa e volta para a lista.
- `desconhecida`: tipo que o servidor ainda não aplica. Fica guardada, sem mexer em nada.

As três últimas voltam em `recusadas: [{ id, resultado, motivo }]`. Todas as ações, mesmo as recusadas,
saem da fila do aparelho: elas já estão no servidor.

Ainda não faz parte: baixar o saldo do picking no servidor (entra quando o Estoque passar pelo servidor).

## Aba Ao vivo da Gestão (Fase 1c) · em standby

**Em standby desde a v53 (18/11/2026).** As abas da demonstração (Separação, Conferência…) vão passar a funcionar
com o servidor e substituem esta aba. Ela fica escondida e só aparece com `?aovivo` no endereço
(http://localhost:3000/gestao.html?aovivo), para algum teste específico.
**Retirar no fim do projeto:** `gestao-ao-vivo.js`, `js/dados/painel.js`, `compartilhado/regras/painel.js`, o botão
`#tabVivo` (gestao.html e montagem.html), os estilos `vivo-*` do gestao.css e os testes dela. A rota `/api/painel`
e o canal de tempo real podem continuar, se as abas reais usarem.

Abra http://localhost:3000/gestao.html?aovivo, entre como coordenador e clique em **Ao vivo**. A aba relê o painel sempre que
o canal de tempo real avisa (e, por garantia, a cada minuto). O "há X min" é calculado com a hora do servidor.

Situação de cada separador (regra em `compartilhado/regras/painel.js`):

| Situação | Quando |
|---|---|
| Separando | tem pedido em andamento e o coletor deu sinal nos últimos 90 s |
| Livre | sem pedido em andamento, com sinal nos últimos 90 s |
| Sem contato | o coletor não dá sinal há mais de 90 s (três batimentos perdidos): sem rede, desligado ou com o app fechado |
| Não entrou no turno | nunca entrou com o servidor, ou o último contato tem mais de 14 h |

Com o coletor sem rede, as ações continuam na fila do aparelho: a Gestão só vê o andamento quando a rede volta.

## Lista do coletor (Fase 1d)

O coletor baixa a lista ao entrar no setor, a cada 30 s com a lista na tela, quando a rede volta e logo depois
de enviar ações. Nunca enquanto o separador está dentro de um pedido. No menu, com servidor,
"Atualizar a lista do servidor" baixa na hora.

Pedido por pedido, o que vale (`compartilhado/regras/juntar-pedidos.js`):

| Situação | Fica |
|---|---|
| tem ação na fila do aparelho (ainda não chegou ao servidor) | a versão do aparelho |
| sem ação na fila | a do servidor, com o andamento de tela do aparelho (item em que parou, endereço e produto confirmados) |
| existe só no aparelho, sem ação na fila | sai da lista |

Os lotes saem dos próprios pedidos (`lote` e `posicao_lote`). O código do lote montado no coletor é único entre
aparelhos (ex.: `L-K3F9`), porque o servidor junta os pedidos pelo código.
Continuam só no aparelho: baixa de estoque e Ocorrências (corte e cancelamento). A Conferência passa pelo servidor desde a v65.

## Conferência (Fase 2)

Quando a separação termina (`separacao.concluir`), o pedido entra sozinho na **caixa de entrada da conferência**
(tabela `conferencias`, sem conferente). Pedido dividido entre separadores entra **uma vez só**, quando todas as partes
terminaram: o pedido original (ex.: PV-10426), com os itens de todas as partes e a doca de cada uma.

O posto (`conferencia.html`) mostra só a **fila do conferente** (o que o coordenador mandou para ele, na ordem do quadro).
Clicar no pedido (ou bipar) abre o resumo "Iniciar conferência"; Enter começa. Cada leitura conta na hora no posto e vai
pela mesma fila de envio da Separação, ~1 s depois (o valor contado de cada produto). Sem rede, o posto segue conferindo
e manda tudo quando a rede volta. A lista é baixada ao voltar para a fila, a cada 30 s e quando a rede volta
(`juntarConferencia` em `compartilhado/regras/juntar-pedidos.js`: pedido com ação na fila fica como está no posto).
O que muda com cada ação é decidido por `compartilhado/regras/acoes-conferencia.js`.

Ainda só no posto: devolução de corte/cancelamento (F9) e o envio da observação dos volumes ao Sankhya.
Na Gestão (v67), a aba **Conferência** é o quadro de verdade (`gestao-conferencia-real.js`, regras em
`compartilhado/regras/fila-do-conferente.js`): arrastar para a fila do conferente, ao vivo o que ele já conferiu,
e na Montagem "Pular conferência" (status `dispensada`). Travas no servidor: em conferência não muda de fila;
conferido ou dispensado não volta. O posto que estava com um pedido dispensado é avisado
("O COORDENADOR DISPENSOU A CONFERÊNCIA DO …") e volta para a fila.
O coletor que mandou "separar novamente" de um pedido que já está sendo conferido recebe a recusa e volta para a lista.
Para testar dois postos, a demonstração tem um segundo conferente (`conferente2`, PIN em `js/sessao.js`).

## Quadro da Separação e fila do separador (Fase 1e)

Com o app aberto pelo servidor, a aba **Separação** da Gestão é o quadro de verdade (`gestao-separacao-real.js`,
dados em `js/dados/quadro.js`, regras em `compartilhado/regras/fila-do-separador.js`). É o mesmo quadro da demonstração:

- arrastar da caixa de entrada para um separador, de um para outro, de volta para a caixa, ou mudar a ordem da fila;
- pedido **sem rota**: o quadro pede a rota antes de mandar para um separador (o aguardando não tem rota e vai direto);
- marcar pedidos da caixa e **agrupar em lote**; o lote anda inteiro; "Desfazer lote" antes de começar;
- clicar no card abre a mesma gaveta lateral da demonstração: andamento ao vivo, itens, rota, histórico e
  "Mover para…" (outro separador ou a caixa de entrada); no lote, os pedidos, as paradas e "Desfazer lote".
  O que o servidor ainda não tem (vendedor, embarque, carga, volumes, nota fiscal) aparece com "—" até a integração;
- cada coluna mostra a situação do separador: Separando, Aguardando início, Livre, **Sem contato** (o coletor não dá sinal
  há mais de 90 s) ou Não conectado.

Travas (no servidor, `src/consultas/quadro.js`): pedido em separação não muda de fila; sem rota não vai para separador;
só pedido da caixa entra em lote. Cada mudança avisa as outras Gestões abertas pelo canal de tempo real.
O coletor do separador baixa a fila nova a cada 30 s, ao voltar para a lista ou em "Atualizar a lista do servidor".

Ainda só na demonstração: dividir pedido, sugerir lotes e a distribuição inteligente (pós-MVP, rodando no servidor).

## Login único e Dispositivos (Fase 1e)

O separador, o conferente e o embarque ficam conectados em **um aparelho de cada vez** (regra em
`compartilhado/regras/login-unico.js`). Cada aparelho cria o seu código na primeira vez (`wms-bb-aparelho`, no
navegador) e manda no login. No mesmo aparelho a pessoa pode entrar de novo; em outro, o login é recusado:
"Você já está conectado em outro aparelho (desde 07:42, último contato há 3 min). Saia por lá ou peça ao coordenador
para desconectar." O coletor que já estava conectado **não cai**. Coordenadores e estoque podem estar em vários aparelhos.

**Sair** (`js/sair.js`) avisa o servidor. Antes, manda o que estiver na fila; se ainda sobrar, pergunta (as ações ficam
no aparelho e vão quando alguém entrar de novo nele). Sem rede, não sai: o servidor continuaria achando que a pessoa
está ali.

Coletor perdido, quebrado ou sem bateria: o coordenador abre o menu do usuário (o círculo com as iniciais) →
**Dispositivos** → **Desconectar**. A lista mostra quem está conectado, desde quando, o último contato e quantas ações
o aparelho ainda não tinha enviado. O aparelho desconectado volta para o login no próximo contato, com o aviso
"O coordenador desconectou este aparelho", e guarda a fila dele.

Para testar dois coletores, a demonstração tem um segundo separador (`separador2`, PIN em `js/sessao.js`).
