// Carrega os scripts atuais do navegador (data.js, gestao-regras.js, etiqueta.js) dentro do Node.
// Serve para os testes conferirem o comportamento de HOJE, antes da refatoração.
// No navegador esses arquivos penduram objetos em `window`; aqui `window` aponta para o objeto global do Node.
globalThis.window = globalThis;

await import("../data.js");
await import("../gestao-regras.js");
await import("../etiqueta.js");

export const WMS = window.WMS;
export const Regras = window.Regras;
export const Etiqueta = window.Etiqueta;
