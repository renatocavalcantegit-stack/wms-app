# Gera js/demo-catalogo.js e js/demo-clientes.js a partir das exportações do Sankhya (CSV separado por ";").
# Uso: python ferramentas/gerar-dados-demo.py <pasta com os CSVs>
#   top-1000-produtos-por-segmento.csv  -> produtos mais vendidos (Bike e Moto)
#   ranking-parceiros-por-compras.csv   -> clientes (nomes fictícios), cidade e vendedor
import csv, json, os, sys, unicodedata, random

D = sys.argv[1] if len(sys.argv) > 1 else sys.exit("informe a pasta com os CSVs")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js")
N_BIKE, N_MOTO = 200, 100

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper().strip()
    return " ".join(s.split())

# ---------------- produtos ----------------
prods = {"Bike": [], "Moto": []}
extra = {"Bike": [], "Moto": []}
with open(os.path.join(D, "top-1000-produtos-por-segmento.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f, delimiter=";"):
        seg = r["Segmento"]
        if seg not in prods: continue
        ean = (r["Codigo_de_barras"] or "").split("|")[0].strip()
        if not ean.isdigit() or len(ean) not in (8, 12, 13, 14): ean = ""
        row = [r["Codigo"].strip(), " ".join(r["Descricao"].split()), r["CODVOL"].strip(), ean, round(float((r["Quantidade_vendida"] or "0").replace(",", ".")))]
        lim = N_BIKE if seg == "Bike" else N_MOTO
        (prods if len(prods[seg]) < lim else extra)[seg].append(row)

def js_rows(rows):
    return ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in rows)

cat = f"""// WMS Beach Bike — catálogo de demonstração com os produtos mais vendidos (gerado do Sankhya em 16/11/2026).
// Cada linha: [código interno, descrição, unidade, código de barras (vazio = sem EAN), quantidade vendida no período].
// A ordem é o ranking de vendas: os primeiros são os que mais saem (por isso ficam nos endereços mais perto).
// Arquivo gerado por script — para trocar os produtos, gere de novo em vez de editar à mão.

// segmento Bike: os {N_BIKE} mais vendidos
export const PRODUTOS_BIKE = [
{js_rows(prods["Bike"])},
];

// segmento Moto: os {N_MOTO} mais vendidos
export const PRODUTOS_MOTO = [
{js_rows(prods["Moto"])},
];

// próximos do ranking (ainda fora do catálogo): usados na "importação do ERP" simulada
export const PRODUTOS_NOVOS_DO_ERP = [
{js_rows([extra["Bike"][0], extra["Moto"][0]])},
];
"""
open(os.path.join(OUT, "demo-catalogo.js"), "w", encoding="utf-8", newline="\n").write(cat)

# ---------------- clientes ----------------
# cidade (sem acento, maiúscula) -> (nome com acento, rota). Rota None = cliente sem rota cadastrada.
R = {}
def add(rota, nomes):
    for n in nomes.split(","):
        n = n.strip()
        R[norm(n)] = (n, rota)
add("eusebio", "Eusébio, Aquiraz")
add("caucaia", "Caucaia")
add("maracanau", "Maracanaú, Pacatuba, Guaiúba")
add("maranguape", "Maranguape, Palmácia, Baturité, Aratuba, Redenção, Acarape, Aracoiaba, Barreira, Pacoti")
add("itaitinga", "Itaitinga")
add("horizonte", "Horizonte, Pacajus, Ocara")
add("cascavel", "Cascavel, Beberibe, Pindoretama")
add("cearatransp", "Sobral, Granja, Santa Quitéria, Crateús, Camocim, Martinópole, Viçosa do Ceará, Uruoca, Tamboril, Novo Oriente, "
    "Mucambo, Monsenhor Tabosa, Frecheirinha, Barroquinha, Tianguá, Ibiapina, Guaraciaba do Norte, Groaíras, Irauçuba, Independência, "
    "Reriutaba, Poranga, Ipueiras, Ipu, Ipaporanga, Hidrolândia, Cariré, Croatá, Chaval, Alcântaras, Varjota, Ubajara, Senador Sá, "
    "São Benedito, Quiterianópolis, Pacujá, Nova Russas, Moraújo, Graça, Forquilha, Coreaú, Catunda, Ararendá, Jijoca de Jericoacoara")
add("megafrete", "Juazeiro do Norte, Icó, Iguatu, Acopiara, Potengi, Missão Velha, Jucás, Araripe, Parambu, Assaré, Orós, Nova Olinda, "
    "Milagres, Mauriti, Barbalha, Jardim, Farias Brito, Campos Sales, Cedro, Caririaçu, Brejo Santo, Barro, Aurora, Altaneira, "
    "Várzea Alegre, Umari, Salitre, Quixelô, Porteiras, Penaforte, Jati, Ipaumirim, Crato, Catarina, Cariús, Antonina do Norte, Aiuaba, Mombaça")
add("nortlog", "Acaraú, Itarema, Trairi, Paracuru, Itapipoca, Cruz, Bela Cruz, Uruburetama, Umirim, Tururu, São Luís do Curu, Paraipaba, "
    "Itapajé, Amontada, Morrinhos, São Gonçalo do Amarante, Apuiarés, General Sampaio")
add("fp", "Quixadá, Russas, Aracati, Quixeramobim, Morada Nova, Limoeiro do Norte, Jaguaribe, Jaguaribara, Quixeré, Potiretama, Jaguaruana, "
    "Tabuleiro do Norte, Senador Pompeu, Milhã, Jaguaretama, Ibicuitinga, Fortim, Alto Santo, Ibaretama, Icapuí, Solonópole, Piquet Carneiro, "
    "Pereiro, Iracema, Ererê, Deputado Irapuan Pinheiro, Banabuiú, Itapiúna, Boa Viagem, Madalena, Pedra Branca, Canindé, Paramoti, Caridade, Itatira")
R["ITAPAGE"] = ("Itapajé", "nortlog")
R["FORTALEZA"] = ("Fortaleza", "fortaleza")  # Centro ou Messejana, decidido abaixo

VEND = {"EDSON FREITAS": "Edson Freitas", "GILVAN": "Gilvan", "ATILA": "Átila", "THIAGO": "Thiago", "RICARDO": "Ricardo",
        "ROMARIO": "Romário", "TIAGO BEZERRA": "Tiago Bezerra", "ALACIR": "Alacir", "AQUINO": "Aquino", "VALDINEY": "Valdiney",
        "IGOR RAFAEL": "Igor Rafael", "JOAO ALFONSO": "João Alfonso", "JUNIOR MELO": "Júnior Melo"}
# vendedores de cada rota (combinado com o usuário); usado só quando o cliente não tem um vendedor válido
POR_ROTA = {
    "centro": ["Ricardo", "Edson Freitas", "Thiago", "Tiago Bezerra", "Gilvan"],
    "eusebio": ["Ricardo", "Edson Freitas", "Thiago", "Tiago Bezerra", "Gilvan"],
    "caucaia": ["Gilvan", "Valdiney", "Thiago", "Edson Freitas", "Tiago Bezerra", "João Alfonso"],
    "maracanau": ["Gilvan", "Valdiney", "Thiago", "Edson Freitas", "Tiago Bezerra", "João Alfonso"],
    "maranguape": ["Gilvan", "Valdiney", "Thiago", "Edson Freitas", "Tiago Bezerra", "João Alfonso"],
    "cearatransp": ["Romário", "Igor Rafael", "Alacir", "Aquino", "Júnior Melo", "João Alfonso", "Átila"],
    "megafrete": ["Romário", "Igor Rafael", "Alacir", "Aquino", "Júnior Melo", "João Alfonso", "Átila"],
    "fp": ["Romário", "Igor Rafael", "Alacir", "Aquino", "Júnior Melo", "João Alfonso", "Átila"],
    "messejana": ["Gilvan", "Thiago", "Edson Freitas"],
    "nortlog": ["Átila", "Júnior Melo", "Aquino"],
    "itaitinga": ["Ricardo", "Thiago", "Edson Freitas"],
    "horizonte": ["Ricardo", "Thiago", "Edson Freitas"],
    "cascavel": ["Ricardo", "Thiago", "Edson Freitas"],
}
rnd = random.Random(1226)
clientes, sem = [], {}
with open(os.path.join(D, "ranking-parceiros-por-compras.csv"), encoding="utf-8-sig") as f:
    for r in csv.DictReader(f, delimiter=";"):
        if not r["Código"].startswith("P"): continue
        key = norm(r["Cidade"])
        cidade, rota = R.get(key, (r["Cidade"].strip().title(), None))
        if rota is None: sem[key] = sem.get(key, 0) + 1
        v = VEND.get(norm(r["Vendedor"]))
        if rota == "fortaleza":
            rota = "messejana" if (v in POR_ROTA["messejana"] and rnd.random() < 0.35) else "centro"
        if v is None: v = rnd.choice(POR_ROTA.get(rota, POR_ROTA["centro"]))
        clientes.append([r["Código"], r["Nome"].strip(), cidade, r["Bairro"].strip(), v, rota])

cli = """// WMS Beach Bike — clientes de demonstração (parceiros do ranking de compras, com nomes e endereços fictícios).
// Cada linha: [código, nome, cidade, bairro, vendedor, rota]. A ordem é o ranking: os primeiros compram mais.
// A rota vem da cidade (tabela no script gerador); null = cliente sem rota cadastrada.
// Arquivo gerado por script — para trocar os clientes, gere de novo em vez de editar à mão.
export const CLIENTES = [
""" + js_rows(clientes) + ",\n];\n"
open(os.path.join(OUT, "demo-clientes.js"), "w", encoding="utf-8", newline="\n").write(cli)

from collections import Counter
print("produtos", len(prods["Bike"]), len(prods["Moto"]), "sem EAN", sum(1 for s in prods.values() for x in s if not x[3]))
print("clientes", len(clientes), Counter(c[5] for c in clientes))
print("sem rota", sem)
