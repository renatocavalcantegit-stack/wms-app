// WMS Beach Bike — regras das IMPRESSORAS de etiqueta da rede (v81, decisões de 28/11/2026).
// As impressoras são Argox na rede, com IP; a etiqueta é 80 × 60 mm; quem cadastra é o gestor de estoque.
// O servidor manda a etiqueta direto para a impressora (porta 9100), na linguagem dela. Usado pela Gestão
// (formulário) e pelo servidor (antes de gravar).

export const MODELOS_DE_IMPRESSORA = { "argox-ppla": "Argox PPLA" };
export const PORTA_PADRAO = 9100;
export const MSG_IMPRESSORA_NAO_ENCONTRADA = "IMPRESSORA NÃO ENCONTRADA OU DESATIVADA.";
export const MSG_SEM_REDE_PARA_IMPRIMIR = "SEM REDE: A IMPRESSÃO PRECISA DO WI-FI. TENTE DE NOVO OU IMPRIMA NESTE APARELHO.";
export const msgImpressoraNaoRespondeu = (nome) => `A IMPRESSORA ${String(nome).toUpperCase()} NÃO RESPONDEU. CONFIRA SE ELA ESTÁ LIGADA E NA REDE.`;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const ipValido = (ip) => IPV4.test(String(ip ?? "").trim());

// o que o gestor digitou: devolve a mensagem do primeiro problema, ou null
export function validarImpressora({ nome, ip, porta, modelo, larguraMm, alturaMm }) {
  if (!String(nome ?? "").trim()) return "Informe o nome da impressora.";
  if (String(nome).trim().length > 40) return "Nome com no máximo 40 letras.";
  if (!ipValido(ip)) return "IP inválido. Use o formato 192.168.1.60.";
  const p = Number(porta);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return "Porta inválida (normalmente 9100).";
  if (!MODELOS_DE_IMPRESSORA[modelo]) return "Modelo de impressora inválido.";
  const l = Number(larguraMm), a = Number(alturaMm);
  if (!Number.isInteger(l) || l < 20 || l > 120) return "Largura da etiqueta de 20 a 120 mm.";
  if (!Number.isInteger(a) || a < 20 || a > 200) return "Altura da etiqueta de 20 a 200 mm.";
  return null;
}

// texto que vai para a impressora: sem acento (a Argox imprime só o básico), sem caracteres de controle e curto
export function textoParaEtiqueta(t, max = 40) {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").trim().slice(0, max);
}
