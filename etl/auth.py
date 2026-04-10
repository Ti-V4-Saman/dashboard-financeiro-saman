"""
etl/auth.py
Renova o access_token ContaAzul via refresh_token (OAuth 2.0).
O token expira em 1h — chamar sempre no início de cada execução.
"""

import os
import logging
import requests

AUTH_URL = "https://auth.contaazul.com/oauth2/token"

logger = logging.getLogger(__name__)


def get_access_token() -> str:
    """
    Faz POST em AUTH_URL com grant_type=refresh_token.
    Retorna o access_token como string.
    Lança RuntimeError com mensagem clara em qualquer falha.
    """
    client_id     = os.environ["CA_CLIENT_ID"]
    client_secret = os.environ["CA_CLIENT_SECRET"]
    refresh_token = os.environ["CA_REFRESH_TOKEN"]

    payload = {
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
        "client_id":     client_id,
        "client_secret": client_secret,
    }

    try:
        resp = requests.post(
            AUTH_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(f"Sem conexão com auth.contaazul.com: {exc}") from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError("Timeout ao autenticar na ContaAzul") from exc

    if resp.status_code != 200:
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:300]
        raise RuntimeError(
            f"Falha na autenticação ContaAzul — HTTP {resp.status_code}: {body}"
        )

    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Resposta inválida do servidor de auth: {resp.text[:200]}") from exc

    token = data.get("access_token", "")
    if not token:
        raise RuntimeError(f"access_token ausente na resposta: {data}")

    expires_in = data.get("expires_in", 0)
    logger.info("✓ Token renovado com sucesso (expira em %dmin)", round(expires_in / 60))
    return token
