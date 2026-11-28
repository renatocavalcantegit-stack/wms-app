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
                            · 008 ocorrências do pedido (corte e cancelamento) e devoluções ao estoque (entradas pendentes)
                            · 009 entrega da devolução do pedido cancelado (a_entregar → pendente; quem e quando entregou)
                            · 010 observação do pedido (o texto do vendedor no Sankhya e quem leu: observacao_ciencias)
                            · 011 notas de entrada (notas, recebimentos, volumes e o histórico de movimentos do estoque)
                            · 012 produto novo pela nota (de qual nota o produto veio, avisos da nota, número das embalagens)
                            · 013 conferência da nota no coletor (a ação da fila de cada recebimento, índices)
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
  ocorrencias.js            corte de item e cancelamento do pedido (aba Ocorrências da Gestão)
  devolucoes.js             a devolução ao estoque: entrada pendente "DEV PV-…" com o que saiu da caixa
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

## Colocar em produção (PC dedicado da empresa)

Checklist para o dia em que o servidor sai do `npm run dev` e passa a rodar o tempo todo em um PC da empresa.
Cada item diz **o que fazer** e **por quê**. Marque `[x]` conforme for fazendo.

O que torna tudo isso menos tenso: os coletores trabalham **sem rede** (fila de envio). Se o servidor reiniciar
por alguns segundos ou cair por alguns minutos, a separação e a conferência continuam, e as ações chegam quando
ele voltar. Ainda assim, o objetivo é que ele **volte sozinho**, sem ninguém precisar lembrar de ligar.

### 1. O PC

- [ ] **SSD** (não HD). Banco de dados vive de ler e gravar no disco; HD é o gargalo mais comum depois do Wi-Fi.
- [ ] **16 GB de memória** (8 GB funciona). O PostgreSQL usa a memória livre como cache.
- [ ] Processador: qualquer i5/Ryzen 5 dos últimos anos sobra para dezenas de coletores.
- [ ] **Nobreak**. Queda de energia é a causa nº 1 de servidor fora do ar em empresa pequena.
- [ ] Na BIOS, **ligar sozinho quando a energia voltar** (opção com nome parecido com "Restore on AC Power Loss" → *Power On*).
- [ ] No Windows, **nunca suspender nem hibernar** (Configurações → Sistema → Energia: "Nunca").
- [ ] **Windows Update fora do expediente** ("Horário ativo" cobrindo o turno do galpão), para não reiniciar no meio do dia.
- [ ] **Cabo de rede** no servidor (não Wi-Fi) e **IP fixo** (os coletores procuram sempre o mesmo endereço).
  O ideal é reservar o IP no roteador (reserva DHCP), para não haver dois aparelhos com o mesmo número.
- [ ] PC **dedicado de verdade**: ninguém usa para navegar, e-mail ou planilha; fica em lugar com acesso restrito.

### 2. O servidor liga sozinho (serviço do Windows)

Hoje o servidor depende de uma janela aberta com `npm run dev`. Se alguém fechar a janela, fizer logoff ou o PC
reiniciar, ele cai. Um **serviço do Windows** liga junto com o PC (antes de qualquer login) e é religado se o
processo morrer. O PostgreSQL já roda assim; o Node precisa ser igual.

- [ ] Instalar o **NSSM** (nssm.cc), uma ferramenta que transforma um comando em serviço.
- [ ] Criar o serviço `wms` rodando `npm run iniciar` dentro de `server/` (o `iniciar`, não o `dev`: o `dev`
  reinicia a cada arquivo salvo, o que só serve para programar).
- [ ] Em *Exit actions*, **Restart** (religar se o processo cair). Em *I/O*, mandar a saída para um arquivo de log
  (ex.: `C:\wms-logs\servidor.log`) com rotação ligada, para o arquivo não crescer para sempre.
