#!/usr/bin/env python3
"""
test_contaazul.py
Valida a integração ContaAzul → PostgreSQL de ponta a ponta.

Dependências:
    pip install requests psycopg2-binary python-dotenv

Credenciais via variáveis de ambiente ou arquivo .env:
    CA_CLIENT_ID, CA_CLIENT_SECRET, CA_REFRESH_TOKEN, DATABASE_URL
"""

import os
import sys
import json
from datetime import datetime
from typing import Dict, List, Optional, Union

# ── Carregar .env se existir ──────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("⚠  python-dotenv não instalado — usando apenas variáveis de ambiente do SO")

try:
    import requests
except ImportError:
    print("✗  Dependência ausente: requests\n   Execute: pip install requests psycopg2-binary python-dotenv")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("✗  Dependência ausente: psycopg2-binary\n   Execute: pip install requests psycopg2-binary python-dotenv")
    sys.exit(1)

# ── Constantes ────────────────────────────────────────────────────────────────
AUTH_URL = "https://auth.contaazul.com/oauth2/token"
API_BASE = "https://api.contaazul.com"

# Estado global do relatório final
report = {
    "api_auth":       False,
    "ep_persons":     False,
    "ep_receivables": False,
    "ep_payables":    False,
    "ep_sales":       False,
    "pg_connected":   False,
    "pg_schema":      False,
    "carga_teste":    False,
    "pg_database":    "—",
    "carga_count":    0,
}


# ─────────────────────────────────────────────────────────────────────────────
# UTILITÁRIOS
# ─────────────────────────────────────────────────────────────────────────────

def section(title: str) -> None:
    print(f"\n{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")


def get_env(key: str) -> str:
    """Lê variável de ambiente obrigatória; aborta com mensagem clara se ausente."""
    val = os.getenv(key, "").strip()
    if not val:
        print(f"✗  Variável de ambiente ausente: {key}")
        print(f"   Crie um arquivo .env com base no .env.example")
        sys.exit(1)
    return val


def count_items(response_json) -> int:
    """Extrai contagem de registros de diferentes formatos de resposta ContaAzul."""
    if isinstance(response_json, list):
        return len(response_json)
    if isinstance(response_json, dict):
        for key in ("data", "items", "content", "result", "results"):
            if key in response_json and isinstance(response_json[key], list):
                return len(response_json[key])
        # Fallback: contar chaves que parecem listas
        for v in response_json.values():
            if isinstance(v, list):
                return len(v)
    return 0


def extract_list(response_json) -> list:
    """Extrai a lista de itens do payload ContaAzul independentemente do formato."""
    if isinstance(response_json, list):
        return response_json
    if isinstance(response_json, dict):
        for key in ("data", "items", "content", "result", "results"):
            if key in response_json and isinstance(response_json[key], list):
                return response_json[key]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# PASSO 1 — Autenticação ContaAzul
# ─────────────────────────────────────────────────────────────────────────────

def step1_authenticate() -> str:
    section("PASSO 1 — Autenticação ContaAzul")

    client_id     = get_env("CA_CLIENT_ID")
    client_secret = get_env("CA_CLIENT_SECRET")
    refresh_token = get_env("CA_REFRESH_TOKEN")

    payload = {
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
        "client_id":     client_id,
        "client_secret": client_secret,
    }

    try:
        resp = requests.post(AUTH_URL, data=payload, timeout=15)
    except requests.exceptions.ConnectionError:
        print("✗  Sem conexão com auth.contaazul.com — verifique sua internet")
        sys.exit(1)
    except requests.exceptions.Timeout:
        print("✗  Timeout ao conectar com auth.contaazul.com")
        sys.exit(1)

    if resp.status_code != 200:
        print(f"✗  Falha na autenticação — HTTP {resp.status_code}")
        try:
            body = resp.json()
            print(f"   Resposta: {json.dumps(body, indent=2, ensure_ascii=False)}")
        except Exception:
            print(f"   Resposta (raw): {resp.text[:500]}")
        sys.exit(1)

    try:
        data = resp.json()
    except Exception:
        print(f"✗  Resposta inválida do servidor de autenticação: {resp.text[:200]}")
        sys.exit(1)

    access_token = data.get("access_token", "")
    if not access_token:
        print(f"✗  Token não retornado. Payload recebido: {json.dumps(data, indent=2)}")
        sys.exit(1)

    expires_in = data.get("expires_in", 0)
    expires_min = round(expires_in / 60) if expires_in else "?"
    print(f"✓  Token obtido com sucesso (expira em {expires_min}min)")

    report["api_auth"] = True
    return access_token


# ─────────────────────────────────────────────────────────────────────────────
# PASSO 2 — Testar endpoints da API (somente leitura)
# ─────────────────────────────────────────────────────────────────────────────

