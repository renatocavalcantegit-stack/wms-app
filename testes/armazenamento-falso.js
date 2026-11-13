// localStorage de mentira para os testes: o Node não tem o armazenamento do navegador.
// Guarda tudo num Map e pode ser zerado entre um teste e outro com limparArmazenamento().
const dados = new Map();

const armazenamentoFalso = {
  getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
  setItem: (chave, valor) => dados.set(chave, String(valor)),
  removeItem: (chave) => dados.delete(chave),
  clear: () => dados.clear(),
};

Object.defineProperty(globalThis, "localStorage", { value: armazenamentoFalso, configurable: true, writable: true });

export function limparArmazenamento() {
  dados.clear();
}
