import os
import logging
import requests
from etl.db import get_connection

AUTH_URL = "https://auth.contaazul.com/oauth2/token"
logger = logging.getLogger(__name__)

def get_db_token() -> str:
    """Busca o refresh token no banco de dados."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM ca.config WHERE key = 'CA_REFRESH_TOKEN'")
                res = cur.fetchone()
                return res[0] if res else None
    except Exception as e:
        logger.error(f"Erro ao buscar token no banco: {e}")
        return None

def save_db_token(token: str):
    """Salva o novo refresh token no banco de dados."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO ca.config (key, value) 
                    VALUES ('CA_REFRESH_TOKEN', %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, (token,))
                conn.commit()
                logger.info("Novo refresh token salvo no banco de dados.")
    except Exception as e:
        logger.error(f"Erro ao salvar token no banco: {e}")

def get_access_token() -> str:
    """
    Faz POST em AUTH_URL com grant_type=refresh_token.
    Prioriza o token do banco de dados, fallback para variável de ambiente.
    """
    client_id     = os.getenv("CA_CLIENT_ID")
    client_secret = os.getenv("CA_CLIENT_SECRET")
    
    # 1. Tenta pegar do banco
    refresh_token = get_db_token()
    
    # 2. Fallback para env (útil na primeira execução no GitHub)
    if not refresh_token:
        refresh_token = os.getenv("CA_REFRESH_TOKEN")
    
    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError("Credenciais CA_CLIENT_ID, CA_CLIENT_SECRET ou CA_REFRESH_TOKEN ausentes")

    payload = {
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
        "client_id":     client_id,
        "client_secret": client_secret,
    }

    try:
        resp = requests.post(AUTH_URL, data=payload, timeout=20)
    except Exception as exc:
        raise RuntimeError(f"Erro de conexão ao autenticar: {exc}")

    if resp.status_code != 200:
        # Não logamos resp.text: o corpo de erro do endpoint OAuth pode ecoar
        # parâmetros sensíveis (client_secret/refresh_token). Só o status code.
        raise RuntimeError(f"Falha na autenticação ContaAzul (HTTP {resp.status_code})")

    data = resp.json()
    access_token = data.get("access_token")
    new_refresh = data.get("refresh_token")

    # Salva o novo refresh_token se ele mudou
    if new_refresh:
        save_db_token(new_refresh)

    expires_in = data.get("expires_in", 0)
    logger.info("Token renovado (expira em %dmin)", round(expires_in / 60))
    
    return access_token
