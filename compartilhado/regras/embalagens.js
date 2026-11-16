// WMS Beach Bike — regras de produtos e embalagens.
// O produto chega do ERP sem código de barras; os códigos ficam nas embalagens
// (ex.: "Unidade" com 1, "Caixa" com 12). Cada código de barras é único no WMS inteiro.

export const MSG_CODIGO_DUPLICADO = "CÓDIGO DE BARRAS JÁ CADASTRADO.";
export const MSG_EXCLUIR_EMBALAGEM = "DESEJA REALMENTE EXCLUIR ESTA EMBALAGEM?";
export const MSG_PRODUTO_JA_IMPORTADO = "PRODUTO JÁ IMPORTADO.";

// "Câmara" e "camara" são a mesma coisa numa busca
const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// quantidade da embalagem: aceita inteiro ou decimal, com vírgula ou ponto ("12", "0,5")
export function lerQuantidade(texto) {
  const n = Number(String(texto).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// confere uma embalagem antes de salvar. `idEditando` é a própria embalagem (ao editar, o código dela não conta como repetido).
// Devolve { ok: true, embalagem } já limpa, ou { ok: false, msg }.
export function validarEmbalagem({ codigo = "", descricao = "", qtd }, embalagens, idEditando = null) {
  const cod = String(codigo).trim();
  const desc = String(descricao).trim();
  const quantidade = lerQuantidade(qtd);
  if (!desc) return { ok: false, msg: "Informe a descrição da embalagem." };
  if (quantidade === null) return { ok: false, msg: "Informe a quantidade (maior que zero)." };
  // o código é opcional; preenchido, não pode estar em outra embalagem (deste ou de outro produto)
  if (cod && embalagens.some((e) => e.codigo === cod && e.id !== idEditando)) return { ok: false, msg: MSG_CODIGO_DUPLICADO };
  return { ok: true, embalagem: { codigo: cod, descricao: desc, qtd: quantidade } };
}

// o que foi bipado ou digitado: primeiro o código de barras de uma embalagem; senão, o código interno do produto.
// Devolve { produto, embalagem } (embalagem null quando achou pelo código interno) ou null.
export function acharPorCodigoLido(produtos, embalagens, lido) {
  const t = String(lido).trim();
  if (!t) return null;
  const emb = embalagens.find((e) => e.codigo && e.codigo === t);
  if (emb) {
    const produto = produtos.find((p) => p.codigo === emb.produto);
    return produto ? { produto, embalagem: emb } : null;
  }
  const produto = produtos.find((p) => p.codigo.toUpperCase() === t.toUpperCase());
  return produto ? { produto, embalagem: null } : null;
}

// busca por código interno ou descrição (para quando a embalagem não tem código de barras)
export function buscarProdutos(produtos, termo) {
  const t = semAcento(termo);
  if (!t) return produtos;
  return produtos.filter((p) => semAcento(p.codigo).includes(t) || semAcento(p.descricao).includes(t));
}

// importação vinda do ERP: produto que já existe é bloqueado, sem duplicar nem alterar o que já está no WMS
export function separarImportacao(existentes, recebidos) {
  const codigos = new Set(existentes.map((p) => p.codigo));
  const importados = [], bloqueados = [];
  for (const p of recebidos) {
    if (codigos.has(p.codigo)) bloqueados.push({ produto: p, msg: MSG_PRODUTO_JA_IMPORTADO });
    else { importados.push(p); codigos.add(p.codigo); }
  }
  return { importados, bloqueados };
}
