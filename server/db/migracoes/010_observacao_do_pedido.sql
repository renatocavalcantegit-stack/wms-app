-- 010: observação do pedido (v76, decisão de 24/11/2026).
--
-- O texto que o vendedor escreve no pedido do Sankhya (ex.: "10 do Homem-Aranha, 6 do Batman", "cuidado com os aros",
-- "entregar antes das 12h"). Não confundir com conferencias.observacao (a observação dos VOLUMES, que o WMS grava
-- no Sankhya). Ver compartilhado/regras/observacao.js.
--
-- observacao_para: para quem a leitura é obrigatória, marcado no Sankhya pelo analista de pedidos (futuro):
--   NULL = o Sankhya ainda não mandou → obrigatória para separador e conferente
--   '{embarque}', '{separador,conferente}'... = só para quem foi marcado · '{}' = ninguém marcado
-- Pedido dividido: cada parte leva o texto do pedido original.
ALTER TABLE pedidos
  ADD COLUMN observacao_pedido text,
  ADD COLUMN observacao_para text[];

-- quem leu e o que respondeu, em cada momento (a ação "observacao.ciente" do coletor, do posto e do embarque)
--   pedido   o pedido original (PV-10426, mesmo quando quem leu foi o separador de uma parte)
--   parte    a parte do pedido dividido (PV-10426/1) ou NULL
--   papel    separador, conferente ou embarque
--   momento  inicio (antes de começar) ou fim (antes de terminar)
--   resposta li (Li e entendi), apliquei (Li e apliquei) ou nao_era (Não era para mim)
CREATE TABLE observacao_ciencias (
  id         bigserial PRIMARY KEY,
  pedido     text NOT NULL,
  parte      text,
  login      text NOT NULL REFERENCES usuarios (login),
  papel      text NOT NULL CHECK (papel IN ('separador', 'conferente', 'embarque')),
  momento    text NOT NULL CHECK (momento IN ('inicio', 'fim')),
  resposta   text NOT NULL CHECK (resposta IN ('li', 'apliquei', 'nao_era')),
  feita_em   timestamptz NOT NULL
);
-- uma resposta por pessoa, papel e momento (respondeu de novo: vale a última)
CREATE UNIQUE INDEX observacao_ciencias_uma ON observacao_ciencias (pedido, coalesce(parte, ''), login, papel, momento);
