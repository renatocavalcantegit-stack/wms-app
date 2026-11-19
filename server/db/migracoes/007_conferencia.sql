-- 007: a Conferência passa pelo servidor (Fase 2).
--
-- Uma CONFERÊNCIA por pedido inteiro. Pedido dividido entre separadores: uma conferência só, com o id do
-- pedido original (PV-10426), que nasce quando TODAS as partes terminaram a separação.
-- A linha nasce sozinha quando a separação termina (o pedido entra na caixa de entrada da conferência)
-- e sai se o separador "separa novamente" antes de alguém começar a conferir.
--
-- FILA DO CONFERENTE (igual à da Separação): o coordenador arrasta o pedido para a coluna do conferente
-- no quadro da Gestão; o posto mostra só a fila dele, na ordem do quadro.
--   designado_para  login do conferente (vazio = caixa de entrada)
--   ordem_fila      posição na fila (1 = o próximo)
--
-- status: aguardando (ninguém começou), andamento, conferido, divergente (finalizado com falta, excesso ou
-- produto fora do pedido). volumes e observacao (a observação dos volumes: tipos, outro, atenção) vêm da
-- finalização no posto; o envio ao Sankhya ainda é simulado.
CREATE TABLE conferencias (
  pedido          text PRIMARY KEY,
  setor           text NOT NULL,
  status          text NOT NULL DEFAULT 'aguardando',
  designado_para  text REFERENCES usuarios (login),
  ordem_fila      integer,
  designado_em    timestamptz,
  designado_por   text REFERENCES usuarios (login),
  conferente      text REFERENCES usuarios (login),
  inicio          timestamptz,
  fim             timestamptz,
  posto           text,
  volumes         integer,
  observacao      jsonb,
  chegou_em       timestamptz NOT NULL DEFAULT now()  -- quando entrou na conferência (fim da separação)
);
CREATE INDEX conferencias_setor_status ON conferencias (setor, status);
CREATE INDEX conferencias_fila ON conferencias (designado_para, ordem_fila);

-- O que o conferente contou de cada produto (o VALOR atual, já com os estornos: reenviar não soma de novo).
-- fora = o produto não é do pedido (bipado por engano: vai para devolução).
CREATE TABLE conferencia_itens (
  pedido         text NOT NULL REFERENCES conferencias (pedido) ON DELETE CASCADE,
  produto        text NOT NULL,
  qtd_conferida  numeric(14,3) NOT NULL DEFAULT 0 CHECK (qtd_conferida >= 0),
  fora           boolean NOT NULL DEFAULT false,
  PRIMARY KEY (pedido, produto)
);
