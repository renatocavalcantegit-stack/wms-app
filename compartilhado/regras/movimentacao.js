// WMS Beach Bike — regras da MOVIMENTAÇÃO: abastecimento (aéreo → picking) e transferência entre endereços.
// Funções puras: recebem os dados e devolvem a resposta, sem tela e sem armazenamento (testadas em testes/movimentacao.test.js).
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "./enderecos.js";
import { lerQuantidade, quantidadeValida, quantidadePositiva, arredondarQtd, somarQtd, CASAS_DA_QUANTIDADE, MSG_QUANTIDADE } from "./quantidade.js";

// ---------- mensagens ----------
export const MSG_TAREFA_JA_ABERTA = "JÁ EXISTE TAREFA DE ABASTECIMENTO ABERTA PARA ESTE PRODUTO NESTE PICKING.";
export const MSG_SEM_MAXIMO = "PRODUTO SEM MÍNIMO E MÁXIMO CONFIGURADOS NESTE PICKING.";
export const MSG_PICKING_CHEIO = "PICKING JÁ ESTÁ NO ESTOQUE MÁXIMO.";
export const MSG_SEM_AEREO = "SEM SALDO DESTE PRODUTO NO AÉREO.";
export const MSG_NAO_E_PICKING = "O DESTINO DO ABASTECIMENTO TEM QUE SER UM ENDEREÇO PICKING.";
export const MSG_ORIGEM_FORA_DA_TAREFA = "ESTE ENDEREÇO NÃO É ORIGEM DESTA TAREFA.";
export const MSG_DESTINO_DA_TAREFA = "DESTINO DIFERENTE DO PICKING DA TAREFA.";
export const MSG_PRODUTO_DA_TAREFA = "PRODUTO DIFERENTE DO DA TAREFA.";
export const MSG_ACIMA_DO_PLANEJADO = "QUANTIDADE MAIOR QUE O PLANEJADO PARA ESTA ORIGEM.";
export const MSG_SALDO_ORIGEM = "QUANTIDADE INFORMADA MAIOR QUE O SALDO DISPONÍVEL NO ENDEREÇO DE ORIGEM.";
export const MSG_DESTINO_IGUAL = "O DESTINO NÃO PODE SER O PRÓPRIO ENDEREÇO DE ORIGEM.";
export const MSG_SEM_SALDO_NA_ORIGEM = "PRODUTO SEM SALDO NESTE ENDEREÇO.";

export const PRIORIDADES = { normal: "Normal", urgente: "Urgente" };
export const STATUS_TAREFA = { aberta: "Aberta", andamento: "Em andamento", concluida: "Concluída", parcial: "Parcial", cancelada: "Cancelada" };
// tarefas que ainda podem ser executadas no coletor
export const tarefaPendente = (t) => t.status === "aberta" || t.status === "andamento";

// ---------- mínimo e máximo do picking ----------
// configurados pelo gestor para cada produto em cada endereço PICKING. Devolve a mensagem de erro ou null.
export function validarLimite({ minimo, maximo }) {
  const min = lerQuantidade(minimo), max = lerQuantidade(maximo);
  if (!quantidadeValida(min)) return `O mínimo tem que ser 0 ou mais (até ${CASAS_DA_QUANTIDADE} casas depois da vírgula).`;
  if (!quantidadeValida(max) || max <= 0) return `O máximo tem que ser maior que zero (até ${CASAS_DA_QUANTIDADE} casas depois da vírgula).`;
  if (min >= max) return "O mínimo tem que ser menor que o máximo.";
  return null;
}

// necessidade de reposição = máximo configurado menos o saldo atual do picking (nunca negativa)
export const necessidade = (saldoPicking, maximo) => Math.max(0, arredondarQtd(maximo - saldoPicking));
// o abastecimento automático dispara quando o saldo atinge ou fica abaixo do mínimo
export const precisaAbastecer = (saldoPicking, minimo) => saldoPicking <= minimo;

// distância entre dois endereços pelas partes da prateleira (rua pesa mais que prédio, que pesa mais que andar…).
// Serve só para desempatar a origem: "o fisicamente mais próximo do picking".
export const distancia = (a, b) =>
  Math.abs(a.rua - b.rua) * 1e9 + Math.abs(a.predio - b.predio) * 1e6 + Math.abs(a.andar - b.andar) * 1e3 + Math.abs(a.apto - b.apto);

// escolhe de quais AÉREOS tirar: o de MENOR saldo primeiro (esvazia posições); empate → o mais perto do picking.
// Se o aéreo não tiver o suficiente, usa todo o saldo disponível. aereos = [{ endereco, saldo }].
// Devolve [{ enderecoId, qtd }] na ordem em que o estoquista vai buscar.
export function escolherOrigens(aereos, quantidade, picking) {
  const ordem = aereos.filter((a) => a.saldo > 0 && a.endereco.ativo)
    .sort((x, y) => x.saldo - y.saldo || distancia(x.endereco, picking) - distancia(y.endereco, picking));
  const origens = [];
  let falta = quantidade;
  for (const a of ordem) {
    if (falta <= 0) break;
    const qtd = Math.min(a.saldo, falta);
    origens.push({ enderecoId: a.endereco.id, qtd });
    falta = arredondarQtd(falta - qtd);
  }
  return origens;
}

