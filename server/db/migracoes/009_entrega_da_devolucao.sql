-- 009: entrega da devolução do pedido cancelado (v75, ajuste de 23/11/2026 à tarde).
--
-- Cancelamento: o pedido fica cancelado na hora e ninguém bipa. O WMS gera a devolução com o que está na caixa
-- e ela fica "a_entregar" até quem está com a caixa (separador no coletor, conferente no posto) marcar
-- "Entregue ao estoque". Só então vira "pendente" (a entrada que o estoquista confere e armazena).
-- Fica registrado quem deveria entregar (responsavel), quem entregou (entregue_por) e quando (entregue_em).

ALTER TABLE devolucoes ALTER COLUMN entregue_por DROP NOT NULL; -- a_entregar: ninguém entregou ainda
ALTER TABLE devolucoes
  ADD COLUMN responsavel text REFERENCES usuarios (login), -- quem está com a caixa e tem que entregar
  ADD COLUMN entregue_em timestamptz;
UPDATE devolucoes SET entregue_em = criada_em WHERE entregue_em IS NULL;

-- status: a_entregar (esperando a entrega) → pendente (o estoque ainda não conferiu)
CREATE INDEX devolucoes_a_entregar ON devolucoes (pedido, origem) WHERE status = 'a_entregar';
