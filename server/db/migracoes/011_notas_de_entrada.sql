-- 011: Estoque no servidor, entrega A (v77, plano aprovado em 25/11/2026): as NOTAS DE ENTRADA do recebimento.
--
-- O que entra no estoque é sempre uma nota: uma Compra (vem do ERP; até o Sankhya ser ligado, a busca é simulada)
-- ou uma Devolução (o que saiu da caixa de um pedido: nasce sozinha quando a devolução fica "pendente").
-- O estoquista confere no coletor (cada confirmação é um "recebimento", com os volumes e as etiquetas) e
-- depois armazena: leva da doca para o endereço. A conferência e o armazenamento pelo coletor vêm nas entregas B e C;
-- aqui ficam as tabelas e a aba Entrada da Gestão de Estoque.
--
-- Regras em compartilhado/regras/recebimento.js (as mesmas da demonstração).

-- ---------------------------------------------------------------------------
-- Notas
-- ---------------------------------------------------------------------------
CREATE TABLE notas_entrada (
  id                   serial PRIMARY KEY,
  numero               text NOT NULL,                 -- número da NF; na devolução, o do pedido ("PV-10421", "PV-10421-2")
  tipo                 text NOT NULL CHECK (tipo IN ('Compra', 'Devolução')),
  fornecedor_codigo    integer,                       -- código do fornecedor no Sankhya (vazio na devolução)
  fornecedor_nome      text NOT NULL,                 -- na devolução: "Entregue por <nome>"
  data                 date NOT NULL,
  finalizada           boolean NOT NULL DEFAULT false, -- a conferência terminou: não recebe mais e não reabre
  finalizada_em        timestamptz,
  finalizada_por       text REFERENCES usuarios (login),
  devolucao_id         integer UNIQUE REFERENCES devolucoes (id), -- a devolução que virou esta nota
  pedido               text,                          -- o pedido da devolução
  criada_em            timestamptz NOT NULL DEFAULT now(),
  -- Os três status do cabeçalho, como a regra statusDaNota calcula. Ficam gravados (e são recalculados a cada
  -- mudança, na mesma transação) para a lista filtrar e paginar no banco, sem ler todas as notas.
  status_conferencia   text NOT NULL DEFAULT 'aguardando' CHECK (status_conferencia IN ('aguardando', 'aberta', 'conferida')),
  status_divergencia   text CHECK (status_divergencia IN ('sem', 'com')), -- vazio até finalizar
  status_armazenamento text NOT NULL DEFAULT 'pendente' CHECK (status_armazenamento IN ('pendente', 'parcial', 'armazenado'))
);
-- a mesma NF do mesmo fornecedor não entra duas vezes (a busca do ERP bloqueia a repetida)
CREATE UNIQUE INDEX notas_entrada_da_compra ON notas_entrada (numero, fornecedor_codigo) WHERE tipo = 'Compra';
CREATE UNIQUE INDEX notas_entrada_da_devolucao ON notas_entrada (numero) WHERE tipo = 'Devolução';
-- a lista mostra as mais recentes primeiro
CREATE INDEX notas_entrada_recentes ON notas_entrada (data DESC, id DESC);

CREATE TABLE notas_entrada_itens (
  nota_id  integer NOT NULL REFERENCES notas_entrada (id) ON DELETE CASCADE,
  produto  text NOT NULL REFERENCES produtos (codigo),
  qtd      numeric(14,3) NOT NULL CHECK (qtd > 0),
  PRIMARY KEY (nota_id, produto)
);

-- ---------------------------------------------------------------------------
-- Conferência no coletor: cada confirmação é um recebimento (soma ao conferido e põe o saldo na doca)
-- ---------------------------------------------------------------------------
CREATE TABLE recebimentos (
  id            serial PRIMARY KEY,
  nota_id       integer NOT NULL REFERENCES notas_entrada (id),
  produto       text NOT NULL REFERENCES produtos (codigo),
  qtd           numeric(14,3) NOT NULL CHECK (qtd > 0),
  doca_id       integer NOT NULL REFERENCES enderecos (id),
  dia           date NOT NULL,                              -- a "data de armazenagem" (ordem do armazenamento)
  armazenado    numeric(14,3) NOT NULL DEFAULT 0 CHECK (armazenado >= 0),
  cancelado     numeric(14,3) NOT NULL DEFAULT 0 CHECK (cancelado >= 0), -- "Cancelar pendente" do gestor
  cancelado_por text REFERENCES usuarios (login),
  cancelado_em  timestamptz,
  usuario       text REFERENCES usuarios (login),           -- quem conferiu (vazio nos dados de demonstração)
  feito_em      timestamptz NOT NULL DEFAULT now(),
  CHECK (armazenado + cancelado <= qtd)
);
CREATE INDEX recebimentos_da_nota ON recebimentos (nota_id, produto);
-- o que ainda espera armazenamento (a lista do armazenador e o "pendente na doca")
CREATE INDEX recebimentos_pendentes ON recebimentos (produto, doca_id) WHERE armazenado + cancelado < qtd;

