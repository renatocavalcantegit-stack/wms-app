// WMS Beach Bike — login e sessão do usuário no aparelho.
// Dois jeitos de entrar:
//   - demonstração (GitHub Pages): PINs fictícios desta lista, conferidos no próprio aparelho;
//   - com servidor (Fase 1b): o servidor confere o PIN e devolve um token. O token vai na sessão
//     e acompanha cada envio da fila. A sessão vale o turno no aparelho, mesmo se a rede cair.

// usuários de demonstração (cada perfil acessa só a sua tela)
export const USERS = [
  { login: "separador", nome: "Usuário Separador", perfil: "sep", pin: "1111" },
  { login: "conferente", nome: "Usuário Conferente", perfil: "conf", pin: "2222" },
  { login: "embarque", nome: "Usuário de Embarque", perfil: "emb", pin: "3333" },
  { login: "coordenador", nome: "Usuário Coordenador", perfil: "coord", pin: "4444" },
  { login: "montagem", nome: "Coordenador de Montagem", perfil: "coordmont", pin: "5555" },
  { login: "estoquista", nome: "Usuário Estoquista", perfil: "estq", pin: "6666" },
  { login: "gestorestoque", nome: "Gestor de Estoque", perfil: "gest", pin: "7777" },
];
export const PERFIS = { sep: "Separação", conf: "Conferência", emb: "Embarque", coord: "Gestão de Expedição", coordmont: "Gestão de Montagem", estq: "Estoque", gest: "Gestão de Estoque" };
// setor onde o separador / conferente está atuando (escolhido no login, trocado pelo perfil)
export const SETORES = { exp: "Expedição", mont: "Montagem" };
export const temSetor = (perfil) => perfil === "sep" || perfil === "conf";

// chave da sessão no armazenamento do navegador (também lida pelos scripts de proteção no topo das páginas)
const SESSION = "wms-bb-session";

export const session = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION));
    // sessão do servidor (tem token) vale para qualquer usuário cadastrado lá; a de demonstração, só para esta lista
    return s && (s.token || USERS.find((u) => u.login === s.login)) ? s : null;
  } catch { return null; }
};
export const login = (user, pin) => {
  const u = USERS.find((x) => x.login === String(user).trim().toLowerCase() && x.pin === String(pin).trim());
  if (!u) return null;
  const s = { login: u.login, nome: u.nome, perfil: u.perfil, desde: Date.now() };
  localStorage.setItem(SESSION, JSON.stringify(s));
  return s;
};
export const logout = () => localStorage.removeItem(SESSION);

// ---------- com servidor ----------

// O app está sendo servido pelo servidor do WMS? O arquivo modo.json responde:
// no GitHub Pages é o arquivo do repositório ({ servidor: false }); o servidor do WMS responde { servidor: true }.
// Sem rede, o service worker devolve a cópia guardada, então a resposta vale também offline.
export async function temServidor(buscar = fetch) {
  try {
    const r = await buscar("modo.json", { cache: "no-cache" });
    return r.ok && (await r.json()).servidor === true;
  } catch { return false; }
}

// Login no servidor: o PIN vai para o servidor conferir (nunca é guardado no aparelho).
// Devolve { ok: true, sessao } ou { ok: false, erro: "pin" | "sem-rede" | "servidor" }.
// O primeiro login do turno precisa de rede; depois, a sessão fica no aparelho.
export async function loginNoServidor(user, pin, buscar = fetch) {
  let r;
  try {
    r = await buscar("api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: String(user).trim().toLowerCase(), pin: String(pin).trim() }),
    });
  } catch { return { ok: false, erro: "sem-rede" }; }
  if (r.status === 401 || r.status === 400) return { ok: false, erro: "pin" };
  if (!r.ok) return { ok: false, erro: "servidor" };
  const { token, expiraEm, login, nome, perfil } = await r.json();
  const s = { login, nome, perfil, token, expiraEm, desde: Date.now() };
  localStorage.setItem(SESSION, JSON.stringify(s));
  return { ok: true, sessao: s };
}
export const setSetor = (setor) => {
  const s = session(); if (!s) return null;
  s.setor = setor; s.setorDesde = Date.now();
  localStorage.setItem(SESSION, JSON.stringify(s));
  return s;
};
// página de cada perfil
export const homeUrl = (perfil) =>
  ({ conf: "conferencia.html", coord: "gestao.html", coordmont: "montagem.html", estq: "estoque.html", gest: "gestao-estoque.html" }[perfil] || "./");
