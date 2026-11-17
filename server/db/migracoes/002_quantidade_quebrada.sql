-- 002: quantidade quebrada nos itens do pedido.
-- Decisão de 17/11/2026: o WMS aceita quantidade quebrada (ex.: 101,5 UN de raios, 20,935 PR), igual ao Sankhya.
-- Até 3 casas depois da vírgula, igual a saldos.qtd (001).
--
-- Por que uma migração nova e não mexer na 001? A 001 já rodou no banco de quem baixou o projeto.
-- O migrar.js só roda o arquivo que ainda não rodou, então a mudança tem que vir num arquivo novo.
--
-- O que continua inteiro: embalagens.qtd (uma caixa tem 10 unidades, não 10,5), volumes e etiquetas.

ALTER TABLE itens_pedido
  ALTER COLUMN qtd          TYPE numeric(14,3),
  ALTER COLUMN qtd_separada TYPE numeric(14,3);
-- os CHECK (qtd > 0) e (qtd_separada >= 0) da 001 continuam valendo com o tipo novo
