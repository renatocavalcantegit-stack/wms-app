-- 012: o produto novo nasce da nota do ERP (v77, decisão de 25/11/2026).
--
-- Quando a nota importada traz um produto que o WMS não tem, a importação cadastra o produto junto, com os dados
-- que vêm do ERP (descrição, unidade, embalagens com o código de barras...). O produto que já existe não muda.
-- Regra em compartilhado/regras/recebimento.js (cadastrosDasNotas).

-- de onde o produto veio (vazio: veio do cadastro de produtos)
ALTER TABLE produtos
  ADD COLUMN cadastrado_por_nota integer REFERENCES notas_entrada (id),
  ADD COLUMN cadastrado_em       timestamptz;

-- avisos da importação que o gestor precisa ver na nota (ex.: código de barras que já era de outro produto:
-- o produto novo foi cadastrado sem ele, para corrigir no Sankhya)
ALTER TABLE notas_entrada ADD COLUMN avisos text[] NOT NULL DEFAULT '{}';

-- as embalagens novas ganham o número sozinhas (antes, só vinham da carga da demonstração, com o número pronto)
CREATE SEQUENCE embalagens_id_seq OWNED BY embalagens.id;
SELECT setval('embalagens_id_seq', coalesce((SELECT max(id) FROM embalagens), 0) + 1, false);
ALTER TABLE embalagens ALTER COLUMN id SET DEFAULT nextval('embalagens_id_seq');
