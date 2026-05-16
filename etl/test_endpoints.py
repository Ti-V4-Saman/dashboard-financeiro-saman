#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
etl/test_endpoints.py
Script de diagnostico rapido -- testa cada endpoint da API ContaAzul.

Uso:
    python -m etl.test_endpoints
"""

import sys
import os
import time
import logging
from datetime import date, timedelta

# Forcar encoding UTF-8 no terminal do Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.WARNING, format="%(message)s")

from etl.auth import get_access_token
from etl.client import ContaAzulClient

TODAY           = date.today().strftime("%Y-%m-%d")
THIRTY_DAYS_AGO = (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def test_paginado(client, path, extra=None):
    """Testa endpoint paginado. Retorna (status, contagem, tempo)."""
    t0 = time.monotonic()
    try:
        items = client.get_all(path, extra_params=extra or None)
        elapsed = time.monotonic() - t0
        count = len(items)
        if count > 0:
            return f"{GREEN}OK{RESET}", count, elapsed
        return f"{YELLOW}VAZIO{RESET}", 0, elapsed
    except Exception as e:
        elapsed = time.monotonic() - t0
        return f"{RED}ERRO{RESET}", str(e)[:60], elapsed


def test_probe(client, path, extra=None):
    """Testa se endpoint existe (probe). Retorna (status, contagem, tempo)."""
    t0 = time.monotonic()
    try:
        disponivel = client.probe(path, params=extra or None)
        elapsed = time.monotonic() - t0
        if disponivel:
            return f"{GREEN}DISPONIVEL{RESET}", "-", elapsed
        return f"{YELLOW}INDISPONIVEL{RESET}", "-", elapsed
    except Exception as e:
        elapsed = time.monotonic() - t0
        return f"{RED}ERRO{RESET}", str(e)[:60], elapsed


def linha(label, status, count, elapsed, col=36):
    count_str = f"{count:>10}" if isinstance(count, int) else f"{'--':>10}"
    print(f"  {label:<{col}} {status:<30} {count_str}  {elapsed:>5.1f}s")


def main():
    print()
    print("=" * 65)
    print("  Diagnostico de Endpoints -- ContaAzul API")
    print("=" * 65)
    print(f"  Periodo: {THIRTY_DAYS_AGO} -> {TODAY}")
    print()

    try:
        token = get_access_token()
        print(f"  {GREEN}[OK]{RESET} Autenticacao bem-sucedida")
        print()
    except Exception as e:
        print(f"  {RED}[ERRO]{RESET} Falha na autenticacao: {e}")
        sys.exit(1)

    client = ContaAzulClient(token)

    # ── Cadastros ─────────────────────────────────────────────────────────────
    print(f"  {BOLD}{CYAN}[1] CADASTROS{RESET}")
    print(f"  " + "-" * 62)
    linha("Categorias RECEITA",
          *test_paginado(client, "/categorias", {"tipo": "RECEITA"}))
    linha("Categorias DESPESA",
          *test_paginado(client, "/categorias", {"tipo": "DESPESA"}))
    linha("Centros de Custo",
          *test_paginado(client, "/centro-de-custo"))
    linha("Contas Financeiras",
          *test_paginado(client, "/conta-financeira"))
    linha("Produtos /produto/busca",
          *test_paginado(client, "/produto/busca"))
    linha("Servicos /servicos",
          *test_paginado(client, "/servicos"))

    # ── Pessoas ───────────────────────────────────────────────────────────────
    print()
    print(f"  {BOLD}{CYAN}[2] PESSOAS{RESET}")
    print(f"  " + "-" * 62)
    linha("Clientes + Fornecedores",
          *test_paginado(client, "/pessoas"))

    # ── Financeiro principal ──────────────────────────────────────────────────
    print()
    print(f"  {BOLD}{CYAN}[3] FINANCEIRO PRINCIPAL{RESET}")
    print(f"  " + "-" * 62)
    linha("Contas a Receber (30d)",
          *test_paginado(client,
              "/financeiro/eventos-financeiros/contas-a-receber/buscar",
              {"data_vencimento_de": THIRTY_DAYS_AGO, "data_vencimento_ate": TODAY}))
    linha("Contas a Pagar (30d)",
          *test_paginado(client,
              "/financeiro/eventos-financeiros/contas-a-pagar/buscar",
              {"data_vencimento_de": THIRTY_DAYS_AGO, "data_vencimento_ate": TODAY}))
    linha("Vendas (30d)",
          *test_paginado(client, "/venda/busca",
              {"data_inicio": THIRTY_DAYS_AGO, "data_fim": TODAY}))

    # ── Financeiro complementar ───────────────────────────────────────────────
    print()
    print(f"  {BOLD}{CYAN}[4] FINANCEIRO COMPLEMENTAR (com probe){RESET}")
    print(f"  " + "-" * 62)
    linha("Transferencias (30d)",
          *test_paginado(client, "/financeiro/transferencias",
              {"data_inicio": THIRTY_DAYS_AGO, "data_fim": TODAY}))
    linha("Baixas /financeiro/baixas",
          *test_probe(client, "/financeiro/baixas",
              {"data_de": THIRTY_DAYS_AGO, "data_ate": TODAY}))

    # ── Opcionais (probe apenas) ──────────────────────────────────────────────
    print()
    print(f"  {BOLD}{CYAN}[5] OPCIONAIS -- probe de existencia{RESET}")
    print(f"  " + "-" * 62)

    # Paths corretos conforme documentacao oficial developers.contaazul.com
    opcionais = [
        ("Contratos /contratos",              "/contratos",             None),
        ("NF produto /notas-fiscais",          "/notas-fiscais",         None),
        ("NF servico /notas-fiscais-servico",  "/notas-fiscais-servico", None),
        ("Baixas (por parcela)",
             "/financeiro/eventos-financeiros/parcelas/baixa/probe", None),
    ]
    for label, path, extra in opcionais:
        linha(label, *test_probe(client, path, extra))

    # ── Testes profundos ──────────────────────────────────────────────────────
    print()
    print(f"  {BOLD}{CYAN}[6] TESTES PROFUNDOS (1 amostra){RESET}")
    print(f"  " + "-" * 62)

    # Itens de venda
    try:
        vendas = client.get_all("/venda/busca",
                                extra_params={"data_inicio": THIRTY_DAYS_AGO, "data_fim": TODAY})
        if vendas:
            vid = vendas[0].get("id")
            t0 = time.monotonic()
            resp = client.get(f"/venda/{vid}/itens")
            elapsed = time.monotonic() - t0
            count = len(resp) if isinstance(resp, list) else (
                len((resp or {}).get("itens") or (resp or {}).get("items") or []) if resp else 0
            )
            print(f"  GET /venda/{{id}}/itens          "
                  f"{GREEN}OK{RESET}  {count} item(ns) em {str(vid)[:8]}...  {elapsed:.1f}s")
        else:
            print(f"  {YELLOW}Sem vendas no periodo para testar itens{RESET}")
    except Exception as e:
        print(f"  {RED}Erro itens venda: {e}{RESET}")

    # Parcelas
    try:
        cr = client.get_all(
            "/financeiro/eventos-financeiros/contas-a-receber/buscar",
            extra_params={"data_vencimento_de": THIRTY_DAYS_AGO, "data_vencimento_ate": TODAY})
        if cr:
            eid = cr[0].get("id")
            t0 = time.monotonic()
            resp = client.get(f"/financeiro/eventos-financeiros/parcelas/{eid}")
            elapsed = time.monotonic() - t0
            raw_list = resp if isinstance(resp, list) else (
                ((resp or {}).get("parcelas") or (resp or {}).get("items") or [resp]) if resp else []
            )
            print(f"  GET /parcelas/{{evento_id}}      "
                  f"{GREEN}OK{RESET}  {len(raw_list)} parcela(s) em {str(eid)[:8]}...  {elapsed:.1f}s")
        else:
            print(f"  {YELLOW}Sem eventos a receber no periodo{RESET}")
    except Exception as e:
        print(f"  {RED}Erro parcelas: {e}{RESET}")

    # ── Legenda ───────────────────────────────────────────────────────────────
    print()
    print("=" * 65)
    print(f"  {GREEN}OK{RESET}           = Endpoint funciona e retornou dados")
    print(f"  {YELLOW}VAZIO{RESET}        = Endpoint funciona, sem dados no periodo")
    print(f"  {YELLOW}INDISPONIVEL{RESET} = Endpoint retornou 404 (nao ativo nesta org.)")
    print(f"  {GREEN}DISPONIVEL{RESET}   = Endpoint existe mas sem dados paginados")
    print(f"  {RED}ERRO{RESET}         = Erro inesperado")
    print("=" * 65)
    print()


if __name__ == "__main__":
    main()
