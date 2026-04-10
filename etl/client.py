"""
etl/client.py
HTTP client para a API ContaAzul v1.

Funcionalidades:
- Base URL: https://api-v2.contaazul.com/v1
- Retry automático com backoff exponencial em 429 e 5xx
- Paginação automática (detecta múltiplos formatos de resposta)
- Logging de cada requisição com status e duração
"""

import logging
import time
from typing import Any, Dict, Generator, List, Optional

import requests

API_BASE = "https://api-v2.contaazul.com/v1"

logger = logging.getLogger(__name__)

# Configurações de retry
MAX_RETRIES   = 5
BACKOFF_BASE  = 2.0   # segundos
PAGE_SIZE     = 100   # registros por página


class ContaAzulClient:
    """Cliente HTTP reutilizável para a API ContaAzul v1."""

    def __init__(self, access_token: str) -> None:
        self._token = access_token
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {access_token}",
            "Accept":        "application/json",
        })

    # ── Requisição com retry ───────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> requests.Response:
        url = f"{API_BASE}{path}"
        last_exc: Optional[Exception] = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                t0 = time.monotonic()
                resp = self._session.request(method, url, params=params, timeout=30)
                elapsed = time.monotonic() - t0

                # Rate-limit ou erro de servidor → retry com backoff
                if resp.status_code in (429, 500, 502, 503, 504):
                    wait = BACKOFF_BASE ** attempt
                    logger.warning(
                        "HTTP %d em %s (tentativa %d/%d) — aguardando %.1fs",
                        resp.status_code, path, attempt, MAX_RETRIES, wait,
                    )
                    time.sleep(wait)
                    last_exc = None
                    continue

                logger.debug("%-6s %s → %d  (%.2fs)", method, path, resp.status_code, elapsed)
                return resp

            except requests.exceptions.ConnectionError as exc:
                wait = BACKOFF_BASE ** attempt
                logger.warning("Erro de rede em %s (tentativa %d/%d): %s — aguardando %.1fs",
                               path, attempt, MAX_RETRIES, exc, wait)
                time.sleep(wait)
                last_exc = exc
            except requests.exceptions.Timeout as exc:
                wait = BACKOFF_BASE ** attempt
                logger.warning("Timeout em %s (tentativa %d/%d) — aguardando %.1fs",
                               path, attempt, MAX_RETRIES, wait)
                time.sleep(wait)
                last_exc = exc

        raise RuntimeError(
            f"Falha após {MAX_RETRIES} tentativas em {path}: {last_exc}"
        )

    # ── Extração de lista da resposta (formatos variados) ──────────────────────

    @staticmethod
    def _extract_items(body: Any) -> List[Dict[str, Any]]:
        """Extrai a lista de itens de diferentes formatos de resposta."""
        if isinstance(body, list):
            return body
        if isinstance(body, dict):
            for key in ("items", "data", "content", "result", "results", "registros"):
                if key in body and isinstance(body[key], list):
                    return body[key]
        return []

    @staticmethod
    def _has_next_page(body: Any, current_page: int, items_returned: int) -> bool:
        """
        Detecta se há próxima página.
        Suporta: hasNext, hasNextPage, totalPages, total+pageSize, lista vazia.
        """
        if isinstance(body, list):
            # Página simples (sem paginação na resposta)
            return False
        if isinstance(body, dict):
            # Indicador explícito
            for key in ("hasNext", "hasNextPage", "has_next"):
                if key in body:
                    return bool(body[key])
            # totalPages
            if "totalPages" in body:
                return current_page < body["totalPages"]
            if "total_pages" in body:
                return current_page < body["total_pages"]
            # total + pageSize → calcular total de páginas
            total = body.get("total") or body.get("totalElements") or body.get("totalRegistros")
            size  = body.get("pageSize") or body.get("size") or PAGE_SIZE
            if total is not None:
                total_pages = (int(total) + int(size) - 1) // int(size)
                return current_page < total_pages
        # Fallback: se retornou 0 itens, acabou
        return items_returned >= PAGE_SIZE  # pode ter mais, tenta próxima

    # ── Paginação automática ───────────────────────────────────────────────────

    def get_all(
        self,
        path: str,
        extra_params: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Busca TODOS os registros de um endpoint paginado.
        Retorna lista plana com todos os itens concatenados.
        """
        all_items: List[Dict[str, Any]] = []
        page = 1

        while True:
            params: Dict[str, Any] = {"page": page, "pageSize": PAGE_SIZE}
            if extra_params:
                params.update(extra_params)

            resp = self._request("GET", path, params=params)

            if resp.status_code == 404:
                logger.warning("Endpoint %s retornou 404 — pulando", path)
                break
            if not resp.ok:
                raise RuntimeError(
                    f"Erro {resp.status_code} em {path}: {resp.text[:300]}"
                )

            try:
                body = resp.json()
            except Exception:
                raise RuntimeError(f"JSON inválido em {path}: {resp.text[:200]}")

            items = self._extract_items(body)
            all_items.extend(items)

            logger.debug("%s — página %d: %d registros (total acumulado: %d)",
                         path, page, len(items), len(all_items))

            if not items or not self._has_next_page(body, page, len(items)):
                break

            page += 1

        logger.info("✓ %-35s → %d registro(s)", path, len(all_items))
        return all_items
