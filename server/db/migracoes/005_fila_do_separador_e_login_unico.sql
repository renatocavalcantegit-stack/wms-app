-- 005: o quadro da Separação passa a valer de verdade (Fase 1e) e o login único dos coletores.
--
-- FILA DO SEPARADOR: o coordenador arrasta o pedido da caixa de entrada para a coluna de um separador
-- (ou de um separador para outro). O coletor mostra só a fila dele, na ordem que o coordenador deixou.
--   designado_para  login do separador (vazio = está na caixa de entrada)
--   ordem_fila      posição na fila (1 = o próximo); vazio na caixa de entrada
-- O pedido em andamento não muda de fila (a trava fica no servidor: consultas/quadro.js).
ALTER TABLE pedidos
  ADD COLUMN designado_para text REFERENCES usuarios (login),
  ADD COLUMN ordem_fila     integer,
  ADD COLUMN designado_em   timestamptz,
  ADD COLUMN designado_por  text REFERENCES usuarios (login),
  -- ROTA e AGUARDANDO vêm do Sankhya. Sem rota (e sem ser aguardando), o coordenador define a rota
  -- antes de mandar o pedido para um separador. Aguardando: o cliente retira na empresa (não tem rota).
  ADD COLUMN rota           text,
  ADD COLUMN aguardando     boolean NOT NULL DEFAULT false;
CREATE INDEX pedidos_fila ON pedidos (designado_para, ordem_fila);

-- LOGIN ÚNICO: o separador, o conferente e o embarque ficam conectados em um aparelho de cada vez.
-- Login em outro aparelho é recusado ("saia por lá ou peça ao coordenador para desconectar").
--   id               número da sessão (a tela de Dispositivos usa este, nunca o token)
--   aparelho         código do aparelho, criado no próprio coletor na primeira vez (fica no localStorage)
--   encerrada_em     quando a sessão terminou antes do prazo
--   encerrada_por    quem encerrou (o próprio usuário ao sair, ou o coordenador)
--   motivo           saiu · coordenador · novo-login (entrou de novo no mesmo aparelho)
--   acoes_pendentes  quantas ações o aparelho ainda tinha na fila no último contato
ALTER TABLE sessoes
  ADD COLUMN id              bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  ADD COLUMN aparelho        text,
  ADD COLUMN encerrada_em    timestamptz,
  ADD COLUMN encerrada_por   text REFERENCES usuarios (login),
  ADD COLUMN motivo          text,
  ADD COLUMN acoes_pendentes integer NOT NULL DEFAULT 0;
CREATE INDEX sessoes_ativas ON sessoes (login) WHERE encerrada_em IS NULL;
