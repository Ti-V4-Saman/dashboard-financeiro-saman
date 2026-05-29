"""
etl/capturar_json_debug.py
──────────────────────────────────────────────────────────────────────────────
Script isolado de diagnóstico: captura o JSON bruto de 5 endpoints da API
ContaAzul e salva em debug_json/ para inspeção dos campos reais.

CRÍTICO:
  - NÃO chama save_db_token — o refresh_token novo retornado pelo OAuth é
    descartado imediatamente (só o access_token é usado em memória).
  - NÃO altera nenhum arquivo existente do ETL.
  - NÃO escreve no banco além da leitura do token.

Uso:
    python3 -m etl.capturar_json_debug
"""

import json
import logging
import os
import sys
from pathlib import Path
from datetime import date, timedelta

import requests
from dotenv import load_dotenv

# ── Carrega variáveis de ambiente (.env na raiz do projeto) ───────────────────
_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT / ".env.local", override=False)
load_dotenv(_ROOT / ".env",       override=False)

# ── Logging legível no terminal ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Diretório de saída ────────────────────────────────────────────────────────
OUTPUT_DIR = _ROOT / "debug_json"
OUTPUT_DIR.mkdir(exist_ok=True)

# ── Constantes ────────────────────────────────────────────────────────────────
AUTH_URL = "https://auth.contaazul.com/oauth2/token"
API_BASE = "https://api-v2.contaazul.com/v1"
MAX_ITEMS = 5   # quantos registros salvar por endpoint (evita arquivo gigante)


# ── Autenticação SEM salvar o novo refresh_token ──────────────────────────────

def _get_access_token_readonly() -> str:
    """
    Lê o refresh_token do banco via get_db_token(), faz POST para obter
    um access_token e DESCARTA qualquer novo refresh_token retornado.
    Nunca chama save_db_token.
    """
    from etl.auth import get_db_token   # leitura do banco — OK

    client_id     = os.getenv("CA_CLIENT_ID")
    client_secret = os.getenv("CA_CLIENT_SECRET")

    refresh_token = get_db_token()
    if not refresh_token:
        refresh_token = os.getenv("CA_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            "Credenciais ausentes. Verifique CA_CLIENT_ID, CA_CLIENT_SECRET e "
            "CA_REFRESH_TOKEN no banco ou no .env."
        )

    logger.info("Obtendo access_token (refresh_token NÃO será salvo)...")
    resp = requests.post(
        AUTH_URL,
        data={
            "grant_type":    "refresh_token",
            "refresh_token": refresh_token,
            "client_id":     client_id,
            "client_secret": client_secret,
        },
        timeout=20,
    )
    if resp.status_code != 200:
        # Sem resp.text: o corpo de erro do OAuth pode ecoar segredos.
        raise RuntimeError(f"Falha na autenticação (HTTP {resp.status_code})")

    data = resp.json()
    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError(f"access_token ausente na resposta: {data}")

    # ⚠️  Novo refresh_token ignorado propositalmente — não chamar save_db_token
    new_refresh = data.get("refresh_token")
    if new_refresh:
        logger.info("Novo refresh_token recebido e DESCARTADO (não será salvo no banco).")

    expires_in = data.get("expires_in", 0)
    logger.info("access_token obtido (expira em ~%dmin).", round(expires_in / 60))
    return access_token


# ── Requisição simples (1ª página, poucos registros) ─────────────────────────

def _fetch_raw(session: requests.Session, path: str, params: dict) -> dict | list | None:
    """GET path com params, retorna o JSON bruto ou None em caso de erro."""
    url = f"{API_BASE}{path}" if path.startswith("/") else f"{API_BASE}/{path}"
    try:
        resp = session.get(url, params=params, timeout=30)
        logger.info("GET %-55s  HTTP %d", path, resp.status_code)
        if resp.status_code == 404:
            logger.warning("  → 404: endpoint não disponível nesta organização.")
            return None
        if not resp.ok:
            logger.error("  → Erro %d: %s", resp.status_code, resp.text[:200])
            return None
        return resp.json()
    except Exception as exc:
        logger.error("  → Exceção em %s: %s", path, exc)
        return None


