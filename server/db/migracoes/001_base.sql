-- WMS Beach Bike — migração 001: base do servidor.
-- Usuários e sessões, catálogo, endereços e saldos, pedidos da separação
-- e a "caixa de entrada" das ações que os aparelhos sincronizam.
-- As outras partes (conferência, embarque, recebimento, movimentação, inventário...)
-- ganham as suas tabelas na fase em que passarem para o servidor.

-- ---------------------------------------------------------------------------
-- Usuários e sessões
-- ---------------------------------------------------------------------------

CREATE TABLE usuarios (
  login      text PRIMARY KEY,                 -- ex.: "separador"
  nome       text NOT NULL,
  perfil     text NOT NULL,                    -- sep, conf, emb, coord, coordmont, estq, gest
  pin_hash   text NOT NULL,                    -- o PIN nunca fica guardado; só o resultado do scrypt (src/senha.js)
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- Sessão de turno: o aparelho faz login uma vez com rede e usa o token até o fim do turno,
-- mesmo passando por pontos sem Wi-Fi.
CREATE TABLE sessoes (
  token      text PRIMARY KEY,                 -- valor aleatório que o aparelho manda em cada chamada
  login      text NOT NULL REFERENCES usuarios (login),
  setor      text,                             -- exp ou mont (separador e conferente escolhem)
  criada_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE produtos (
  codigo             text PRIMARY KEY,         -- código do produto no Sankhya
  descricao          text NOT NULL,
  un                 text NOT NULL,            -- unidade: UN, PR, CJ...
  checkout           boolean NOT NULL DEFAULT true,  -- conferência bipando unidade por unidade (false = granel)
  fornecedor         integer,
  grupo              text,
  subgrupo           text,
  estoque_min        integer,
  estoque_max        integer,
  controla_validade  boolean NOT NULL DEFAULT false,
  controla_lote      boolean NOT NULL DEFAULT false,
  controla_serie     boolean NOT NULL DEFAULT false,
  peso_bruto         numeric,
  peso_liquido       numeric,
  shelflife          integer
);

-- Embalagens do produto (Unidade, Caixa com 12...) e o código de barras de cada uma.
CREATE TABLE embalagens (
  id          integer PRIMARY KEY,
  produto     text NOT NULL REFERENCES produtos (codigo),
  codigo      text,                            -- código de barras; vazio no produto a granel
  descricao   text NOT NULL,
  qtd         integer NOT NULL CHECK (qtd > 0) -- quantas unidades a embalagem tem
);
-- cada código de barras é único no WMS inteiro (regra de compartilhado/regras/embalagens.js)
CREATE UNIQUE INDEX embalagens_codigo_unico ON embalagens (codigo) WHERE codigo IS NOT NULL;
CREATE INDEX embalagens_produto ON embalagens (produto);

-- ---------------------------------------------------------------------------
-- Endereços e saldos
-- ---------------------------------------------------------------------------

-- O endereço é identificado pelo ID que está no QR da etiqueta da prateleira.
-- O código (R1-P4-A200-AP201) NÃO é único: na base real há códigos repetidos com IDs diferentes.
CREATE TABLE enderecos (
  id               integer PRIMARY KEY,
  rua              integer NOT NULL,
  predio           integer NOT NULL,
  andar            integer NOT NULL,
  apto             integer NOT NULL,
  codigo           text NOT NULL,
  tipo             text NOT NULL,              -- aereo, picking, doca, expedicao, devolucao
  deposito         text NOT NULL,
  ativo            boolean NOT NULL DEFAULT true,
  substituido_por  integer REFERENCES enderecos (id)
);
CREATE INDEX enderecos_codigo ON enderecos (codigo);

-- Quanto de cada produto há em cada endereço. Saldo zerado não fica na tabela.
-- A quantidade aceita até 3 casas decimais porque a base real do Sankhya tem saldos fracionados
-- (ex.: 101,5 raios em "UN"), provavelmente da conversão de embalagens.
CREATE TABLE saldos (
  endereco_id  integer NOT NULL REFERENCES enderecos (id),
  produto      text NOT NULL REFERENCES produtos (codigo),
  qtd          numeric(14,3) NOT NULL CHECK (qtd > 0),
  PRIMARY KEY (endereco_id, produto)
);
CREATE INDEX saldos_produto ON saldos (produto);

-- Endereço padrão do produto (ENDEREÇAR PRODUTO).
CREATE TABLE associacoes (
  produto      text NOT NULL REFERENCES produtos (codigo),
  endereco_id  integer NOT NULL REFERENCES enderecos (id),
  PRIMARY KEY (produto, endereco_id)
);

-- ---------------------------------------------------------------------------
-- Pedidos da separação
-- ---------------------------------------------------------------------------

CREATE TABLE pedidos (
  id            text PRIMARY KEY,              -- PV-10421, OP-3212 ou parte de pedido dividido (PV-10426/1)
  setor         text NOT NULL,                 -- exp (pedido de venda) ou mont (ordem de produção)
  cliente       text NOT NULL,
  cidade        text NOT NULL,
  prioridade    text NOT NULL DEFAULT 'normal',  -- alta ou normal
  chegada       timestamptz NOT NULL,          -- quando o pedido chegou do Sankhya
  status        text NOT NULL DEFAULT 'pendente', -- pendente, andamento, concluido
  separador     text,                          -- nome de quem separou
  inicio        timestamptz,
  fim           timestamptz,
  doca          text,                          -- doca de expedição onde o pedido foi deixado
  lote          text,                          -- lote de pedidos separados numa viagem só
  posicao_lote  text,                          -- caixa do pedido no lote (A a F)
  pedido_pai    text,                          -- pedido dividido: o pedido original
  parte_numero  integer,                       -- pedido dividido: esta é a parte N...
  partes_total  integer,                       -- ...de um total de M
  parte_ruas    text,                          -- pedido dividido: ruas desta parte
  dividido_por  text
);
CREATE INDEX pedidos_setor_status ON pedidos (setor, status);

-- Itens na ordem de separação (pelo endereço).
CREATE TABLE itens_pedido (
  pedido_id        text NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  sequencia        integer NOT NULL,           -- ordem na rota de separação
  produto          text NOT NULL REFERENCES produtos (codigo),
  endereco_codigo  text NOT NULL,              -- como veio no pedido (o código pode se repetir, ver enderecos)
  qtd              integer NOT NULL CHECK (qtd > 0),
  qtd_separada     integer NOT NULL DEFAULT 0 CHECK (qtd_separada >= 0),
  status           text NOT NULL DEFAULT 'pendente', -- pendente, ok, falta
  motivo           text NOT NULL DEFAULT '',   -- motivo da falta
  PRIMARY KEY (pedido_id, sequencia)
);

-- ---------------------------------------------------------------------------
-- Sincronização
-- ---------------------------------------------------------------------------

-- Caixa de entrada das ações feitas nos aparelhos (bipe, falta, finalizar...).
-- Cada ação tem um ID único criado no próprio aparelho. Se o aparelho reenviar
-- (porque a rede caiu antes da resposta), o ID já existe e a ação não entra de novo.
CREATE TABLE acoes_recebidas (
  id           uuid PRIMARY KEY,               -- criado no aparelho
  login        text NOT NULL REFERENCES usuarios (login),
  tipo         text NOT NULL,                  -- ex.: "separacao.leitura"
  dados        jsonb NOT NULL,                 -- o conteúdo da ação, como o aparelho mandou
  feita_em     timestamptz NOT NULL,           -- hora do aparelho em que a ação aconteceu
  recebida_em  timestamptz NOT NULL DEFAULT now(),
  aplicada_em  timestamptz                     -- preenchido na Fase 1, quando a ação passar a mexer nos dados
);
CREATE INDEX acoes_recebidas_recebida_em ON acoes_recebidas (recebida_em);