- [ ] Tipo de inicialização: **Automático**. Testar: reiniciar o PC sem fazer login e abrir `/api/saude` em outro aparelho.
- [ ] Testar a queda: no Gerenciador de Tarefas, encerrar o processo `node.exe` e conferir que ele volta em segundos.

Ao parar o serviço, o NSSM manda um Ctrl+C para o Node; o `src/iniciar.js` já trata isso e fecha as conexões
com o banco antes de sair.

**Quando reiniciar o Node?** Só para publicar uma versão nova. Um servidor Node não "cansa": ele roda meses sem
parar. Se for preciso reiniciar com frequência para ele voltar ao normal (memória subindo sem parar, por exemplo),
isso é um bug a investigar no log, não uma rotina.

### 3. Backup (o item mais importante desta lista)

Disco morre, Windows corrompe, vírus criptografa. Sem backup, o estoque e o histórico somem junto.

- [ ] Um `pg_dump` **todo dia**, fora do expediente, pelo **Agendador de Tarefas** do Windows. Exemplo:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc -f "D:\backup-wms\wms-$(Get-Date -Format yyyy-MM-dd).dump" wms
```

  (`-Fc` é o formato compacto do próprio PostgreSQL. A senha fica no arquivo `pgpass.conf` do usuário que roda
  a tarefa, nunca escrita no comando.)
- [ ] **Cópia fora daquele PC**: outro computador, nuvem ou HD externo que não fica sempre conectado.
  Backup no mesmo disco não protege contra disco queimado nem contra vírus.
- [ ] Apagar os backups mais antigos que N dias (ex.: guardar 30), para o disco não encher.
- [ ] **Testar a restauração** pelo menos uma vez, e depois de tempos em tempos: restaurar o arquivo no banco
  `wms_teste` e abrir o app apontando para ele. Backup que nunca foi restaurado não é backup, é esperança.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres --clean --if-exists -d wms_teste "D:\backup-wms\wms-AAAA-MM-DD.dump"
```

### 4. Segurança

- [ ] **HTTPS** (seção acima, "Obrigatório antes da virada").
- [ ] **Nada aberto para a internet.** O servidor só é alcançado pela rede interna. Não criar redirecionamento
  de porta no roteador. (O `host: "0.0.0.0"` do `src/iniciar.js` quer dizer "toda a rede local", o que é certo
  para os coletores; quem fecha a porta para fora é o roteador.)
- [ ] **Firewall do Windows**: liberar só a porta do WMS, e só no perfil de rede "Privada"/do domínio.
- [ ] **PostgreSQL só para o próprio PC**: no `postgresql.conf`, `listen_addresses = 'localhost'`. Só o Node conversa
  com o banco, e ele está na mesma máquina. (Mudanças no `postgresql.conf` e no `pg_hba.conf`: fazer passo a passo,
  com backup do arquivo antes.)
- [ ] **Usuário do banco só para o WMS**: o `.env` de produção usa um usuário que lê e grava as tabelas do `wms`,
  e não o `postgres` (que pode tudo, inclusive apagar bancos). Se um dia houver uma falha no app, o estrago fica limitado.
  As migrações continuam rodando com o `postgres`.
- [ ] **`.env` com senha forte**, fora do git (já está no `.gitignore`), e só no PC do servidor.
- [ ] Atualizações do Windows e do Node em dia (versão LTS do Node), aplicadas fora do expediente.

### 5. Se ficar lento: medir antes de mexer

Para o volume de um galpão (dezenas de coletores, algumas dezenas de pedidos por segundo nos picos), o Fastify
e o PostgreSQL têm folga de sobra. O Node atende vários coletores ao mesmo tempo porque, enquanto espera o banco
responder a um, atende o próximo (o "event loop"); o banco recebe até 10 consultas ao mesmo tempo pelo pool
(`src/banco.js`) e as outras esperam milissegundos na fila.

Quando alguém disser "está lento", investigar nesta ordem:

