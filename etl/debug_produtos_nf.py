#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
etl/debug_produtos_nf.py

Debug completo de:
  1. Produtos -- testa todos os endpoints possiveis
  2. Notas Fiscais -- testa todas as combinacoes de params, exibe erro completo

Se encontrar dados, sincroniza direto no banco.

Uso:
    python -m etl.debug_produtos_nf
"""

import sys
import json
import logging
from datetime import date, timedelta
from typing import Any, Dict, List

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
from etl.db import get_connection, upsert
from etl.sync.cadastros import sync_produtos, sync_servicos
from etl.sync.financeiro import sync_notas_fiscais, _map_nota_fiscal

G = "\033[92m"
R = "\033[91m"
Y = "\033[93m"
C = "\033[96m"
B = "\033[1m"
X = "\033[0m"

TODAY      = date.today()
START_14   = (TODAY - timedelta(days=14)).strftime("%Y-%m-%d")
START_30   = (TODAY - timedelta(days=30)).strftime("%Y-%m-%d")
TODAY_STR  = TODAY.strftime("%Y-%m-%d")


def raw_get(client, path, params=None):
    """Faz uma requisicao crua e retorna (status, body_str, json_or_none)."""
    # Garante tamanho de pagina valido (10, 20, 50, 100)
    p = {"pagina": 1, "tamanho_pagina": 10}
    if params:
        p.update(params)
    resp = client._request("GET", path, params=p)
    body = resp.text[:800]
    try:
        data = resp.json()
    except Exception:
        data = None
    return resp.status_code, body, data


def section(title):
    print(f"\n{'='*65}")
    print(f"  {B}{C}{title}{X}")
    print(f"{'='*65}")


def subsection(title):
    print(f"\n  {B}{title}{X}")
    print(f"  {'-'*60}")


# ==============================================================================
# 1. PRODUTOS
# ==============================================================================

def debug_produtos(client, conn):
    section("1. PRODUTOS")

    # Endpoints a testar (em ordem de prioridade)
    # NOTA: /produto sem /busca causa 502 no servidor -- omitido intencionalmente
    endpoints = [
        ("/produto/busca",   {}),
        ("/produto/busca",   {"ativo": "true"}),
        ("/produto/busca",   {"tipo": "PRODUTO"}),
        ("/produto/busca",   {"tipo": "SERVICO"}),
        ("/produtos",        {}),
        ("/servico/busca",   {}),
    ]

    found_path = None
    for path, params in endpoints:
        status, body, data = raw_get(client, path, params)
        items = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("itens") or data.get("items") or data.get("data") or []

        if status == 200 and len(items) > 0:
            print(f"  {G}[OK]{X} {path} params={params} -> {len(items)} item(ns)")
            if items:
                print(f"       Campos: {list(items[0].keys())[:8]}")
            found_path = (path, params)
            break
        elif status == 200:
            print(f"  {Y}[VAZIO]{X} {path} params={params} -> 0 itens (200)")
        elif status == 404:
            print(f"  {Y}[404]{X}  {path} -> nao existe")
        else:
            print(f"  {R}[{status}]{X} {path} params={params} -> {body[:100]}")

    if found_path is None:
        print(f"\n  {Y}CONCLUSAO: Esta organizacao nao tem produtos cadastrados.")
        print(f"  Os 53 servicos ja estao em ca.produtos (campo tipo='SERVICO').{X}")
        return 0

    # Se achou, sincroniza
    print(f"\n  {G}Sincronizando produtos via {found_path[0]}...{X}")
    n = sync_produtos(conn, client)
    print(f"  {G}[OK] {n} produtos sincronizados{X}")
    return n


# ==============================================================================
# 2. NOTAS FISCAIS
# ==============================================================================

def debug_notas_fiscais(client, conn):
    section("2. NOTAS FISCAIS -- Teste Exaustivo de Params")

    # Todas as variantes de params a testar
    variantes_produto = [
        ("data_inicial + data_final",
            {"data_inicial": START_30, "data_final": TODAY_STR}),
        ("data_inicial + data_final (14d)",
            {"data_inicial": START_14, "data_final": TODAY_STR}),
        ("data_emissao_de + data_emissao_ate",
            {"data_emissao_de": START_30, "data_emissao_ate": TODAY_STR}),
        ("data_emissao_inicial + data_emissao_final",
            {"data_emissao_inicial": START_30, "data_emissao_final": TODAY_STR}),
        ("de + ate",
            {"de": START_30, "ate": TODAY_STR}),
        ("dataInicial + dataFinal (camelCase)",
            {"dataInicial": START_30, "dataFinal": TODAY_STR}),
        ("data_inicio + data_fim",
            {"data_inicio": START_30, "data_fim": TODAY_STR}),
        ("sem params",
            {}),
        ("situacao=AUTORIZADO + datas",
            {"situacao": "AUTORIZADO", "data_inicial": START_30, "data_final": TODAY_STR}),
        ("numero (listagem simples)",
            {"numero": "1"}),
    ]

    variantes_servico = [
        ("data_competencia_de + _ate",
            {"data_competencia_de": START_14, "data_competencia_ate": TODAY_STR}),
        ("data_competencia_inicial + _final",
            {"data_competencia_inicial": START_14, "data_competencia_final": TODAY_STR}),
        ("data_inicial + data_final",
            {"data_inicial": START_14, "data_final": TODAY_STR}),
        ("competencia_de + competencia_ate",
            {"competencia_de": START_14, "competencia_ate": TODAY_STR}),
        ("sem params",
            {}),
    ]

    encontrado = None

    # Testa /notas-fiscais
    subsection("/notas-fiscais (NF Produto)")
    for label, params in variantes_produto:
        status, body, data = raw_get(client, "/notas-fiscais", params)
        items = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = (data.get("itens") or data.get("items") or
                     data.get("data") or data.get("notas") or [])

        tag = f"params: {label}"
        if status == 200 and len(items) > 0:
            print(f"  {G}[OK  {status}]{X} {tag} -> {len(items)} NF(s)")
            print(f"           Campos: {list(items[0].keys())[:8]}")
            encontrado = ("/notas-fiscais", params, items)
            break
        elif status == 200:
            print(f"  {Y}[200 vazio]{X} {tag} -> 0 itens")
            # Mostra full response para entender estrutura
            print(f"           body: {body[:150]}")
        elif status == 400:
            err = ""
            if isinstance(data, dict):
                err = data.get("error") or data.get("message") or data.get("mensagem") or ""
            print(f"  {R}[400]{X}      {tag} -> {err[:100]}")
        elif status == 404:
            print(f"  {Y}[404]{X}      {tag} -> endpoint nao existe")
            break
        else:
            print(f"  {R}[{status}]{X}       {tag} -> {body[:120]}")

    if encontrado is None:
        subsection("/notas-fiscais-servico (NFS-e)")
        for label, params in variantes_servico:
            status, body, data = raw_get(client, "/notas-fiscais-servico", params)
            items = []
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                items = (data.get("itens") or data.get("items") or
                         data.get("data") or data.get("notas") or [])

            tag = f"params: {label}"
            if status == 200 and len(items) > 0:
                print(f"  {G}[OK  {status}]{X} {tag} -> {len(items)} NFS-e(s)")
                encontrado = ("/notas-fiscais-servico", params, items)
                break
            elif status == 200:
                print(f"  {Y}[200 vazio]{X} {tag} -> 0 itens | body: {body[:150]}")
            elif status == 400:
                err = ""
                if isinstance(data, dict):
                    err = data.get("error") or data.get("message") or ""
                print(f"  {R}[400]{X}      {tag} -> {err[:120]}")
            elif status == 404:
                print(f"  {Y}[404]{X}      endpoint /notas-fiscais-servico nao existe")
                break
            else:
                print(f"  {R}[{status}]{X}       {tag} -> {body[:120]}")

    # Conclusao
    if encontrado:
        ep, params_ok, sample = encontrado
        print(f"\n  {G}{B}PARAMS CORRETOS ENCONTRADOS!{X}")
        print(f"  Endpoint: {ep}")
        print(f"  Params:   {params_ok}")
        print(f"  Exemplo de NF:")
        for k, v in list(sample[0].items())[:10]:
            print(f"    {k}: {v!r}")

        print(f"\n  Sincronizando notas fiscais com params corretos...")
        # Sincroniza incrementalmente com modo full para pegar tudo
        n = sync_notas_fiscais_manual(client, conn, ep, params_ok)
        print(f"  {G}[OK] {n} notas fiscais sincronizadas{X}")
        return n
    else:
        print(f"\n  {Y}{B}CONCLUSAO:{X}")
        print(f"  Todos os params retornaram 400 ou 0 registros.")
        print(f"  Isso pode indicar:")
        print(f"  a) Esta organizacao nao emite NF pelo Conta Azul")
        print(f"  b) O modulo NF nao esta contratado/ativo")
        print(f"  c) Existe outro endpoint nao documentado")
        print(f"  {Y}Recomendacao: Verificar no painel do Conta Azul se o modulo NF esta ativo.{X}")
        return 0


def sync_notas_fiscais_manual(client, conn, endpoint, base_params):
    """Sincroniza NF com os params corretos encontrados no debug."""
    from datetime import date
    from etl.db import log_sync_start, log_sync_end

    log_id  = log_sync_start(conn, endpoint)
    records = 0
    start   = date(2015, 1, 1)
    end     = date(date.today().year, 12, 31)

    # Para NFS-e usa chunks de 14 dias, para NF produto pode usar range maior
    use_chunks = "servico" in endpoint
    total_items = []

    if use_chunks:
        cursor = start
        while cursor <= end:
            chunk_end = min(cursor + timedelta(days=14), end)
            params = {**base_params}
            # Substitui as datas pelos valores corretos do chunk
            for k in list(params.keys()):
                if "de" in k or "inicial" in k or "inicio" in k:
                    params[k] = cursor.strftime("%Y-%m-%d")
                if "ate" in k or "final" in k or "fim" in k:
                    params[k] = chunk_end.strftime("%Y-%m-%d")
            chunk = client.get_all(endpoint, extra_params=params)
            if chunk:
                total_items.extend(chunk)
                print(f"    {cursor} -> {chunk_end}: {len(chunk)} NFS-e")
            cursor = chunk_end + timedelta(days=1)
    else:
        params = {**base_params}
        for k in list(params.keys()):
            if "de" in k or "inicial" in k or "inicio" in k:
                params[k] = start.strftime("%Y-%m-%d")
            if "ate" in k or "final" in k or "fim" in k:
                params[k] = end.strftime("%Y-%m-%d")
        total_items = client.get_all(endpoint, extra_params=params)

    mapped = []
    for raw in total_items:
        if not isinstance(raw, dict):
            continue
        row = _map_nota_fiscal(raw)
        if row.get("id"):
            mapped.append(row)

    print(f"    Total mapeadas: {len(mapped)}")

    if mapped:
        try:
            records = upsert(conn, "ca.notas_fiscais", mapped, conflict_col="id")
            conn.commit()
        except Exception as e:
            conn.rollback()
            if "foreign key" in str(e).lower():
                for row in mapped:
                    row["venda_id"] = None
                    row["cliente_id"] = None
                records = upsert(conn, "ca.notas_fiscais", mapped, conflict_col="id")
                conn.commit()
            else:
                raise
        log_sync_end(conn, log_id, records, status="ok")
    else:
        log_sync_end(conn, log_id, 0, status="ok")

    return records


# ==============================================================================
# MAIN
# ==============================================================================

def main():
    print(f"\n{B}Debug: Produtos e Notas Fiscais -- ContaAzul{X}")

    token  = get_access_token()
    client = ContaAzulClient(token)
    conn   = get_connection()
    print(f"  {G}[OK]{X} Auth e conexao prontas\n")

    n_prod = debug_produtos(client, conn)
    n_nf   = debug_notas_fiscais(client, conn)

    section("RESUMO")
    print(f"  Produtos sincronizados:       {n_prod}")
    print(f"  Notas fiscais sincronizadas:  {n_nf}")
    print()
    conn.close()


if __name__ == "__main__":
    main()
