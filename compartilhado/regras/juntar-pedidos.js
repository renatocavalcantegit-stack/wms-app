// WMS Beach Bike — junção da lista do coletor com a do servidor (Fase 1d). Sem tela e sem rede: só a decisão.
//
// O servidor é a fonte da verdade: todos os aparelhos veem o mesmo pedido. Mas o coletor nunca perde
// o que o separador fez sem rede. Pedido por pedido:
//   - tem ação na fila do aparelho (ainda não chegou ao servidor)  → fica a versão do APARELHO
//   - senão                                                         → fica a versão do SERVIDOR,
//     com o andamento de tela do aparelho (em que item parou, endereço e produto já confirmados)
//   - existe só no aparelho e não tem ação na fila                  → sai (ex.: concluído ontem, demonstração antiga)
// Os lotes saem dos próprios pedidos (cada pedido diz o lote e a caixa). O lote com pedido que ficou na versão
// do aparelho fica como está no aparelho.

// andamento de tela: só existe no aparelho, o servidor não sabe (e não precisa saber)
const ANDAMENTO_DE_TELA = ["atual", "endOk", "prodOk"];

// locais / doServidor = pedidos no formato do coletor · lotesLocais = lotes do aparelho
// comFila = Set com os IDs dos pedidos que têm ação na fila de envio
// Devolve { pedidos, lotes }.
export function juntarComServidor({ locais, lotesLocais = [], doServidor, comFila = new Set() }) {
  const local = new Map(locais.map((o) => [o.id, o]));
  const vemDoAparelho = new Set();

  const pedidos = doServidor.map((s) => {
    const l = local.get(s.id);
    if (l && comFila.has(s.id)) { vemDoAparelho.add(s.id); return l; }
    if (!l) return s;
    const tela = Object.fromEntries(ANDAMENTO_DE_TELA.filter((k) => l[k] != null).map((k) => [k, l[k]]));
    return { ...s, ...tela };
  });
  // feito só no aparelho e ainda na fila (o servidor não conhece): fica
  const noServidor = new Set(doServidor.map((s) => s.id));
  for (const l of locais) if (!noServidor.has(l.id) && comFila.has(l.id)) { vemDoAparelho.add(l.id); pedidos.push(l); }

  return { pedidos, lotes: lotesDosPedidos(pedidos, lotesLocais, vemDoAparelho) };
}

// Monta os lotes a partir dos pedidos (campo lote + caixa). Se algum pedido do lote ficou na versão do aparelho,
// o lote também fica como está no aparelho. Do lote do aparelho também vêm quem montou e o andamento de tela.
export function lotesDosPedidos(pedidos, lotesLocais = [], vemDoAparelho = new Set()) {
  const local = new Map(lotesLocais.map((l) => [l.id, l]));
  const grupos = Map.groupBy(pedidos.filter((o) => o.lote), (o) => o.lote);
  return [...grupos].map(([id, ps]) => {
    const ll = local.get(id);
    if (ll && ps.some((o) => vemDoAparelho.has(o.id))) return ll;
    const ordem = [...ps].sort((a, b) => String(a.pos).localeCompare(String(b.pos)));
    const inicios = ps.map((o) => o.inicio).filter(Boolean), fins = ps.map((o) => o.fim).filter(Boolean);
    const lote = {
      id,
      pedidos: ordem.map((o) => o.id),
      posicoes: Object.fromEntries(ordem.map((o) => [o.id, o.pos])),
      status: statusDoLote(ps),
      // quem montou: o aparelho sabe; sem ele, é o lote planejado pelo coordenador
      criadoPor: ll?.criadoPor ?? { tipo: "coordenador", login: null, nome: "Coordenador" },
      criado: ll?.criado ?? null,
      inicio: inicios.length ? Math.min(...inicios) : null,
      fim: fins.length === ps.length ? Math.max(...fins) : null,
      operador: ps.find((o) => o.operador)?.operador ?? null,
      atual: ll?.atual ?? 0,
    };
    for (const k of ["endOk", "prodOk"]) if (ll?.[k] != null) lote[k] = ll[k];
    return lote;
  });
}

// todos concluídos → concluido · nenhum começou → pendente · senão → andamento
export function statusDoLote(pedidos) {
  if (pedidos.every((o) => o.status === "concluido")) return "concluido";
  if (pedidos.every((o) => o.status === "pendente")) return "pendente";
  return "andamento";
}

// o pedido está em separação com OUTRO separador (o coletor mostra "Com Fulano" e não deixa abrir)
export const comOutroSeparador = (o, login) =>
  o.status === "andamento" && !!o.separadorLogin && o.separadorLogin !== login;

// Pedidos que CHEGARAM na fila do separador desde a última lista (o coletor toca o som de pedido novo).
// antes = IDs que já estavam no aparelho · depois = pedidos da lista nova. Só conta o que ainda não começou.
export const pedidosNovosNaFila = (antes, depois) => {
  const tinha = new Set(antes);
  return depois.filter((o) => o.status === "pendente" && !tinha.has(o.id)).map((o) => o.id);
};