1. **Wi-Fi do galpão.** O log do servidor mostra o tempo de cada resposta (`responseTime`). Se o log diz 20 ms e
   o coletor sente 3 segundos, o problema está no caminho (rádio, access point longe), não no servidor.
2. **Uma consulta específica lenta.** Achar no log qual rota demora e rodar o SQL dela com `EXPLAIN ANALYZE` no
   PostgreSQL. Se aparecer "Seq Scan" em tabela grande, falta um índice (que entra por uma migração nova).
3. **O PC.** Gerenciador de Tarefas: disco em 100% (HD em vez de SSD?), memória cheia, outro programa pesado rodando.

Problemas de **duas pessoas mexendo na mesma coisa ao mesmo tempo** não são de velocidade, são de correção, e quem
resolve é o banco: as transações (`emTransacao` em `src/banco.js`) e as regras gravadas nas tabelas (`CHECK`,
`UNIQUE`, `FOR UPDATE`). Regra de negócio que não pode ser quebrada mora no banco, não só no JavaScript.

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
| `GET /api/tempo-real?token=...` | sim | canal SSE; eventos `acoes` (chegaram ações), `contato` (batimento de um coletor), `painel` (uma ação foi marcada como vista), `quadro` (o quadro mudou), `estoque` (uma nota de entrada mudou) e `dispositivos` (um aparelho entrou ou saiu) |
| `GET /api/quadro/separacao?setor=exp` | coordenador do setor | `{ agora, pedidos, separadores }`: o que ainda não foi separado (caixa de entrada e filas, com o andamento) e todos os separadores, com o contato e quantos separaram hoje |
| `POST /api/quadro/mover` | coordenador do setor | `{ setor, unidade, para, ordem }`: muda o pedido (ou o lote inteiro) de fila. `para` = login, `null` = caixa de entrada; `ordem` = a coluna de destino depois de soltar. **409** em separação ou sem rota |
| `POST /api/quadro/rota` | coordenador do setor | `{ setor, pedido, rota }`: define a rota do pedido que chegou sem rota |
| `POST /api/quadro/lotes` | coordenador do setor | `{ setor, pedidos }` → `{ id, posicoes }`: agrupa pedidos da caixa num lote |
| `POST /api/quadro/lotes/:id/desfazer` | coordenador do setor | `{ setor }`: desfaz o lote que ainda não começou |
| `GET /api/quadro/conferencia?setor=exp` | coordenador do setor | `{ agora, pedidos, conferentes }`: o que ainda não foi conferido (caixa e filas, com o `andamento`: itens e unidades conferidos) e todos os conferentes, com o contato e quantos conferiram hoje. Na Montagem, também os entregues à montagem hoje |
| `POST /api/quadro/conferencia/mover` | coordenador do setor | `{ setor, pedido, para, ordem }`: muda o pedido de fila (`para` = login do conferente, `null` = caixa). **409** em conferência |
| `POST /api/quadro/conferencia/pular` | coordenador da Montagem | `{ setor: "mont", pedidos }` → `{ feitos, erros }`: dispensa a conferência (status `dispensada`); o pedido vai direto para a montagem |
| `GET /api/ocorrencias?setor=exp` | coordenador do setor | `{ ocorrencias }`: o histórico do setor, mais novas primeiro (até 200) |
| `GET /api/ocorrencias/pedido?setor=exp&pedido=PV-…` | coordenador do setor | `{ pedido }`: etapa, itens (pedido, na caixa, a devolver) e quem está com ele. **404** não existe |
| `POST /api/ocorrencias` | coordenador do setor | `{ setor, pedido, tipo: "corte" ou "cancelamento", cortes: { produto: novaQtd }, motivo, referencia }` → `{ ocorrencia, pedido }`. **409** quando a etapa não deixa (ex.: já embarcado), **400** sem motivo/referência ou corte inválido |
| `GET /api/dispositivos` | coordenador | `{ agora, esta, dispositivos }`: os aparelhos conectados (o token nunca sai do servidor) |
| `POST /api/dispositivos/:id/desconectar` | coordenador | encerra a sessão do aparelho (coletor perdido ou quebrado) |
| `GET /api/painel/separacao?setor=exp` | coordenador | `{ agora, pedidos, separadores, naoAplicadas }` para a aba Ao vivo |
| `POST /api/painel/nao-aplicadas/:id/vista` | coordenador | marca a ação não aplicada como vista (sai da lista); 404 se não existe ou já foi vista |
| `GET /api/estoque/notas` | gestor de estoque | `?nf=&fornecedor=&de=&ate=&conferencia=&divergencia=&armazenamento=&pagina=1&porPagina=20` → `{ notas, total, pagina, porPagina, contagens }`: a lista da aba Entrada, **filtrada e paginada no banco** (`porPagina` = 10, 20, 30 ou 50); `contagens` são os indicadores do topo |
| `GET /api/estoque/notas/:id` | gestor de estoque | `{ nota, conferencias, volumes, produtos, docas, recusas }`: o detalhe da nota (para a tela e a reimpressão das etiquetas). Cada conferência traz `usuario` (quem conferiu); `recusas` = o que o coletor mandou e o servidor não aplicou (v78). **404** não existe |
| `POST /api/estoque/notas/:id/cancelar-pendente` | gestor de estoque | `{ produto }` → `{ status }`: o pendente de armazenar vira cancelado (o saldo continua na doca); grava quem e quando. **409** se não havia pendente |
| `POST /api/estoque/notas/importar` | gestor de estoque | "Buscar notas do ERP" → `{ importadas, bloqueadas }`. **Simulado** até o Sankhya ser ligado (as notas de exemplo da demonstração); a nota repetida é bloqueada. Cada importada traz `produtosNovos` (cadastrados pela nota) e `avisos` |
| `GET /api/recepcao/notas` | estoquista | (v78) `{ notas, conferencias, produtos, embalagens, docas }`: o que o coletor baixa para conferir sem rede. Só as notas **em aberto** (até 300, as mais recentes), os produtos e as embalagens dos itens delas e as docas (de recebimento e de devolução). Cada conferência traz `acaoId` (a ação da fila que a criou) |
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
| `recepcao.conferir` | `{ nota, rotulo, produto, qtd, doca, volumes, dia }` | (v78) uma confirmação da conferência da nota no coletor do estoquista. `volumes` = os códigos que o coletor já imprimiu; **vazio** na conferência por produto (v79). Soma ao conferido, grava o recebimento e os volumes, **põe o saldo na doca e grava o movimento `recebimento`** na mesma transação e recalcula os status da nota. **Recusada** (inteira) se a nota não existe ou foi finalizada, o produto não é da nota, o endereço não é doca, a quantidade passa do pendente (outro coletor conferiu antes) ou um código de volume já existe |
| `recepcao.finalizar` | `{ nota, rotulo }` | (v78) "Finalizar nota": não recebe mais conferências e não reabre; grava quem e quando. Repetida, não muda nada. Nota de devolução: a devolução passa a `recebida` |
| `observacao.ciente` | `{ pedido, momento, resposta }` | (v76) quem leu a observação do pedido: `momento` = `inicio` (resposta `li`) ou `fim` (`apliquei` ou `nao_era`). O papel vem do perfil (separador, conferente, embarque). Grava em `observacao_ciencias` no pedido original (a parte do dividido fica na coluna `parte`); respondeu de novo, vale a última. **Recusada** se o pedido não tem observação ou a resposta não combina com o momento |

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
(tabela `conferencias`, sem conferente). Pedido dividido entre separadores (v72) entra **uma vez só**, já com a
**primeira parte que terminar** (qualquer uma: a 2/2 pode chegar antes da 1/2): o pedido original (ex.: PV-10426).
A lista manda cada parte com `pronta` e os itens da parte ainda em separação com `em_separacao: true` (o posto mostra
apagado e não deixa bipar). O conferente confere o que chegou e pode voltar à fila; quando a outra parte termina, os
itens dela aparecem na mesma conferência. **Finalizar com parte em separação é recusado**
("A PARTE 1/2 DO PV-10426 AINDA ESTÁ EM SEPARAÇÃO."). Separar de novo uma parte tira o pedido da conferência só se
ninguém começou a conferir e nenhuma outra parte continua pronta.

