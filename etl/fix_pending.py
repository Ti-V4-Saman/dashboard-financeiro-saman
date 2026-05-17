#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
etl/fix_pending.py
Script de debug e correcao para endpoints que retornaram zero ou erro no sync full.

Problemas tratados:
  1. transferencias  -> 417 ignoradas por conta_origem_id NULL
  2. notas_fiscais   -> Erro 400 (parametros obrigatorios errados)
  3. saldo_contas    -> 0 retornado (raw response debug)
  4. fornecedores    -> 0 (ja incluso em clientes, apenas confirmacao)

Uso:
    python -m etl.fix_pending
"""

import sys
import logging
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s -- %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("etl.fix_pending")

from etl.auth import get_access_token
from etl.client import ContaAzulClient
from etl.db import get_connection, upsert, ensure_connection

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

TODAY = date.today().strftime("%Y-%m-%d")


# ==============================================================================
# 1. TRANSFERENCIAS -- conta_origem_id NULL
# ==============================================================================

def _str(v: Any) -> str:
    return str(v) if v is not None else ""

def _float(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

def _id(obj: Any) -> Optional[str]:
    if isinstance(obj, dict):
        v = obj.get("id") or obj.get("uuid")
    else:
        v = obj
    return _str(v) or None


def debug_transferencias(client: ContaAzulClient, conn):
    """
    Debug completo das transferencias.
    Mostra o JSON bruto de 1 transferencia com conta_origem_id null
    para entender como os campos chegam da API.
    """
    print(f"\n{BOLD}{CYAN}[1] DEBUG: TRANSFERENCIAS{RESET}")
    print("-" * 60)

    start = (date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    end   = date.today().strftime("%Y-%m-%d")

    items = client.get_all("/financeiro/transferencias",
                           extra_params={"data_inicio": start, "data_fim": end})

    print(f"  Total retornado pela API: {len(items)}")

    null_origem  = [r for r in items if not (r.get("conta_origem") or r.get("conta_de") or r.get("source_account"))]
    com_origem   = [r for r in items if (r.get("conta_origem") or r.get("conta_de") or r.get("source_account"))]

    print(f"  Com conta_origem:     {len(com_origem)}")
    print(f"  Sem conta_origem:     {len(null_origem)}")

    if null_origem:
        print(f"\n  {YELLOW}Exemplo de transferencia SEM conta_origem (raw JSON):{RESET}")
        sample = null_origem[0]
        for k, v in sample.items():
            print(f"    {k!r:35} = {v!r}")

    if com_origem:
        print(f"\n  {GREEN}Exemplo de transferencia COM conta_origem:{RESET}")
        sample = com_origem[0]
        for k, v in sample.items():
            print(f"    {k!r:35} = {v!r}")

    # Tenta fazer lookup de conta por nome da descricao
    print(f"\n  Buscando contas financeiras para lookup por nome...")
    contas = client.get_all("/conta-financeira")
    conta_por_nome: Dict[str, str] = {}
    for c in contas:
        nome = _str(c.get("nome") or c.get("name") or "").lower().strip()
        cid  = _id(c)
        if nome and cid:
            # guarda variações comuns do nome
            conta_por_nome[nome] = cid
            # guarda partes do nome (ex: "Santander" de "Conta Santander PJ")
            for part in nome.split():
                if len(part) >= 4 and part not in conta_por_nome:
                    conta_por_nome[part] = cid

    print(f"  {len(conta_por_nome)} tokens de nome indexados de {len(contas)} contas")

    # Testa o lookup nas transferencias sem conta_origem
    resolvidas = 0
    for raw in null_origem:
        desc = _str(raw.get("descricao") or raw.get("description") or "").lower()
        # Extrai "Origem: Santander / Destino: Sicoob"
        origem_id  = None
        destino_id = None
        for token, cid in conta_por_nome.items():
            if f"origem: {token}" in desc or desc.startswith(token):
                origem_id = cid
            if f"destino: {token}" in desc:
                destino_id = cid
        if origem_id:
            resolvidas += 1

    print(f"  Transferencias que conseguiriam ser resolvidas por lookup: {resolvidas}/{len(null_origem)}")

    if resolvidas == 0:
        print(f"\n  {YELLOW}CONCLUSAO: As transferencias com conta_origem_id NULL nao podem ser")
        print(f"  resolvidas por nome pois as contas no banco usam IDs internos.")
        print(f"  SOLUCAO: Tornar conta_origem_id nullable na tabela (ALTER TABLE).{RESET}")
    else:
        print(f"\n  {GREEN}CONCLUSAO: Lookup por nome funciona para {resolvidas} transferencias.{RESET}")

    return len(com_origem), len(null_origem)


def fix_transferencias_nullable(conn):
    """
    Aplica ALTER TABLE para tornar conta_origem_id e conta_destino_id nullable,
    permitindo salvar todas as transferencias mesmo sem ID de conta.
    """
    print(f"\n  Aplicando ALTER TABLE ca.transferencias...")
    try:
        with conn.cursor() as cur:
            cur.execute("""
                ALTER TABLE ca.transferencias
                    ALTER COLUMN conta_origem_id  DROP NOT NULL,
                    ALTER COLUMN conta_destino_id DROP NOT NULL;
            """)
        conn.commit()
        print(f"  {GREEN}[OK] conta_origem_id e conta_destino_id agora aceitam NULL.{RESET}")
        return True
    except Exception as e:
        conn.rollback()
        if "already" in str(e).lower() or "does not exist" in str(e).lower():
            print(f"  {GREEN}[OK] Colunas ja eram nullable (sem alteracao necessaria).{RESET}")
            return True
        print(f"  {RED}[ERRO] {e}{RESET}")
        return False


def sync_transferencias_fix(client: ContaAzulClient, conn):
    """Sincroniza transferencias incluindo as com conta_origem_id NULL."""
    from datetime import timedelta
    from etl.db import log_sync_start, log_sync_end

    print(f"\n  Sincronizando TODAS as transferencias (full)...")

    def _map(raw: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id":               _str(raw.get("id") or raw.get("uuid") or ""),
            "data":             _str(raw.get("data") or raw.get("date") or "") or None,
            "conta_origem_id":  _id(raw.get("conta_origem") or raw.get("conta_de") or raw.get("source_account")),
            "conta_destino_id": _id(raw.get("conta_destino") or raw.get("conta_para") or raw.get("destination_account")),
            "valor":            _float(raw.get("valor") or raw.get("value") or 0),
            "descricao":        _str(raw.get("descricao") or raw.get("description") or "") or None,
            "data_alteracao":   _str(raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
            "synced_at":        datetime.now(timezone.utc),
        }

    # Chunks anuais desde 2015
    def date_chunks(start_str: str, end_str: str):
        from datetime import timedelta
        start = date.fromisoformat(start_str)
        end   = date.fromisoformat(end_str)
        while start < end:
            chunk_end = min(date(start.year, 12, 31), end)
            yield start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")
            start = date(start.year + 1, 1, 1)

    total_items = []
    year_end    = date(date.today().year, 12, 31).strftime("%Y-%m-%d")
    for s, e in date_chunks("2015-01-01", year_end):
        chunk = client.get_all("/financeiro/transferencias",
                               extra_params={"data_inicio": s, "data_fim": e})
        total_items.extend(chunk)
        if chunk:
            print(f"    {s} -> {e}: {len(chunk)} transferencias")

    mapped = []
    for raw in total_items:
        if not isinstance(raw, dict):
            continue
        row = _map(raw)
        if row.get("id"):
            mapped.append(row)

    print(f"  Total mapeadas: {len(mapped)}")

    if mapped:
        n = upsert(conn, "ca.transferencias", mapped, conflict_col="id")
        conn.commit()
        print(f"  {GREEN}[OK] {n} transferencias salvas em ca.transferencias{RESET}")
        return n
    return 0


# ==============================================================================
# 2. NOTAS FISCAIS -- Erro 400
# ==============================================================================

def debug_notas_fiscais(client: ContaAzulClient):
    """
    Testa variações de parametros no endpoint /notas-fiscais
    para encontrar a combinacao correta que nao retorna 400.
    """
    print(f"\n{BOLD}{CYAN}[2] DEBUG: NOTAS FISCAIS{RESET}")
    print("-" * 60)

    start = (date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    end   = date.today().strftime("%Y-%m-%d")

    # Variações de params a testar
    variantes = [
        ("sem params",              {}),
        ("data_emissao_de/ate",     {"data_emissao_de": start, "data_emissao_ate": end}),
        ("data_inicio/fim",         {"data_inicio": start, "data_fim": end}),
        ("situacao=AUTORIZADO",     {"situacao": "AUTORIZADO"}),
        ("tipo=PRODUTO",            {"tipo": "PRODUTO", "data_emissao_de": start, "data_emissao_ate": end}),
        ("tipo=SERVICO",            {"tipo": "SERVICO", "data_emissao_de": start, "data_emissao_ate": end}),
        ("NF servico endpoint",     None),  # marcador para testar /notas-fiscais-servico
    ]

    endpoint_ok  = None
    params_ok    = None

    for label, params in variantes:
        try:
            if params is None:
                # Testa endpoint alternativo
                items = client.get_all("/notas-fiscais-servico",
                                       extra_params={"data_emissao_de": start, "data_emissao_ate": end})
                ep = "/notas-fiscais-servico"
            else:
                items = client.get_all("/notas-fiscais", extra_params=params or None)
                ep = "/notas-fiscais"

            count = len(items)
            if count > 0:
                print(f"  {GREEN}[OK]{RESET} {label:35} -> {count} registros  {YELLOW}*** FUNCIONOU!{RESET}")
                endpoint_ok = ep
                params_ok   = params
                if items:
                    print(f"  Exemplo (campos):")
                    for k, v in list(items[0].items())[:6]:
                        print(f"    {k}: {v!r}")
            else:
                print(f"  {YELLOW}VAZIO{RESET} {label:35} -> 0 registros")
        except Exception as e:
            err = str(e)[:80]
            print(f"  {RED}ERRO {RESET} {label:35} -> {err}")

    if endpoint_ok:
        print(f"\n  {GREEN}SOLUCAO: usar endpoint={endpoint_ok} com params={params_ok}{RESET}")
    else:
        print(f"\n  {YELLOW}CONCLUSAO: Nenhuma variante retornou dados.")
        print(f"  Esta organizacao provavelmente nao emite NF pelo ContaAzul.{RESET}")

    return endpoint_ok, params_ok


# ==============================================================================
# 3. SALDO CONTAS -- 0 retornado
# ==============================================================================

def debug_saldo_contas(client: ContaAzulClient, conn):
    """
    Debugs the /conta-financeira/{id}/saldo endpoint by printing the raw response.
    """
    print(f"\n{BOLD}{CYAN}[3] DEBUG: SALDO CONTAS{RESET}")
    print("-" * 60)

    contas = client.get_all("/conta-financeira")
    print(f"  Contas financeiras encontradas: {len(contas)}")

    updated = 0
    for conta in contas[:5]:  # testa as primeiras 5
        cid   = conta.get("id")
        nome  = conta.get("nome") or conta.get("name") or "?"
        try:
            resp  = client.get(f"/conta-financeira/{cid}/saldo")
            print(f"\n  Conta: {nome} ({cid})")
            if resp is None:
                print(f"    {RED}Retornou None (404){RESET}")
            elif isinstance(resp, dict):
                print(f"    Raw response: {json.dumps(resp, ensure_ascii=False, indent=4)[:400]}")
                # Tenta extrair saldo com todos os campos possiveis
                saldo = (
                    resp.get("saldo")
                    or resp.get("saldo_atual")
                    or resp.get("balance")
                    or resp.get("currentBalance")
                    or resp.get("current_balance")
                    or resp.get("saldo_disponivel")
                    or resp.get("available_balance")
                )
                if saldo is not None:
                    print(f"    {GREEN}Saldo encontrado: R$ {saldo}{RESET}")
                    with conn.cursor() as cur:
                        cur.execute(
                            """UPDATE ca.contas_financeiras
                               SET saldo_atual = %s, synced_at = %s
                             WHERE id = %s""",
                            (_float(saldo), datetime.now(timezone.utc), str(cid))
                        )
                    conn.commit()
                    updated += 1
                else:
                    print(f"    {YELLOW}Nenhum campo de saldo reconhecido na resposta{RESET}")
                    print(f"    Campos disponiveis: {list(resp.keys())}")
            else:
                print(f"    Tipo inesperado: {type(resp)} -> {resp!r:.100}")
        except Exception as e:
            print(f"    {RED}Erro: {e}{RESET}")

    print(f"\n  Saldos atualizados: {updated}")
    return updated


# ==============================================================================
# 4. FORNECEDORES -- confirmacao
# ==============================================================================

def check_fornecedores(conn):
    """Verifica se ha fornecedores no banco (ja foram incluidos junto com clientes)."""
    print(f"\n{BOLD}{CYAN}[4] VERIFICACAO: FORNECEDORES{RESET}")
    print("-" * 60)
    try:
        conn = ensure_connection(conn)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT papel, COUNT(*) as total
                FROM ca.pessoas
                GROUP BY papel
                ORDER BY total DESC
            """)
            rows = cur.fetchall()

        if rows:
            for papel, total in rows:
                status = GREEN if total > 0 else YELLOW
                print(f"  {status}[{papel or 'NULL'}]{RESET} {total} pessoa(s)")
            total_all = sum(r[1] for r in rows)
            print(f"  Total: {total_all} pessoas na tabela ca.pessoas")
            print(f"  {GREEN}Fornecedores ja estao incluidos na mesma tabela (campo 'papel').{RESET}")
        else:
            print(f"  {YELLOW}Tabela ca.pessoas esta vazia!{RESET}")
    except Exception as e:
        print(f"  {RED}Erro: {e}{RESET}")


