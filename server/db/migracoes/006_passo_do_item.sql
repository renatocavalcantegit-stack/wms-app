-- 006: o passo do item da vez (v63), só para a Gestão acompanhar.
--
-- Cada item da separação tem três passos no coletor: 1. ler o endereço, 2. bipar o produto, 3. digitar a
-- quantidade (aí o item fica completo ou com falta, pela ação separacao.item). A gaveta do pedido na Gestão
-- enche a bolinha do item da vez aos poucos: 1/3, 2/3 e cheia.
--   item_da_vez   sequência do item em que o separador está
--   passo_da_vez  1 = endereço lido · 2 = produto bipado
-- Não é ação da fila (não muda estoque nem a quantidade do item): vai junto do envio que o coletor já faz
-- e, sem rede, simplesmente não chega. Quem vale para o item é sempre a ação separacao.item.
ALTER TABLE pedidos
  ADD COLUMN item_da_vez   integer,
  ADD COLUMN passo_da_vez  integer CHECK (passo_da_vez IN (1, 2));
