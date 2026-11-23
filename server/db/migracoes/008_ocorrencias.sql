-- 008: ocorrências do pedido no servidor (v75): corte de item, cancelamento e devolução ao estoque.
--
-- Quem devolve é quem está com a mercadoria na mão (decisão de 23/11/2026):
--   em separação  → o separador confirma no coletor   (pedidos.ocorrencia_pendente)
--   em conferência → o conferente tira bipando (F9)
--   na fila, separado aguardando conferência ou conferido → o próprio gestor, na hora
-- Toda devolução vira uma ENTRADA PENDENTE no estoque (tabela devolucoes), que o estoquista confere e armazena
-- como uma nota (isso entra na etapa do Estoque no servidor).

-- o item pode ir a zero (cortado pelo gestor)
ALTER TABLE itens_pedido DROP CONSTRAINT IF EXISTS itens_pedido_qtd_check;
ALTER TABLE itens_pedido ADD CONSTRAINT itens_pedido_qtd_check CHECK (qtd >= 0);
ALTER TABLE itens_pedido
  ADD COLUMN qtd_pedida   numeric(14,3),                              -- a quantidade antes do primeiro corte
  ADD COLUMN qtd_devolver numeric(14,3) NOT NULL DEFAULT 0 CHECK (qtd_devolver >= 0); -- está na caixa e tem que sair
UPDATE itens_pedido SET qtd_pedida = qtd;

ALTER TABLE pedidos
  ADD COLUMN ocorrencia_pendente boolean NOT NULL DEFAULT false, -- o separador ainda não confirmou o pedido do gestor
  ADD COLUMN cancelado           jsonb;                          -- { quando, motivo, referencia, usuario } do cancelamento

ALTER TABLE conferencias
  ADD COLUMN reaberto  jsonb,  -- o gestor tirou item de um pedido conferido: volta para refazer volumes e etiquetas
  ADD COLUMN cancelado jsonb;

-- histórico do que o gestor registrou (aba Ocorrências)
CREATE TABLE ocorrencias (
  id          serial PRIMARY KEY,
  pedido      text NOT NULL,
  setor       text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('corte', 'cancelamento')),
  etapa       text NOT NULL,                 -- onde o pedido estava (compartilhado/regras/ocorrencias.js, ETAPAS_PEDIDO)
  motivo      text NOT NULL,
  referencia  text NOT NULL,                 -- nº da alteração ou do cancelamento no Sankhya
  usuario     text NOT NULL REFERENCES usuarios (login),
  feita_em    timestamptz NOT NULL DEFAULT now(),
  itens       jsonb NOT NULL,                -- [{ sku, desc, de, para, devolver }]
  avisar      text[] NOT NULL DEFAULT '{}',  -- quem confirma no aparelho: separador, conferente
  entradas    text[] NOT NULL DEFAULT '{}'   -- números das devoluções que nasceram na hora
);
CREATE INDEX ocorrencias_setor ON ocorrencias (setor, feita_em DESC);

-- entradas pendentes de devolução (o que saiu da caixa de um pedido e foi entregue ao estoque)
CREATE TABLE devolucoes (
  id           serial PRIMARY KEY,
  numero       text NOT NULL UNIQUE,          -- o número do pedido; a segunda devolução do mesmo pedido: "PV-10421-2"
  pedido       text NOT NULL,
  setor        text NOT NULL,
  origem       text NOT NULL,                 -- separador, conferente, gestor ou cancelamento
  entregue_por text NOT NULL REFERENCES usuarios (login),
  criada_em    timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pendente' -- pendente: o estoque ainda não conferiu
);
CREATE INDEX devolucoes_status ON devolucoes (status, criada_em);

CREATE TABLE devolucao_itens (
  devolucao_id integer NOT NULL REFERENCES devolucoes (id) ON DELETE CASCADE,
  produto      text NOT NULL REFERENCES produtos (codigo),
  qtd          numeric(14,3) NOT NULL CHECK (qtd > 0),
  PRIMARY KEY (devolucao_id, produto)
);