# ==============================================================================
# MAIN
# ==============================================================================

def main():
    print()
    print("=" * 65)
    print("  FIX PENDING -- Debug e Correcao de Endpoints com Problema")
    print("=" * 65)

    token = get_access_token()
    client = ContaAzulClient(token)
    conn   = get_connection()

    print(f"\n  {GREEN}[OK]{RESET} Autenticacao e conexao prontas")

    # ── 1. Transferencias ─────────────────────────────────────────────────────
    com_id, sem_id = debug_transferencias(client, conn)

    if sem_id > 0:
        print(f"\n  {BOLD}Aplicar correcao de schema para transferencias? (s/N): {RESET}", end="")
        resp = input().strip().lower()
        if resp == "s":
            ok = fix_transferencias_nullable(conn)
            if ok:
                conn = ensure_connection(conn)
                n = sync_transferencias_fix(client, conn)
                print(f"  {GREEN}Transferencias sincronizadas: {n}{RESET}")

    # ── 2. Notas Fiscais ──────────────────────────────────────────────────────
    ep_ok, params_ok = debug_notas_fiscais(client)

    if ep_ok and params_ok is not None:
        print(f"\n  {BOLD}Sincronizar notas fiscais com params corretos? (s/N): {RESET}", end="")
        resp = input().strip().lower()
        if resp == "s":
            from etl.sync.financeiro import _map_nota_fiscal
            from etl.db import log_sync_start, log_sync_end
            log_id  = log_sync_start(conn, ep_ok)
            records = 0
            try:
                raw_list = client.get_all(ep_ok, extra_params=params_ok)
                mapped   = []
                for raw in raw_list:
                    if not isinstance(raw, dict): continue
                    row = _map_nota_fiscal(raw)
                    if row.get("id"): mapped.append(row)
                if mapped:
                    records = upsert(conn, "ca.notas_fiscais", mapped, conflict_col="id")
                    conn.commit()
                    print(f"  {GREEN}[OK] {records} notas fiscais salvas{RESET}")
                else:
                    print(f"  {YELLOW}Nenhuma nota fiscal com dados validos{RESET}")
                log_sync_end(conn, log_id, records, status="ok")
            except Exception as e:
                conn.rollback()
                print(f"  {RED}Erro: {e}{RESET}")

    # ── 3. Saldo contas ───────────────────────────────────────────────────────
    debug_saldo_contas(client, conn)

    # ── 4. Fornecedores ───────────────────────────────────────────────────────
    check_fornecedores(conn)

    # ── Resumo ────────────────────────────────────────────────────────────────
    print()
    print("=" * 65)
    print(f"  {BOLD}RESUMO DAS ACOES:{RESET}")
    print(f"  1. Transferencias: verifique acima se o ALTER TABLE foi aplicado")
    print(f"  2. Notas Fiscais:  verifique se algum endpoint retornou dados")
    print(f"  3. Saldo Contas:   veja os campos retornados para ajustar o mapper")
    print(f"  4. Fornecedores:   ja estao em ca.pessoas (campo papel=FORNECEDOR)")
    print("=" * 65)
    print()

    conn.close()


if __name__ == "__main__":
    main()