O posto (`conferencia.html`) mostra só a **fila do conferente** (o que o coordenador mandou para ele, na ordem do quadro).
Clicar no pedido (ou bipar) abre o resumo "Iniciar conferência"; Enter começa. Cada leitura conta na hora no posto e vai
pela mesma fila de envio da Separação, ~1 s depois (o valor contado de cada produto). Sem rede, o posto segue conferindo
e manda tudo quando a rede volta. A lista é baixada ao voltar para a fila, a cada 30 s e quando a rede volta
(`juntarConferencia` em `compartilhado/regras/juntar-pedidos.js`: pedido com ação na fila fica como está no posto).
O que muda com cada ação é decidido por `compartilhado/regras/acoes-conferencia.js`.

Ainda só no posto: o envio da observação dos volumes ao Sankhya.
Na Gestão (v67), a aba **Conferência** é o quadro de verdade (`gestao-conferencia-real.js`, regras em
`compartilhado/regras/fila-do-conferente.js`): arrastar para a fila do conferente, ao vivo o que ele já conferiu,
e na Montagem "Pular conferência" (status `dispensada`). Travas no servidor: em conferência não muda de fila;
conferido ou dispensado não volta. O posto que estava com um pedido dispensado é avisado
("O COORDENADOR DISPENSOU A CONFERÊNCIA DO …") e volta para a fila.
O coletor que mandou "separar novamente" de um pedido que já está sendo conferido recebe a recusa e volta para a lista.
Para testar dois postos, a demonstração tem um segundo conferente (`conferente2`, PIN em `js/sessao.js`).

