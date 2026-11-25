-- 013: Estoque no servidor, entrega B (v78, plano aprovado em 25/11/2026): a CONFERÊNCIA DA NOTA no coletor, pela fila.
--
-- O estoquista confere e finaliza a nota no coletor sem esperar a rede: cada confirmação vira a ação
-- "recepcao.conferir" e o "Finalizar nota" vira "recepcao.finalizar" (consultas/aplicar-recepcao.js).

-- a ação da fila que criou o recebimento: o coletor usa para saber que a confirmação dele já está no servidor
-- (e parar de somar a cópia local). Vazio nos recebimentos que não vieram do coletor (carga da demonstração).
ALTER TABLE recebimentos ADD COLUMN acao_id uuid UNIQUE;

-- o coletor baixa só as notas em aberto
CREATE INDEX notas_entrada_abertas ON notas_entrada (data DESC, id DESC) WHERE NOT finalizada;

-- as ações da recepção recusadas de uma nota (o detalhe da nota, na Gestão, mostra)
CREATE INDEX acoes_recebidas_da_nota ON acoes_recebidas ((dados->>'nota')) WHERE tipo LIKE 'recepcao.%';