// tarefa nova: bloqueia se já houver tarefa aberta (ou em andamento) para o mesmo produto e picking
export const tarefaDuplicada = (tarefas, produto, pickingId) =>
  tarefas.some((t) => tarefaPendente(t) && t.produto === produto && t.pickingId === pickingId);

// tarefas pendentes que usam o endereço (como picking ou como origem ainda por retirar): bloqueiam desativar o endereço
export const tarefasNoEndereco = (tarefas, enderecoId) => tarefas.filter((t) => tarefaPendente(t)
  && (t.pickingId === enderecoId || t.origens.some((o) => o.enderecoId === enderecoId && o.feito < o.qtd))).length;

// fila do coletor: urgentes primeiro; dentro da mesma prioridade, a mais antiga primeiro
export const ordenarTarefas = (tarefas) =>
  [...tarefas].sort((a, b) => (b.prioridade === "urgente") - (a.prioridade === "urgente") || a.id - b.id);

// quanto já foi feito e quanto falta numa tarefa
export const planejadoDaTarefa = (t) => somarQtd(t.origens, (o) => o.qtd);
export const abastecidoDaTarefa = (t) => somarQtd(t.origens, (o) => o.feito);
// próxima origem com algo a retirar (null quando todas foram feitas)
export const proximaOrigem = (t) => t.origens.find((o) => o.feito < o.qtd) || null;

// um passo do abastecimento no coletor: origem, produto, quantidade e destino lidos. Devolve a mensagem ou null.
export function validarAbastecimento(tarefa, { origemId, produto, qtd, destino, saldoOrigem }) {
  const origem = tarefa.origens.find((o) => o.enderecoId === origemId);
  if (!origem) return MSG_ORIGEM_FORA_DA_TAREFA;
  if (produto !== tarefa.produto) return MSG_PRODUTO_DA_TAREFA;
  const quantidade = lerQuantidade(qtd); // "101,5" → 101.5
  if (!quantidadePositiva(quantidade)) return MSG_QUANTIDADE;
  if (quantidade > arredondarQtd(origem.qtd - origem.feito)) return MSG_ACIMA_DO_PLANEJADO;
  if (quantidade > saldoOrigem) return MSG_SALDO_ORIGEM;
  if (!destino) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!destino.ativo) return MSG_ENDERECO_INATIVO;
  if (destino.id !== tarefa.pickingId) return MSG_DESTINO_DA_TAREFA;
  return null;
}

// status depois de cada confirmação: todas as origens feitas → concluída; senão, em andamento
export const statusDepoisDoPasso = (t) => (proximaOrigem(t) ? "andamento" : "concluida");

// ---------- transferência ----------
// "se a quantidade solicitada superar o saldo da origem, o sistema permite transferir somente o saldo disponível"
export const quantidadePermitida = (qtd, saldoOrigem) => Math.min(lerQuantidade(qtd), saldoOrigem);

// origem e destino: qualquer endereço ATIVO (o QR de endereço inativo fica bloqueado no coletor).
// Vale entre PICKING e AÉREO nos dois sentidos, e também tirar da doca.
export function validarTransferencia({ origem, destino, saldoOrigem, qtd }) {
  if (!origem) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!origem.ativo) return MSG_ENDERECO_INATIVO;
  if (!(saldoOrigem > 0)) return MSG_SEM_SALDO_NA_ORIGEM;
  const quantidade = lerQuantidade(qtd); // "101,5" → 101.5
  if (!quantidadePositiva(quantidade)) return MSG_QUANTIDADE;
  if (quantidade > saldoOrigem) return MSG_SALDO_ORIGEM;
  if (!destino) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!destino.ativo) return MSG_ENDERECO_INATIVO;
  if (destino.id === origem.id) return MSG_DESTINO_IGUAL;
  return null;
}

// ---------- estorno da separação ----------
// Quanto a separação de um pedido tirou de cada endereço e ainda não voltou (baixas menos estornos).
// Serve para "separar novamente": o que foi baixado volta para o mesmo endereço antes da nova separação.
// Devolve [{ enderecoId, produto, qtd }] só com o que tem quantidade a devolver.
export function baixadoPorPedido(movimentos, pedido) {
  const soma = new Map();
  for (const m of movimentos) {
    if (m.pedido !== pedido) continue;
    const sinal = m.tipo === "separacao" ? 1 : m.tipo === "estorno-separacao" ? -1 : 0;
    if (!sinal) continue;
    const enderecoId = sinal > 0 ? m.origem : m.destino;
    const chave = `${enderecoId}|${m.produto}`;
    soma.set(chave, (soma.get(chave) || 0) + sinal * m.qtd);
  }
  return [...soma].filter(([, qtd]) => qtd > 0).map(([chave, qtd]) => {
    const [enderecoId, produto] = chave.split("|");
    return { enderecoId: Number(enderecoId), produto, qtd };
  });
}
