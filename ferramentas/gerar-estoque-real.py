# Gera js/demo-estoque-real.js a partir da planilha de estoque do WMS do Sankhya (Estoque_WMS_com_codigos_de_barras.xlsx).
# Uso: python ferramentas/gerar-estoque-real.py <caminho do .xlsx>
# Colunas esperadas: Endereço (ID do QR) | Rua | Prédio | Andar | Apto | End.Padrão | Cod.Prod | Produto | Grupo | Saldo
#                    | Código de barras (opcional; vários separados por "/")
# Lê o .xlsx só com a biblioteca padrão do Python (o .xlsx é um zip de XMLs), sem instalar nada.
import os, re, sys, zipfile
import xml.etree.ElementTree as ET

ARQ = sys.argv[1] if len(sys.argv) > 1 else sys.exit("informe o caminho do Estoque_WMS.xlsx")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "demo-estoque-real.js")
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

def linhas_da_primeira_aba(caminho):
    z = zipfile.ZipFile(caminho)
    textos = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si"):
            textos.append("".join(t.text or "" for t in si.iter(M + "t")))
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(M + "row"):
        lin = {}
        for c in row.iter(M + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find(M + "v")
            if c.get("t") == "s": lin[col] = textos[int(v.text)] if v is not None else ""
            elif c.get("t") == "inlineStr": lin[col] = "".join(x.text or "" for x in c.iter(M + "t"))
            else: lin[col] = v.text if v is not None else ""
        yield lin

linhas = list(linhas_da_primeira_aba(ARQ))
cab = [linhas[0].get(c, "").strip() for c in "ABCDEFGHIJ"]
if not cab[0].startswith("Endere") or cab[6] != "Cod.Prod":
    sys.exit(f"cabeçalho inesperado: {cab}")

# códigos de barras da célula: vários separados por "/". Parte SUJA (letras ou símbolos, como "ssss",
# o prefixo "[C1" do leitor ou um apóstrofo) é descartada e os códigos bons da mesma célula ficam
# (ex.: "8019227210712 / ssss" → 8019227210712). Sem nenhuma parte boa, o produto entra sem código de
# barras e, por isso, com o checkout desligado até o cadastro ser corrigido. Números de qualquer tamanho
# são mantidos (há produto com o EAN e a referência do fabricante, ex.: "0789600815282 / 1050064").
sujos = {}
def codigos_de_barras(celula, produto):
    texto = (celula or "").strip()
    if not texto: return []
    partes = [x.strip() for x in texto.split("/")]
    bons = [x for x in partes if re.fullmatch(r"\d+", x)]
    if len(bons) < len(partes): sujos[produto] = texto
    return list(dict.fromkeys(bons))  # sem repetir

def numero(s):
    f = float(s)
    return int(f) if f == int(f) else round(f, 3)

enderecos, produtos, saldos, vistos = {}, {}, {}, set()
for r in linhas[1:]:
    if not r.get("A") or not r.get("G"): continue
    # a exportação repete linhas idênticas (mesmo endereço, produto e saldo): conta uma vez só
    chave_linha = tuple(r.get(c, "") for c in "ABCDEFGHIJ")
    if chave_linha in vistos: continue
    vistos.add(chave_linha)
    eid = int(r["A"])
    enderecos[eid] = [eid, int(r["B"]), int(r["C"]), int(r["D"]), int(r["E"])]
    cod = r["G"].strip()
    produtos.setdefault(cod, [cod, " ".join(r["H"].split()), (r.get("I") or "").strip() or "-", codigos_de_barras(r.get("K"), cod)])
    s = saldos.setdefault((eid, cod), [eid, cod, 0, 0])
    s[2] += numero(r["J"])           # mesmo produto no mesmo endereço em mais de uma linha: soma
    if r["F"] == "VERDADEIRO": s[3] = 1  # endereço padrão (picking) do produto
for s in saldos.values():
    s[2] = round(s[2], 3)

def linhas_js(lst):
    import json
    return ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in lst)

js = f"""// WMS Beach Bike — estoque real do WMS do Sankhya (planilha Estoque_WMS.xlsx de 17/11/2026).
// Endereços com as etiquetas que já estão nas prateleiras: o QR traz o ID (1ª coluna).
// Arquivo gerado por ferramentas/gerar-estoque-real.py — para atualizar, gere de novo em vez de editar à mão.

// [ID do endereço (QR), rua, prédio, andar, apartamento]
export const ENDERECOS_REAIS = [
{linhas_js(sorted(enderecos.values()))},
];

// [código do produto, descrição, grupo, [códigos de barras; o 1º é o principal; vazio = sem código (granel)]]
export const PRODUTOS_REAIS = [
{linhas_js(sorted(produtos.values(), key=lambda p: int(p[0]) if p[0].isdigit() else 10**9))},
];

// [ID do endereço, código do produto, saldo, 1 = endereço padrão (picking) do produto]
export const SALDOS_REAIS = [
{linhas_js(sorted(saldos.values(), key=lambda s: (s[0], s[1])))},
];
"""
open(OUT, "w", encoding="utf-8", newline="\n").write(js)
print("células com parte suja (descartada):", sujos)
print(f"{len(enderecos)} endereços, {len(produtos)} produtos, {len(saldos)} saldos -> {os.path.relpath(OUT)}")
