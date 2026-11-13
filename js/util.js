// WMS Beach Bike — atalhos de tela usados por várias páginas.

// primeiro elemento que casa com o seletor CSS (ex.: $("#toast"))
export const $ = (s) => document.querySelector(s);
// todos os elementos que casam com o seletor CSS
export const $$ = (s) => document.querySelectorAll(s);
// escapa texto antes de colocar dentro de HTML (evita que um nome com "<" quebre a tela)
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
