"""
scripts/reauth_contaazul.py

Faz a reautorização completa ContaAzul (OAuth 2.0 Authorization Code).
Use quando o refresh_token expirou.

Uso:
  python3 scripts/reauth_contaazul.py

Fluxo:
  1. Abre o ContaAzul no navegador para você autorizar
  2. Você copia a URL de retorno (que contém ?code=...)
  3. Cola no terminal
  4. Script troca pelo access_token + refresh_token e salva no .env
"""

import os
import re
import sys
import webbrowser
from urllib.parse import urlencode, urlparse, parse_qs

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import requests
except ImportError:
    print("Execute: pip3 install requests python-dotenv")
    sys.exit(1)

AUTH_URL     = "https://auth.contaazul.com/oauth2/authorize"
TOKEN_URL    = "https://auth.contaazul.com/oauth2/token"
REDIRECT_URI = "https://oauth.pstmn.io/v1/callback"
SCOPE        = "openid profile aws.cognito.signin.user.admin"
ENV_FILE     = os.path.join(os.path.dirname(__file__), "..", ".env")

# Credenciais do app de produção "ETL BI Interno".
# NUNCA hardcode aqui — leia de variáveis de ambiente / .env.
# (O secret que estava nesta linha foi exposto no histórico do git e DEVE
#  ser rotacionado no painel da Conta Azul.)
CLIENT_ID     = os.getenv("CA_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CA_CLIENT_SECRET", "")

if not CLIENT_ID or not CLIENT_SECRET:
    print("Defina CA_CLIENT_ID e CA_CLIENT_SECRET no ambiente (ou no .env) antes de rodar.")
    sys.exit(1)


def _save_to_env(client_id: str, client_secret: str, refresh_token: str) -> None:
    env_path = os.path.abspath(ENV_FILE)
    if not os.path.exists(env_path):
        print(f"  .env não encontrado em {env_path}")
        print(f"  Adicione manualmente: CA_REFRESH_TOKEN={refresh_token}")
        return

    with open(env_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Atualiza ou adiciona cada variável
    for key, val in [
        ("CA_CLIENT_ID", client_id),
        ("CA_CLIENT_SECRET", client_secret),
        ("CA_REFRESH_TOKEN", refresh_token),
    ]:
        if re.search(rf"^{key}=", content, flags=re.MULTILINE):
            content = re.sub(
                rf"^{key}=.*$",
                f"{key}={val}",
                content,
                flags=re.MULTILINE,
            )
        else:
            content = content.rstrip("\n") + f"\n{key}={val}\n"

    with open(env_path, "w", encoding="utf-8") as f:
        f.write(content)

    print("  .env atualizado com CA_CLIENT_ID, CA_CLIENT_SECRET e CA_REFRESH_TOKEN")


def main():
    print("=" * 60)
    print("  REAUTORIZAÇÃO ContaAzul — ETL BI Interno")
    print("=" * 60)

    client_id     = CLIENT_ID
    client_secret = CLIENT_SECRET

    # 1. Montar URL de autorização
    params = urlencode({
        "response_type": "code",
        "client_id":     client_id,
        "redirect_uri":  REDIRECT_URI,
        "scope":         SCOPE,
    })
    auth_url = f"{AUTH_URL}?{params}"

    print(f"\n1. Abrindo o ContaAzul no navegador...")
    print(f"   Se não abrir automaticamente, acesse:\n   {auth_url}\n")
    webbrowser.open(auth_url)

    print("2. Faça login com sua conta REAL da ContaAzul (não a de teste).")
    print("   Após autorizar, o navegador vai redirecionar para oauth.pstmn.io.")
    print("   Copie a URL COMPLETA da barra de endereço nesse momento.")
    print("   Ela vai conter ?code=... (pode ser uma página de erro do Postman — tudo bem)\n")

    callback_url = input("   Cole a URL aqui: ").strip()

    # Extrair code da URL
    parsed = urlparse(callback_url)
    params_parsed = parse_qs(parsed.query)
    code = params_parsed.get("code", [None])[0]

    if not code:
        # Talvez o usuário colou só o code diretamente
        if len(callback_url) > 10 and "=" not in callback_url and "/" not in callback_url:
            code = callback_url
        else:
            print("\nERRO: Não foi possível extrair o código da URL.")
            print("Certifique-se de copiar a URL completa após o redirecionamento.")
            sys.exit(1)

    print(f"\n   Código capturado.")

    # 3. Trocar pelo token
    print("\n3. Trocando código pelo token...")
    resp = requests.post(TOKEN_URL, data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  REDIRECT_URI,
        "client_id":     client_id,
        "client_secret": client_secret,
    }, timeout=20)

    if resp.status_code != 200:
        print(f"ERRO HTTP {resp.status_code}: {resp.text[:400]}")
        sys.exit(1)

    data = resp.json()
    access_token  = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")
    expires_in    = data.get("expires_in", 0)

    if not access_token or not refresh_token:
        print(f"ERRO: Tokens não retornados. Resposta: {data}")
        sys.exit(1)

    print(f"   access_token obtido (expira em {round(expires_in/60)}min)")
    print(f"   refresh_token obtido")

    # 4. Salvar no .env
    print("\n4. Salvando no .env e no banco de dados...")
    _save_to_env(client_id, client_secret, refresh_token)

    # 5. Salvar também no banco de dados
    try:
        from dotenv import load_dotenv
        load_dotenv()
        import psycopg2
        db_url = os.getenv("DATABASE_URL")
        if db_url:
            conn = psycopg2.connect(db_url)
            conn.autocommit = False
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO ca.config (key, value)
                    VALUES ('CA_REFRESH_TOKEN', %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, (refresh_token,))
            conn.commit()
            conn.close()
            print("  Refresh token salvo no banco de dados.")
        else:
            print("  DATABASE_URL não encontrada — token salvo apenas no .env")
    except Exception as e:
        print(f"  Aviso: não foi possível salvar no banco ({e}). Token está no .env.")

    print("\n" + "=" * 60)
    print("  CONCLUÍDO — ETL pronto para rodar")
    print("  Execute: python3 -m etl.main --full")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
