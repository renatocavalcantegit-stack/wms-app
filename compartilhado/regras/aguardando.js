// WMS Beach Bike — pedido "aguardando": o cliente vem retirar na empresa (não tem entrega).
// Funções puras (sem tela e sem armazenamento): usadas pela Gestão, pelo coletor, pela etiqueta e, depois, pelo servidor.
//
// O pedido vem do Sankhya com o campo "aguardando" (sim / não), marcado pelo analista de pedidos.
// Vale mesmo que o cliente tenha rota no cadastro (às vezes ele é de uma rota, mas decide vir buscar).
// No WMS o aguardando:
//   - entra como PRIORIDADE;
//   - não mostra a rota: aparece com o nome "Aguardando";
//   - não tem horário de corte, data de embarque nem carga: depois do faturamento fica "Aguardando retirada";
//   - aparece nos filtros e no Acompanhamento ao lado das rotas, mas NÃO é rota.

export const AGUARDANDO = { id: "aguardando", nome: "Aguardando", cor: "#4338CA" };

// o pedido é aguardando? (aceita o booleano do Sankhya ou o texto "S"/"sim")
export const ehAguardando = (p) => p?.aguardando === true || /^(s|sim|true|1)$/i.test(String(p?.aguardando ?? ""));

// pedido de expedição sem rota e que não é aguardando: o coordenador precisa definir a rota
export const precisaDeRota = (p) => !p.rota && !ehAguardando(p) && !p.op;

// o que aparece no lugar da rota: "Aguardando", o nome da rota ou null (sem rota)
export const destinoDoPedido = (p, nomeDaRota = () => null) => (ehAguardando(p) ? AGUARDANDO.nome : (p.rota && nomeDaRota(p.rota)) || null);
