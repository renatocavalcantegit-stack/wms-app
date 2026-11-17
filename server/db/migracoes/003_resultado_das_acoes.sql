-- 003: resultado de cada ação recebida (Fase 1a).
-- Desde a Fase 1, as ações não ficam só guardadas: o servidor aplica cada uma no pedido.
-- Aqui fica registrado o que aconteceu com ela, para auditoria e para o coordenador ver os conflitos.
--
--   aplicada      mudou o pedido (aplicada_em, da 001, recebe a hora)
--   conflito      outro separador já estava com o pedido: nada foi aplicado, o coordenador decide
--   recusada      ação inválida (item que não existe, quantidade errada, perfil sem permissão...)
--   desconhecida  tipo de ação que o servidor ainda não sabe aplicar (fica guardada, sem mexer em nada)
--
-- A partir daqui, pedidos.separador guarda o LOGIN de quem separa (não o nome, como dizia a 001):
-- é o login que vem na sessão do coletor.

ALTER TABLE acoes_recebidas
  ADD COLUMN resultado text CHECK (resultado IN ('aplicada', 'conflito', 'recusada', 'desconhecida')),
  ADD COLUMN motivo    text;

-- a tela do coordenador vai procurar os conflitos (Fase 1c)
CREATE INDEX acoes_recebidas_conflitos ON acoes_recebidas (recebida_em) WHERE resultado = 'conflito';