def step2_test_endpoints(token: str) -> None:
    section("PASSO 2 — Endpoints da API ContaAzul (somente leitura)")

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    endpoints = [
        {
            "key":  "ep_persons",
            "path": "/v2/persons",
            "params": {"pageSize": 5},
        },
        {
            "key":  "ep_receivables",
            "path": "/v2/financial/receivables",
            "params": {"pageSize": 5, "startDate": "2026-01-01", "endDate": "2026-04-10"},
        },
        {
            "key":  "ep_payables",
            "path": "/v2/financial/payables",
            "params": {"pageSize": 5, "startDate": "2026-01-01", "endDate": "2026-04-10"},
        },
        {
            "key":  "ep_sales",
            "path": "/v2/sales",
            "params": {"pageSize": 5},
        },
    ]

    for ep in endpoints:
        url = API_BASE + ep["path"]
        try:
            resp = requests.get(url, headers=headers, params=ep["params"], timeout=15)
        except requests.exceptions.RequestException as e:
            print(f"✗  {ep['path']} → ERRO de rede: {e}")
            continue

        if resp.status_code == 200:
            try:
                data = resp.json()
                n = count_items(data)
                print(f"✓  {ep['path']} → {n} registro(s)")
                report[ep["key"]] = True
            except Exception as e:
                print(f"✗  {ep['path']} → Erro ao parsear JSON: {e}")
        else:
            try:
                err_body = resp.json()
                msg = err_body.get("message") or err_body.get("error") or str(err_body)
            except Exception:
                msg = resp.text[:200]
            print(f"✗  {ep['path']} → ERRO HTTP {resp.status_code}: {msg}")


# ─────────────────────────────────────────────────────────────────────────────
# PASSO 3 — Conexão PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

def step3_postgres() -> "Optional[psycopg2.connection]":
    section("PASSO 3 — Conexão PostgreSQL")

    database_url = get_env("DATABASE_URL")

    # Garantir sslmode=require
    conn_str = database_url
    if "sslmode" not in conn_str:
        sep = "&" if "?" in conn_str else "?"
        conn_str += f"{sep}sslmode=require"

    try:
        conn = psycopg2.connect(conn_str)
        conn.autocommit = False
    except psycopg2.OperationalError as e:
        print(f"✗  Não foi possível conectar ao PostgreSQL:\n   {e}")
        return None
    except Exception as e:
        print(f"✗  Erro inesperado ao conectar ao PostgreSQL: {e}")
        return None

    report["pg_connected"] = True

    with conn.cursor() as cur:
        # Verificar schema 'ca'
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'ca'"
        )
        schema_exists = cur.fetchone()[0] > 0

        if schema_exists:
            print("✓  Schema 'ca' encontrado no banco")
            report["pg_schema"] = True
        else:
            print("⚠  Schema 'ca' não encontrado — rode o ca_schema.sql primeiro")

        # Banco e versão
        cur.execute("SELECT current_database(), version()")
        row = cur.fetchone()
        db_name = row[0]
        pg_version = row[1].split(",")[0]  # pegar só a parte principal
        print(f"✓  Banco: {db_name}")
        print(f"✓  Versão: {pg_version}")
        report["pg_database"] = db_name

    return conn


# ─────────────────────────────────────────────────────────────────────────────
# PASSO 4 — Mini carga de teste
# ─────────────────────────────────────────────────────────────────────────────

