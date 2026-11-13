// WMS Beach Bike — observação dos volumes (conferência → Sankhya / embarque).
// Funções puras: usadas pela Conferência, pelo Embarque e, depois, pelo servidor.

// tipos de volume: [id, nome na tela, abreviação enviada ao ERP]
export const VOL_TIPOS = [
  ["caixa", "Caixa", "CX"], ["sacola", "Sacola", "SAC"], ["pneu", "Pneu", "PNEU"], ["aro", "Aro", "ARO"],
  ["pneuaro", "Pneu + aro", "PNEU+ARO"], ["quadro", "Quadro", "QUADRO"], ["bike", "Bicicleta", "BIC"],
  ["amarrado", "Amarrado", "AMARRADO"], ["outro", "Outro", ""],
];

// maiúsculas, sem acento e sem espaços repetidos (o texto do ERP não aceita acentos)
export const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// linhas [qtd, nome, abreviação] na ordem do cadastro
export const obsLinhas = (obs) => VOL_TIPOS.filter(([id]) => obs && obs.tipos && obs.tipos[id] > 0)
  .map(([id, nome, ab]) => [obs.tipos[id], id === "outro" ? obs.outro || "Outro" : nome, id === "outro" ? semAcento(obs.outro) || "OUTRO" : ab]);

// total de volumes descritos (tem que bater com a quantidade de volumes do pedido)
export const obsTotal = (obs) => (obs && obs.tipos ? Object.values(obs.tipos).reduce((t, n) => t + (n || 0), 0) : 0);

// texto gravado na observação do pedido no Sankhya (vai para os dados adicionais da NF-e)
export const obsErp = (obs) => {
  if (!obs) return "";
  const t = obsTotal(obs);
  let s = `[WMS] VOLUMES: ${obsLinhas(obs).map(([n, , ab]) => `${n} ${ab}`).join(" + ")} = ${t} VOL.`;
  if (obs.atencao) s += ` | ATENCAO: ${semAcento(obs.atencao)}`;
  return s;
};

// resumo curto mostrado nas telas (ex.: "2 Caixa · 1 Pneu + aro")
export const obsResumo = (obs) => obsLinhas(obs).map(([n, nome]) => `${n} ${nome}`).join(" · ");