## Estoque no servidor · entrega A: notas de entrada (v77)

Plano aprovado em 25/11/2026, por etapas: **A** notas de entrada (esta), **B** conferência no coletor pela fila,
**C** armazenamento e consulta de saldo (com Wi-Fi). Movimentação, inventário e cadastro de endereços ainda não estão
no servidor: na Gestão de Estoque, essas abas mostram o aviso "Ainda não está no servidor".

- **Tabelas (migração `011`)**: `notas_entrada` e `notas_entrada_itens` (Compra do ERP ou Devolução), `recebimentos`
  (cada confirmação do coletor: soma ao conferido e põe o saldo na doca), `volumes_recebimento` (as etiquetas) e
  `movimentos` (o extrato do estoque).
- **Devolução vira nota**: quando a devolução fica `pendente` (entregue ao estoque), `consultas/devolucoes.js` cria a
  nota do tipo Devolução na mesma transação. Entregar duas vezes não duplica (`devolucao_id` é único).
- **Lista rápida com muitas notas**: os três status da nota (conferência, divergência, armazenamento) ficam gravados
  em `notas_entrada` e são recalculados pela regra `statusDaNota` (`compartilhado/regras/recebimento.js`) a cada
  mudança. Assim a lista filtra e pagina no banco, sem ler todas as notas.
- **Histórico de movimentos (guardado para sempre)**: toda mudança de saldo grava um movimento **na mesma
  transação**. O saldo que existia quando o histórico começou entra como `saldo_inicial` (a migração `011` e o
  `npm run semear` fazem isso). `saldosForaDoHistorico(pool)` (`consultas/notas-entrada.js`) confere se cada saldo é
  igual à soma dos movimentos e devolve as diferenças; os testes rodam essa conferência.