def step4_mini_load(token: str, conn: "Optional[psycopg2.connection]") -> None:
    section("PASSO 4 — Mini carga de teste (10 pessoas)")

    if conn is None:
        print("✗  Pulando carga de teste — sem conexão com o banco")
        return

    if not report["pg_schema"]:
        print("⚠  Pulando carga de teste — schema 'ca' não existe no banco")
        print("   Crie o schema com ca_schema.sql e execute o script novamente")
        return

    # Buscar 10 pessoas na API
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    url = API_BASE + "/v2/persons"

    try:
        resp = requests.get(url, headers=headers, params={"pageSize": 10}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        pessoas = extract_list(data)
    except requests.exceptions.RequestException as e:
        print(f"✗  Falha ao buscar pessoas da API: {e}")
        return
    except Exception as e:
        print(f"✗  Erro ao processar resposta da API: {e}")
        return

    if not pessoas:
        print("⚠  Nenhuma pessoa retornada pela API ContaAzul — sem dados para inserir")
        return

    # Montar registros para UPSERT
    rows = []
    for p in pessoas:
        if not isinstance(p, dict):
            continue

        # Extrair campos comuns da API ContaAzul /v2/persons
        pid         = str(p.get("id") or p.get("uuid") or "")
        name        = str(p.get("name") or p.get("nome") or "")
        email       = str(p.get("email") or "")
        document    = str(p.get("document") or p.get("cpf") or p.get("cnpj") or "")
        person_type = str(p.get("personType") or p.get("person_type") or p.get("tipo") or "")
        phone       = ""
        phones = p.get("phoneNumbers") or p.get("phone_numbers") or p.get("telefones") or []
        if isinstance(phones, list) and phones:
            first_phone = phones[0]
            if isinstance(first_phone, dict):
                phone = str(first_phone.get("number") or first_phone.get("numero") or "")
            else:
                phone = str(first_phone)

        if not pid:
            continue  # Ignorar registros sem ID

        rows.append((
            pid,
            name,
            email,
            document,
            person_type,
            phone,
            json.dumps(p, ensure_ascii=False),  # payload completo como jsonb
            datetime.utcnow(),
        ))

    if not rows:
        print("⚠  Nenhum registro válido para inserir (faltou campo 'id' nos retornos)")
        return

    # UPSERT na tabela ca.pessoas
    sql_upsert = """
        INSERT INTO ca.pessoas (
            id, nome, email, documento, tipo_pessoa, telefone, payload_json, atualizado_em
        )
        VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            nome         = EXCLUDED.nome,
            email        = EXCLUDED.email,
            documento    = EXCLUDED.documento,
            tipo_pessoa  = EXCLUDED.tipo_pessoa,
            telefone     = EXCLUDED.telefone,
            payload_json = EXCLUDED.payload_json,
            atualizado_em = EXCLUDED.atualizado_em
    """

    try:
        with conn.cursor() as cur:
            execute_values(cur, sql_upsert, rows)
        conn.commit()
        print(f"✓  {len(rows)} pessoa(s) inserida(s)/atualizada(s) no banco")
        report["carga_teste"]  = True
        report["carga_count"]  = len(rows)
    except psycopg2.errors.UndefinedTable:
        conn.rollback()
        print("✗  Tabela ca.pessoas não encontrada — crie a tabela com ca_schema.sql")
        print("   Dica: verifique se o schema foi criado com todas as tabelas necessárias")
        return
    except psycopg2.errors.UndefinedColumn as e:
        conn.rollback()
        print(f"✗  Coluna não encontrada em ca.pessoas: {e}")
        print("   Verifique se ca_schema.sql corresponde às colunas esperadas por este script")
        return
    except Exception as e:
        conn.rollback()
        print(f"✗  Erro ao fazer UPSERT em ca.pessoas: {e}")
        return

    # Contar total na tabela
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ca.pessoas")
            total = cur.fetchone()[0]
        print(f"✓  Total de registros em ca.pessoas: {total}")
    except Exception as e:
        print(f"⚠  Não foi possível contar os registros: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# PASSO 5 — Relatório final
# ─────────────────────────────────────────────────────────────────────────────

def step5_report() -> None:
    def mark(ok: bool) -> str:
        return "✓" if ok else "✗"

    db = report["pg_database"]
    count = report["carga_count"]

    print(f"""
─────────────────────────────────────────
  RESULTADO DO TESTE
─────────────────────────────────────────
  {mark(report['api_auth'])}  API ContaAzul: autenticada
  {mark(report['ep_persons'])}  Endpoint /persons: {"OK" if report['ep_persons'] else "FALHOU"}
  {mark(report['ep_receivables'])}  Endpoint /receivables: {"OK" if report['ep_receivables'] else "FALHOU"}
  {mark(report['ep_payables'])}  Endpoint /payables: {"OK" if report['ep_payables'] else "FALHOU"}
  {mark(report['ep_sales'])}  Endpoint /sales: {"OK" if report['ep_sales'] else "FALHOU"}
  {mark(report['pg_connected'])}  PostgreSQL: {"conectado (banco: " + str(db) + ")" if report['pg_connected'] else "sem conexão"}
  {mark(report['pg_schema'])}  Schema ca: {"encontrado" if report['pg_schema'] else "não encontrado"}
  {mark(report['carga_teste'])}  Carga de teste: {str(count) + " pessoa(s) inserida(s)" if report['carga_teste'] else "não executada"}
─────────────────────────────────────────""")

    all_ok = all([
        report["api_auth"],
        report["ep_persons"],
        report["ep_receivables"],
        report["ep_payables"],
        report["ep_sales"],
        report["pg_connected"],
        report["pg_schema"],
        report["carga_teste"],
    ])

    if all_ok:
        print("  PIPELINE PRONTO PARA USO ✅")
    else:
        print("  PIPELINE COM PENDÊNCIAS ⚠️")
        print("  Revise os itens marcados com ✗ ou ⚠ acima")

    print("─────────────────────────────────────────\n")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 50)
    print("  VALIDAÇÃO ContaAzul → PostgreSQL")
    print(f"  {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 50)

    conn = None

    try:
        # Passo 1 — Auth (para o script se falhar)
        token = step1_authenticate()

        # Passo 2 — Endpoints (continua mesmo com falhas parciais)
        step2_test_endpoints(token)

        # Passo 3 — PostgreSQL
        conn = step3_postgres()

        # Passo 4 — Mini carga
        step4_mini_load(token, conn)

    except SystemExit:
        # Erros fatais já imprimiram mensagem — só exibir relatório parcial
        pass
    except KeyboardInterrupt:
        print("\n\n⚠  Interrompido pelo usuário")
    except Exception as e:
        print(f"\n✗  Erro inesperado: {e}")
    finally:
        if conn and not conn.closed:
            conn.close()

    # Passo 5 — Relatório sempre exibido
    step5_report()


if __name__ == "__main__":
    main()
