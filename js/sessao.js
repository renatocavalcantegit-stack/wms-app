// WMS Beach Bike — login de demonstração e sessão do usuário no aparelho.
// PINs fictícios, apenas para o MVP; no sistema real a autenticação fica no servidor.

// usuários de demonstração (cada perfil acessa só a sua tela)
export const USERS = [
  { login: "separador", nome: "Usuário Separador", perfil: "sep", pin: "1111" },
  { login: "conferente", nome: "Usuário Conferente", perfil: "conf", pin: "2222" },
  { login: "embarque", nome: "Usuário de Embarque", perfil: "emb", pin: "3333" },
  { login: "coordenador", nome: "Usuário Coordenador", perfil: "coord", pin: "4444" },
  { login: "montagem", nome: "Coordenador de Montagem", perfil: "coordmont", pin: "5555" },
];
export const PERFIS = { sep: "Separação", conf: "Conferência", emb: "Embarque", coord: "Gestão de Expedição", coordmont: "Gestão de Montagem" };
// setor onde o separador / conferente está atuando (escolhido no login, trocado pelo perfil)
export const SETORES = { exp: "Expedição", mont: "Montagem" };
export const temSetor = (perfil) => perfil === "sep" || perfil === "conf";

// chave da sessão no armazenamento do navegador (também lida pelos scripts de proteção no topo das páginas)
const SESSION = "wms-bb-session";

export const session = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION));
    return s && USERS.find((u) => u.login === s.login) ? s : null;
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
export const setSetor = (setor) => {
  const s = session(); if (!s) return null;
  s.setor = setor; s.setorDesde = Date.now();
  localStorage.setItem(SESSION, JSON.stringify(s));
  return s;
};
// página de cada perfil
export const homeUrl = (perfil) => ({ conf: "conferencia.html", coord: "gestao.html", coordmont: "montagem.html" }[perfil] || "./");