- **Produto novo nasce da nota (migração `012`)**: a nota do ERP traz, em cada item, o cadastro do produto
  (`cadastro`: descrição, unidade, embalagens com código de barras, grupo, pesos...). Na importação, o produto que o
  WMS não tem é cadastrado na mesma transação (`produtos.cadastrado_por_nota` e `cadastrado_em`), com **checkout
  ligado**; o que já existe **não muda**. Código de barras que já é de outro produto: a nota entra, o produto fica sem
  esse código e o aviso vai para `notas_entrada.avisos` (aparece no detalhe). Produto novo sem descrição ou unidade
  bloqueia a nota. Regra `cadastrosDasNotas` em `compartilhado/regras/recebimento.js`.
- **Coletor**: com servidor, a separação não faz mais a baixa no estoque guardado no aparelho (a baixa no servidor
  fica para depois, decisão de 25/11/2026). A recepção no coletor passou para o servidor na entrega B (abaixo).

## Estoque no servidor · entrega B: conferência da nota no coletor (v78)

- **v79 (28/11/2026)**: o coletor junta os produtos conferidos numa lista "aguardando doca" (`js/dados/recepcao-lista.js`,
  só no aparelho) e, no "Endereçar", manda **uma `recepcao.conferir` por produto**, todas com a doca lida e
  `volumes: []`. O servidor não mudou: só a regra passou a aceitar a conferência sem volume.

- **Sem esperar a rede**: o coletor baixa as notas em aberto (`GET /api/recepcao/notas`) para a chave
  `wms-bb-recepcao-v1` (poucos KB) ao abrir, a cada 30 s e depois de cada envio. Cada confirmação vira a ação
  `recepcao.conferir` e o "Finalizar nota" vira `recepcao.finalizar`, pela fila de sempre (`/api/sincronizar`).
  Quem aplica é `consultas/recepcao.js`, com as regras de `compartilhado/regras/recebimento.js`.
- **Cópia local**: até o servidor mostrar a confirmação, ela fica numa lista local que soma ao conferido da tela
  (`js/dados/recepcao.js`). Sai quando aparece no que o coletor baixa (`recebimentos.acao_id`, migração `013`) ou
  quando o servidor recusa.
- **Código do volume**: o coletor gera — os 6 primeiros caracteres do código do aparelho + a sequência dele
  (`V3FA2C-0001`, regra `codigoDoVolumeDoAparelho`). O servidor ainda recusa um código repetido, por garantia.
- **Dois coletores passaram do pendente** (decisão de 25/11/2026): a confirmação que chega por último é recusada
  **inteira**. O coletor mostra o aviso ("descarte as etiquetas") e o detalhe da nota na Gestão mostra a recusa.
- **Saldo e histórico**: o saldo da doca e o movimento `recebimento` são gravados na mesma transação;
  `saldosForaDoHistorico` continua devolvendo `[]` nos testes.
- Com servidor, os outros menus do coletor do estoquista (Armazenamento, Consulta, Cadastro, Movimentação,
  Inventário) mostram "Ainda não está no servidor". Armazenamento e consulta de saldo vêm na entrega C.

## Observação do pedido (v76)

O texto que o vendedor escreve no pedido do Sankhya chega em `pedidos.observacao_pedido` (migração `010`).
`pedidos.observacao_para` diz para quem a leitura é obrigatória (`separador`, `conferente`, `embarque`): **vazio
(NULL) = separador e conferente**, que é o que vale hoje; quando o analista de pedidos passar a marcar no Sankhya,
o valor vem de lá. Quem decide é `compartilhado/regras/observacao.js`, a mesma regra da demonstração.

- O coletor e o posto mostram a observação e pedem a resposta (início e fim). A resposta fica no aparelho e vai pela
  fila (`observacao.ciente`), então funciona sem rede.
