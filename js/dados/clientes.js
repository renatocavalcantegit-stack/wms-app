// WMS Beach Bike — camada de dados do cadastro de clientes (endereço de entrega e rota).
// Só este arquivo sabe DE ONDE vem o cadastro do cliente.
// Hoje: clientes de demonstração (js/demo-clientes.js: cidade, bairro e rota). Rua e número são FICTÍCIOS,
// sorteados sempre do mesmo jeito a partir do nome (o mesmo cliente sai sempre com o mesmo endereço).
// Com o Sankhya: o endereço e a rota chegam no próprio pedido (o.entrega / o.rota) e este cadastro vira só reserva.
import { CLIENTES } from "../demo-clientes.js";
import { rota } from "../../compartilhado/regras/rotas.js";

const RUAS = ["Rua das Acácias", "Av. Beira Mar", "Rua Padre Cícero", "Rua dos Coqueiros", "Av. Santos Dumont", "Rua Dom Pedro I",
  "Rua das Jangadas", "Av. Bezerra de Menezes", "Rua Major Facundo", "Rua do Sol", "Av. Washington Soares", "Rua Barão do Rio Branco",
  "Rua das Gaivotas", "Av. Dom Luís", "Rua São Francisco", "Rua da Praia"];

// número sempre igual para o mesmo texto (não é aleatório de verdade)
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const porNome = new Map(CLIENTES.map(([, nome, cidade, bairro, , rotaId]) => [nome, { cidade, bairro, rota: rotaId }]));
// cliente fora do cadastro: usa a rota e um bairro de outro cliente da mesma cidade
const porCidade = new Map();
CLIENTES.forEach(([, , cidade, bairro, , rotaId]) => { if (rotaId && !porCidade.has(cidade)) porCidade.set(cidade, { bairro, rota: rotaId }); });

// cadastro do cliente do pedido: { bairro, rua, numero, rota } (null quando não há cliente, ex.: ordem de produção)
export function cadastroDoCliente(o) {
  const cidade = String(o.cidade || "").split("·")[0].trim();
  const base = porNome.get(o.cliente) || porCidade.get(cidade);
  if (!base) return null;
  const h = hash(o.cliente);
  return { bairro: base.bairro, rua: RUAS[h % RUAS.length], numero: String(10 + (h % 2990)), rota: base.rota };
}

// nome da rota pelo código (ex.: "messejana" → "Messejana")
export const nomeDaRota = (id) => rota(id)?.nome || null;
