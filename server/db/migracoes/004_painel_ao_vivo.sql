-- 004: o que a Gestão precisa para acompanhar a separação ao vivo (Fase 1c).
--
-- Último contato: o coletor manda um "batimento" a cada 30 s (o /api/sincronizar com a lista vazia),
-- além das ações. Cada chamada grava a hora aqui. Assim a Gestão sabe se o separador está sem rede
-- ("sem contato há 6 min") ou só parado. O login também conta como contato.
ALTER TABLE sessoes ADD COLUMN ultimo_contato timestamptz;

-- Ações não aplicadas (conflito ou recusada): ficam na lista da Gestão até o coordenador marcar "visto".
ALTER TABLE acoes_recebidas
  ADD COLUMN vista_em  timestamptz,
  ADD COLUMN vista_por text REFERENCES usuarios (login);

-- a lista da Gestão procura só as que ainda não foram vistas
CREATE INDEX acoes_recebidas_nao_vistas ON acoes_recebidas (recebida_em)
  WHERE resultado IN ('conflito', 'recusada') AND vista_em IS NULL;