def _extract_items(body: dict | list) -> list:
    """Extrai a lista de itens de diferentes formatos de resposta da CA."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in ("itens", "items", "data", "content", "result", "results",
                    "registros", "items_totais", "itens_totais"):
            if key in body and isinstance(body[key], list):
                return body[key]
    return []


def _save(filename: str, payload: dict | list) -> Path:
    """Salva JSON com indentação em debug_json/filename."""
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    logger.info("  → Salvo em %s (%d bytes)", path, path.stat().st_size)
    return path


def _print_keys(label: str, items: list) -> None:
    """Imprime as chaves do primeiro item da lista."""
    if not items:
        print(f"\n[{label}] Nenhum registro retornado.")
        return
    first = items[0]
    keys = list(first.keys()) if isinstance(first, dict) else ["(não é dict)"]
    print(f"\n[{label}] Campos do 1º objeto ({len(items)} registro(s) salvos):")
    for k in keys:
        val = first.get(k, "—")
        # Preview curto do valor
        preview = str(val)[:60].replace("\n", " ")
        print(f"  • {k:<35} = {preview}")


# ── Endpoints a capturar ──────────────────────────────────────────────────────

def _build_endpoints() -> list[dict]:
    """
    Retorna a lista de endpoints com paths idênticos aos usados pelo ETL
    (ver etl/sync/financeiro.py). Cada entrada: label, path, params, output_file.
    """
    today      = date.today()
    start_date = (today - timedelta(days=90)).strftime("%Y-%m-%d")
    end_date   = today.strftime("%Y-%m-%d")

    # Params comuns de paginação mínima
    page_params = {"pagina": 1, "tamanho_pagina": MAX_ITEMS}

    return [
        {
            "label": "Contas a Receber",
            "path":  "/financeiro/eventos-financeiros/contas-a-receber/buscar",
            "params": {
                **page_params,
                "data_vencimento_de":  start_date,
                "data_vencimento_ate": end_date,
            },
            "file": "contas_receber_raw.json",
        },
        {
            "label": "Contas a Pagar",
            "path":  "/financeiro/eventos-financeiros/contas-a-pagar/buscar",
            "params": {
                **page_params,
                "data_vencimento_de":  start_date,
                "data_vencimento_ate": end_date,
            },
            "file": "contas_pagar_raw.json",
        },
        {
            "label": "Baixas (via listagem de contas a receber quitadas)",
            "path":  "/financeiro/eventos-financeiros/contas-a-receber/buscar",
            "params": {
                **page_params,
                "data_vencimento_de":  start_date,
                "data_vencimento_ate": end_date,
                "situacao":            "QUITADO",
            },
            "file": "baixas_raw.json",
            # Nota: baixas individuais ficam em /parcelas/{id}/baixa.
            # Aqui capturamos as contas quitadas para ver o campo "baixas" embutido.
        },
        {
            "label": "Vendas",
            "path":  "/venda/busca",
            "params": {
                **page_params,
                "data_venda_de":  start_date,
                "data_venda_ate": end_date,
            },
            "file": "vendas_raw.json",
        },
        {
            "label": "Notas Fiscais (produto)",
            "path":  "/notas-fiscais",
            "params": {
                **page_params,
                "data_competencia_de":  start_date,
                "data_competencia_ate": end_date,
            },
            "file": "notas_fiscais_raw.json",
            # Se 404, tentamos /notas-fiscais-servico abaixo (fallback)
            "fallback_path": "/notas-fiscais-servico",
        },
    ]


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 70)
    print("  capturar_json_debug.py — diagnóstico de campos API ContaAzul")
    print("=" * 70)

    # 1. Obter access_token (sem salvar novo refresh_token)
    try:
        access_token = _get_access_token_readonly()
    except RuntimeError as exc:
        logger.error("Falha na autenticação: %s", exc)
        sys.exit(1)

    # 2. Session HTTP reutilizável
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {access_token}",
        "Accept":        "application/json",
    })

    # 3. Capturar cada endpoint
    endpoints = _build_endpoints()
    saved_files: list[str] = []

    for ep in endpoints:
        print(f"\n{'─'*60}")
        logger.info("Capturando: %s", ep["label"])

        raw = _fetch_raw(session, ep["path"], ep["params"])

        # Fallback para notas fiscais de serviço se produto der 404
        if raw is None and ep.get("fallback_path"):
            logger.info("Tentando fallback: %s", ep["fallback_path"])
            raw = _fetch_raw(session, ep["fallback_path"], ep["params"])

        if raw is None:
            logger.warning("  → Sem dados para %s — arquivo não gerado.", ep["label"])
            continue

        # Extrair itens e limitar a MAX_ITEMS
        items = _extract_items(raw)
        limited_items = items[:MAX_ITEMS]

        # Montar payload para salvar: mantém metadados da resposta + itens truncados
        if isinstance(raw, dict):
            save_payload: dict | list = {
                k: (limited_items if k in ("itens", "items", "data", "content",
                                           "result", "results", "registros")
                    else v)
                for k, v in raw.items()
            }
            # Garante que a chave de itens esteja presente mesmo se não detectada acima
            if not any(k in raw for k in ("itens", "items", "data", "content",
                                          "result", "results", "registros")):
                save_payload = {"_meta": "chave de itens não detectada",
                                "_raw":  raw,
                                "_items_detectados": limited_items}
        else:
            save_payload = limited_items

        _save(ep["file"], save_payload)
        saved_files.append(ep["file"])
        _print_keys(ep["label"], limited_items)

    # 4. Resumo final
    print(f"\n{'='*70}")
    print(f"  Concluído. {len(saved_files)}/{len(endpoints)} arquivo(s) gerado(s):")
    for f in saved_files:
        p = OUTPUT_DIR / f
        print(f"    debug_json/{f}  ({p.stat().st_size:,} bytes)")
    if len(saved_files) < len(endpoints):
        print("\n  ⚠️  Alguns endpoints retornaram 404 ou erro — verifique os logs acima.")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