-- volumes gerados na confirmação (uma etiqueta para cada)
CREATE TABLE volumes_recebimento (
  codigo          text PRIMARY KEY,                         -- o que vai no QR da etiqueta
  recebimento_id  integer NOT NULL REFERENCES recebimentos (id) ON DELETE CASCADE,
  seq             integer NOT NULL CHECK (seq >= 1),
  total           integer NOT NULL CHECK (total >= seq)
);
CREATE INDEX volumes_recebimento_do_recebimento ON volumes_recebimento (recebimento_id);

-- ---------------------------------------------------------------------------
-- Movimentos: o extrato do estoque (decisão de 25/11/2026: guardado para sempre)
-- ---------------------------------------------------------------------------
-- Toda mudança de saldo grava um movimento NA MESMA TRANSAÇÃO; assim o saldo e o histórico não se separam.
-- O saldo que já existia quando o histórico começou entra como "saldo_inicial" (um por endereço e produto).
--   saldo_inicial   destino = onde estava
--   recebimento     destino = a doca              (entrega B)
--   armazenamento   origem = a doca, destino = o endereço   (entrega C)
--   ajuste          origem (tirou) ou destino (pôs)          (inventário, mais adiante)
CREATE TABLE movimentos (
  id          bigserial PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('saldo_inicial', 'recebimento', 'armazenamento', 'ajuste')),
  produto     text NOT NULL REFERENCES produtos (codigo),
  qtd         numeric(14,3) NOT NULL CHECK (qtd > 0),
  origem_id   integer REFERENCES enderecos (id),            -- de onde saiu (vazio: entrou de fora)
  destino_id  integer REFERENCES enderecos (id),            -- para onde foi (vazio: saiu do estoque)
  usuario     text REFERENCES usuarios (login),
  feito_em    timestamptz NOT NULL DEFAULT now(),
  nota_id     integer REFERENCES notas_entrada (id),
  pedido      text,
  CHECK (origem_id IS NOT NULL OR destino_id IS NOT NULL)
);
-- as telas sempre filtram por produto, endereço ou pedido e por período (nunca "carregar tudo")
CREATE INDEX movimentos_do_produto ON movimentos (produto, feito_em DESC);
CREATE INDEX movimentos_da_origem ON movimentos (origem_id, feito_em DESC) WHERE origem_id IS NOT NULL;
CREATE INDEX movimentos_do_destino ON movimentos (destino_id, feito_em DESC) WHERE destino_id IS NOT NULL;
CREATE INDEX movimentos_do_pedido ON movimentos (pedido) WHERE pedido IS NOT NULL;

-- ---------------------------------------------------------------------------
-- O que já está no banco
-- ---------------------------------------------------------------------------
-- o saldo de hoje é o começo do histórico
INSERT INTO movimentos (tipo, produto, qtd, destino_id)
SELECT 'saldo_inicial', produto, qtd, endereco_id FROM saldos;

-- devoluções já entregues ao estoque (pendentes) viram notas
INSERT INTO notas_entrada (numero, tipo, fornecedor_nome, data, devolucao_id, pedido)
SELECT d.numero, 'Devolução', 'Entregue por ' || coalesce(u.nome, d.entregue_por, '—'), coalesce(d.entregue_em, d.criada_em)::date, d.id, d.pedido
  FROM devolucoes d LEFT JOIN usuarios u ON u.login = d.entregue_por
 WHERE d.status = 'pendente';
INSERT INTO notas_entrada_itens (nota_id, produto, qtd)
SELECT n.id, i.produto, i.qtd FROM notas_entrada n JOIN devolucao_itens i ON i.devolucao_id = n.devolucao_id;
