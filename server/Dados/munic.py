import csv
import json
from collections import defaultdict

def limpar_nome_cidade(municipio: str) -> str:
    """
    Remove o sufixo ' (RJ)' ou qualquer coisa entre parênteses
    e tira espaços extras.
    Ex.: 'Araruama (RJ)' -> 'Araruama'
    """
    municipio = municipio.strip()
    if "(" in municipio:
        municipio = municipio.split("(")[0].strip()
    return municipio


def csv_to_json_estados_municipios(csv_file: str, json_file: str) -> None:
    # estados[UF] = set de nomes de municípios
    estados = defaultdict(set)

    with open(csv_file, encoding="utf-8") as f:
        # se o arquivo for POP.csv: ano;UF;Municipio;população
        reader = csv.reader(f, delimiter=";")

        primeira_linha = True
        for linha_num, row in enumerate(reader, start=1):
            # pula linhas vazias
            if not row or all(col.strip() == "" for col in row):
                continue

            # pula cabeçalho se tiver
            if primeira_linha:
                primeira_linha = False
                # se começar com "ano", assumimos cabeçalho
                if row[0].lower() == "ano":
                    continue

            # POP.csv esperado: ano;UF;Municipio;população
            if len(row) < 3:
                print(f"[Aviso] Pulando linha {linha_num} (poucas colunas): {row}")
                continue

            # para POP.csv
            if len(row) >= 3:
                # ano = row[0]  # não precisamos
                uf_raw = row[1]
                municipio_raw = row[2]
            else:
                continue

            uf = uf_raw.strip()
            cidade = limpar_nome_cidade(municipio_raw)

            estados[uf].add(cidade)

    # monta estrutura final
    resultado = []
    for uf, municipios_set in estados.items():
        municipios_lista = sorted(municipios_set)
        resultado.append({
            "Estado": uf,
            "municipios": municipios_lista
        })

    # ordena estados por sigla
    resultado.sort(key=lambda x: x["Estado"])

    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(resultado, f, indent=4, ensure_ascii=False)

    print(f"Convertido: {csv_file} → {json_file}")
    print(f"Total de estados: {len(resultado)}")


if __name__ == "__main__":
    # se o seu arquivo for POP.csv:
    csv_to_json_estados_municipios("POP.csv", "estados_municipios.json")
    # se quiser usar MUNICIPIOS.csv, é só ajustar a lógica de leitura acima