- `GET /api/separacao`, `GET /api/conferencia` e `GET /api/pedidos/:id` devolvem `observacao_pedido`,
  `observacao_para` e `ciencias` (quem respondeu, o quê e quando). O quadro da Separação traz `tem_observacao`; o
  da Conferência, o texto e as respostas, para a gaveta do gestor.
- "Não era para mim" não bloqueia nada: aparece como aviso na gaveta da Gestão.
- O texto não muda depois que o pedido chega (não há edição no WMS).

## Ocorrências e devoluções (v75)

O gestor registra na aba **Ocorrências** da Gestão o corte de item ou o cancelamento do pedido, com motivo e a
referência do Sankhya (`POST /api/ocorrencias`). Quem decide o que muda é `compartilhado/regras/ocorrencias.js`
(`planejarOcorrencia`), a mesma regra da demonstração. **Quem está com a mercadoria na mão devolve**:

| Etapa | Quem devolve | Como |
|---|---|---|
| Na fila (não começou) | ninguém | o corte vale na hora; nada saiu da prateleira |
| Em separação | separador | `pedidos.ocorrencia_pendente` e `itens_pedido.qtd_devolver`; o coletor percebe (a cada 15 s), mostra o aviso e manda `separacao.ocorrencia` |
| Separado aguardando conferência | conferente | `itens_pedido.qtd_devolver`; a fila do posto mostra "Item a devolver" e o pedido abre direto no F9 |
| Em conferência | conferente | o posto mostra o item a devolver; o F9 tira bipando e manda `conferencia.devolver`. Finalizar com algo a devolver é recusado |
| Conferido | conferente | a conferência volta para `aguardando` (`reaberto`) na fila de quem conferiu ("Reaberto · item a devolver"): tira no F9, refaz volumes e etiquetas |
| Cancelamento em separação | separador | **ninguém bipa**: a devolução nasce `a_entregar` com o que está na caixa; o coletor mostra "Cancelado · entregar ao estoque" e manda `separacao.entregar` |
| Cancelamento separado, em conferência ou conferido | conferente | **ninguém bipa**: a devolução nasce `a_entregar`; o posto mostra "Cancelado · entregar ao estoque" e manda `conferencia.entregar`. Na caixa de entrada sem conferente, o gestor arrasta o pedido para um conferente no quadro |
| Montagem com a conferência dispensada | gestor | a devolução nasce no registro |

Cada devolução é uma linha em `devolucoes` (+ `devolucao_itens`) com número "PV-10421" (a segunda do mesmo pedido,
"PV-10421-2"), origem, quem entregou e status `pendente`: é a **entrada pendente** que o Estoque vai conferir quando
o Estoque vier para o servidor. A do cancelamento nasce `a_entregar`, com o `responsavel` (quem está com a caixa), e
só vira `pendente` quando ele marca "Entregue ao estoque" (`entregue_por`, `entregue_em`): até lá o estoque não vê.
O histórico da aba Ocorrências mostra "DEV PV-… · aguardando entrega (nome)" enquanto isso.
No corte, quem tira da caixa (separador no coletor, conferente no F9) cria a devolução depois: ela é anotada na
ocorrência do corte (`anotarNaOcorrencia`) e o histórico troca "Conferente confirma" por "DEV PV-… · entregue por (nome)". É uma devolução **por pessoa**:
dois separadores com partes do mesmo pedido entregam cada um a sua. Na caixa de entrada da conferência ainda não há
responsável; quando o gestor arrasta o pedido para um conferente no quadro, ele passa a ser o responsável. `itens_pedido.qtd_separada` é o que está fisicamente na caixa; `qtd_devolver` é o que
ainda tem que sair; a conferência espera `qtd_separada − qtd_devolver`. `qtd_pedida` guarda a quantidade antes do
primeiro corte. **Físico vence**: o separador sem rede que separou a quantidade antiga tem a separação aceita (até a
quantidade original) e o que passou vira "a devolver". Devolução de pedido já embarcado (o cliente devolveu) fica para
a fase do Estoque.

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
