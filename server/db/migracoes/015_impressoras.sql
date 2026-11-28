-- 015: impressoras de etiqueta da rede (v81, plano aprovado em 28/11/2026).
--
-- O navegador do coletor não enxerga as impressoras da rede. Por isso a impressão passa pelo servidor: o gestor de
-- estoque cadastra cada impressora (Argox na rede, com IP) e o servidor manda a etiqueta direto para ela (porta 9100),
-- na linguagem da impressora. O servidor só imprime nas impressoras cadastradas: o coletor nunca informa um IP.
CREATE TABLE impressoras (
  id          serial PRIMARY KEY,
  nome        text NOT NULL UNIQUE,
  setor       text NOT NULL DEFAULT '',
  ip          text NOT NULL,                          -- IPv4 da impressora na rede (ex.: 192.168.1.60)
  porta       integer NOT NULL DEFAULT 9100 CHECK (porta BETWEEN 1 AND 65535),
  modelo      text NOT NULL DEFAULT 'argox-ppla',     -- a linguagem que o servidor usa para montar a etiqueta
  largura_mm  integer NOT NULL DEFAULT 80 CHECK (largura_mm BETWEEN 20 AND 120),
  altura_mm   integer NOT NULL DEFAULT 60 CHECK (altura_mm BETWEEN 20 AND 200),
  ativa       boolean NOT NULL DEFAULT true,          -- desativada não aparece no coletor
  criada_em   timestamptz NOT NULL DEFAULT now()
);
