-- 014: conferência da nota POR VOLUME (v80, plano aprovado em 28/11/2026).
--
-- O conferente cria os volumes (palete ou caixa) no coletor, vincula os produtos a cada um e endereça o volume
-- inteiro numa doca. Até ser endereçado o volume existe só no coletor; o servidor recebe o volume pronto pela
-- ação "recepcao.enderecarVolume" e grava um recebimento por produto, ligado ao volume.

CREATE TABLE volumes_entrada (
  codigo    text PRIMARY KEY,                                -- o que vai no código de barras da etiqueta
  nota_id   integer NOT NULL REFERENCES notas_entrada (id) ON DELETE CASCADE,
  tipo      text NOT NULL CHECK (tipo IN ('palete', 'caixa')),
  doca_id   integer NOT NULL REFERENCES enderecos (id),      -- onde o volume foi endereçado
  dia       date NOT NULL,                                   -- a "data de armazenagem" (o dia do aparelho)
  usuario   text REFERENCES usuarios (login),                -- quem montou e endereçou
  feito_em  timestamptz NOT NULL DEFAULT now(),
  acao_id   uuid UNIQUE                                      -- a ação da fila (o coletor sabe que o servidor já tem)
);
CREATE INDEX volumes_entrada_da_nota ON volumes_entrada (nota_id);

-- de qual volume veio o recebimento (vazio na conferência por produto)
ALTER TABLE recebimentos ADD COLUMN volume_codigo text REFERENCES volumes_entrada (codigo) ON DELETE CASCADE;
CREATE INDEX recebimentos_do_volume ON recebimentos (volume_codigo) WHERE volume_codigo IS NOT NULL;
