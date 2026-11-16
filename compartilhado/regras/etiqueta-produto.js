// WMS Beach Bike — regras da etiqueta de produto.
// O rolo tem 90 × 20 mm e 3 etiquetas lado a lado (cada uma com ~29 × 20 mm).
// Cada etiqueta traz: código interno, descrição, embalagem e um QR Code.

export const ETIQUETAS_POR_LINHA = 3;

// o que vai dentro do QR: o código de barras da embalagem escolhida (é o que o coletor procura ao bipar);
// sem embalagem ou sem código de barras, vai o código interno do produto
export const conteudoDoQr = (produto, embalagem) => (embalagem && embalagem.codigo) || produto.codigo;

// quantas linhas do rolo saem para N etiquetas (a última linha pode ficar incompleta)
export const linhasDoRolo = (quantidade) => Math.ceil(quantidade / ETIQUETAS_POR_LINHA);

// distribui N etiquetas pelas linhas do rolo: 7 → [3, 3, 1]
export function etiquetasPorLinha(quantidade) {
  const linhas = [];
  for (let resta = quantidade; resta > 0; resta -= ETIQUETAS_POR_LINHA) linhas.push(Math.min(ETIQUETAS_POR_LINHA, resta));
  return linhas;
}
