import csv
import json
from collections import defaultdict
from pathlib import Path

def limpar_nome_cidade(municipio: str) -> str:
    """
    Remove o sufixo ' (RJ)' ou qualquer coisa entre parênteses
    e tira espaços extras.
    """
    municipio = municipio.strip()
    if "(" in municipio:
        municipio = municipio.split("(")[0].strip()
    return municipio


def csv_to_json_por_estado(csv_file: str, output_dir: str = ".") -> None:
    # cidades_por_estado[UF][cidade] = lista de {ano, população}
    cidades_por_estado = defaultdict(lambda: defaultdict(list))

    with open(csv_file, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")

        primeira_linha = True
        for linha_num, row in enumerate(reader, start=1):
            # pula linhas vazias
            if not row or all(col.strip() == "" for col in row):
                continue

            # se tiver cabeçalho "ano;UF;Municipio;população", pula
            if primeira_linha:
                primeira_linha = False
                if row[0].lower() == "ano":
                    continue

            if len(row) != 4:
                print(f"[Aviso] Pulando linha {linha_num} (colunas inesperadas): {row}")
                continue

            ano_str, uf_raw, municipio_raw, pop_str = row

            uf = uf_raw.strip()
            cidade = limpar_nome_cidade(municipio_raw)

            # converter ano
            try:
                ano = int(ano_str)
            except ValueError:
                print(f"[Aviso] Ano inválido na linha {linha_num}: {ano_str}")
                continue

            # filtrar faixa de anos
            if not (2000 <= ano <= 2060):
                continue

            # converter população
            try:
                pop = int(pop_str.replace(".", "").replace(",", "").strip())
            except ValueError:
                print(f"[Aviso] População inválida na linha {linha_num}: {pop_str}")
                continue

            cidades_por_estado[uf][cidade].append({
                "ano": ano,
                "população": pop
            })

    # garantir que a pasta de saída existe
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # gerar um JSON por estado
    for uf, cidades in cidades_por_estado.items():
        resultado = []
        for cidade, historico in cidades.items():
            historico_ordenado = sorted(historico, key=lambda x: x["ano"])
            resultado.append({
                "Estado": uf,
                "Nome da cidade": cidade,
                "historico": historico_ordenado
            })

        # ordenar cidades por nome
        resultado.sort(key=lambda x: x["Nome da cidade"])

        json_filename = output_path / f"{uf}_populacao_2000_2060.json"
        with open(json_filename, "w", encoding="utf-8") as f:
            json.dump(resultado, f, indent=4, ensure_ascii=False)

        print(f"Gerado arquivo para {uf}: {json_filename} ({len(resultado)} cidades)")


if __name__ == "__main__":
    # ajusta o nome do CSV e a pasta de saída se quiser
    csv_to_json_por_estado("POP.csv", "estados_json")

