"""
etl/diagnostics/diag_download_notas.py

TEMPORÁRIO. Diagnóstico server-side dos endpoints de arquivo de NFS-e.

Pergunta que este script responde: os endpoints de PDF/XML do Conta Azul
aceitam o access token OAuth do ETL, sem cookie de sessão humana?

Garantias, todas verificáveis no código abaixo:
  - Nenhum corpo de resposta é gravado em disco. Todas as chamadas usam
    stream=True e leem no MÁXIMO 8 bytes, só para classificar a assinatura.
  - A resposta é fechada (resp.close()) sem consumir o restante do corpo.
  - Os 8 bytes NUNCA são publicados. Eles são comparados contra uma lista
    branca de assinaturas conhecidas (%PDF, <?xml, {, [ ...) e o relatório
    recebe apenas o RÓTULO da assinatura.
  - Nenhum header Authorization, token ou cookie é registrado. O relatório
    diz apenas "com_bearer: true|false".
  - Nenhum cookie é enviado: requests.Session() novo, sem cookie jar
    populado, e cada chamada passa cookies={} explicitamente.
  - Teto duro de 10 requisições aos hosts-alvo (MAX_REQS).
  - allow_redirects=False: redirecionamento é registrado, não seguido.
    Seguir um redirect para S3 poderia baixar conteúdo fiscal.

Reutiliza sem modificar: etl.auth.get_access_token, etl.db.get_connection.
NÃO usa etl.client.ContaAzulClient de propósito: ele prefixa API_BASE e faz
retry 10x em 5xx, o que estouraria o teto de requisições.
"""

import json
import logging
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta

import requests

from etl.auth import get_access_token
from etl.db import get_connection

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s -- %(message)s")
logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger("diag_dl")

MAX_REQS   = 10
TIMEOUT    = 25
PEEK_BYTES = 8

HOST_APP  = "https://services.contaazul.com"
HOST_PRO  = "https://pro.contaazul.com"
HOST_API  = "https://api-v2.contaazul.com"

INVOICE_ID   = "89439287"    # nota EMITIDA nº 364, id interno visto no BFF
NUMERO_ALVO  = 364

# Assinaturas permitidas no relatório. Nada fora desta lista é publicado.
ASSINATURAS = [
    (b"%PDF",        "%PDF (PDF)"),
    (b"<?xml",       "<?xml (XML)"),
    (b"<!DOCTYPE",   "<!DOCTYPE (HTML/XML)"),
    (b"<html",       "<html (HTML)"),
    (b"<Error",      "<Error (XML de erro S3/CloudFront)"),
    (b"{",           "{ (JSON objeto)"),
    (b"[",           "[ (JSON array)"),
    (b"PK\x03\x04",  "PK (ZIP)"),
]

_RE_DOC   = re.compile(r"\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})\b")
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_RE_BEARER = re.compile(r"(?i)bearer\s+\S+")

_reqs = 0

RELATORIO = {
    "gerado_em_utc": None,
    "alvo": {},
    "chamadas": [],
    "erros": [],
    "conclusoes": {},
    "orcamento": {"teto": MAX_REQS, "usadas": 0},
}


def scrub(t, limite=120):
    t = _RE_BEARER.sub("<bearer redigido>", str(t))
    t = _RE_EMAIL.sub("<email>", t)
    t = _RE_DOC.sub("<doc>", t)
    return t[:limite] + ("…" if len(t) > limite else "")


def mask_id(v):
    s = str(v)
    return f"{s[:8]}…{s[-4:]}" if len(s) > 12 else s


def assinatura(primeiros: bytes) -> str:
    """Classifica os primeiros bytes contra a lista branca. Nunca os publica."""
    for magic, rotulo in ASSINATURAS:
        if primeiros.startswith(magic):
            return rotulo
    if not primeiros:
        return "(corpo vazio)"
    return "assinatura não reconhecida (bytes não publicados)"


def classificar(status, ctype, assin, tem_bearer):
    """Traduz o resultado para o vocabulário pedido no escopo."""
    c = (ctype or "").lower()
    if status == 200 and ("pdf" in c or "%PDF" in assin):
        return "OAuth funciona" if tem_bearer else "acesso sem autenticação (!)"
    if status == 200 and ("xml" in c or "json" in c):
        return "OAuth funciona (payload não-binário — checar se é envelope)" if tem_bearer \
               else "acesso sem autenticação (!)"
    if status in (401, 403):
        return "OAuth recusado / cookie obrigatório"
    if status == 404:
        return "endpoint inexistente ou identificador inválido"
    if status == 400:
        return "identificador inválido ou filtro obrigatório ausente"
    if status in (301, 302, 303, 307, 308):
        return "redirecionamento (não seguido)"
    if status and status >= 500:
        return "resultado inconclusivo (erro do servidor)"
    return "resultado inconclusivo"


def chamar(rotulo, url, token=None, params=None):
    """
    Uma requisição controlada. Lê no máximo PEEK_BYTES do corpo e fecha.
    Nunca grava o corpo. Nunca registra o header Authorization.
    """
    global _reqs
    if _reqs >= MAX_REQS:
        RELATORIO["chamadas"].append({"rotulo": rotulo, "pulada": True,
                                      "motivo": f"teto de {MAX_REQS} requisições atingido"})
        return None
    _reqs += 1
    RELATORIO["orcamento"]["usadas"] = _reqs

    headers = {"Accept": "*/*"}
    if token:
        headers["Authorization"] = f"Bearer {token}"     # nunca logado

    reg = {
        "rotulo": rotulo,
        "host": url.split("/")[2],
        "path": "/" + "/".join(url.split("/")[3:]).split("?")[0],
        "metodo": "GET",
        "com_bearer": bool(token),
        "cookies_enviados": False,
        "params": sorted(params.keys()) if params else [],
    }

    resp = None
    try:
        # cookies={} garante que nenhum cookie é enviado.
        # allow_redirects=False evita seguir redirect e baixar conteúdo.
        resp = requests.get(url, headers=headers, params=params, cookies={},
                            allow_redirects=False, stream=True, timeout=TIMEOUT)
        # iter_content descomprime (gzip/deflate); resp.raw.read() não, e
        # devolveria bytes comprimidos que quebrariam a detecção de assinatura.
        # Lemos UM chunk pequeno e paramos — o resto do corpo nunca é baixado.
        try:
            chunk = next(resp.iter_content(chunk_size=512)) or b""
        except StopIteration:
            chunk = b""
        primeiros = chunk[:PEEK_BYTES]
        loc = resp.headers.get("location")
        cd = resp.headers.get("content-disposition")
        if cd:
            cd = re.sub(r'(filename\*?=)("?)([^";]*)\2',
                        lambda m: m.group(1) + m.group(2) + re.sub(r"[A-Za-z0-9]", "x", m.group(3)) + m.group(2),
                        cd)
        reg.update({
            "status": resp.status_code,
            "content_type": resp.headers.get("content-type"),
            "content_length": resp.headers.get("content-length"),
            "content_disposition": cd,
            "redirecionamento_para_host": (loc.split("/")[2] if loc and "//" in loc else loc),
            "assinatura": assinatura(primeiros),
        })
        # Corpo de erro textual curto ajuda a distinguir "token recusado" de
        # "id inválido". SOMENTE para respostas >= 400 cuja assinatura já é
        # texto estruturado (JSON/XML) — nunca para 200 nem para binário.
        # Logo, nenhum byte de PDF/XML fiscal entra no relatório.
        if resp.status_code >= 400 and reg["assinatura"].startswith(("{", "[", "<Error", "<?xml")):
            reg["mensagem_de_erro_sanitizada"] = scrub(
                chunk.decode("utf-8", "replace").replace("\n", " "))
        reg["classificacao"] = classificar(resp.status_code, reg["content_type"],
                                           reg["assinatura"], bool(token))
        RELATORIO["chamadas"].append(reg)
        logger.info("%-28s -> %s %s | %s", rotulo, resp.status_code,
                    reg["content_type"], reg["classificacao"])
        return reg
    except Exception as exc:
        reg.update({"status": None, "erro": scrub(f"{type(exc).__name__}: {exc}"),
                    "classificacao": "resultado inconclusivo"})
        RELATORIO["chamadas"].append(reg)
        logger.error("%-28s -> falhou: %s", rotulo, reg["erro"])
        return reg
    finally:
        # Fecha sem consumir o restante: nada de conteúdo fiscal em memória
        # nem em disco.
        if resp is not None:
            resp.close()


def buscar_uuid_da_nota():
    """UUID da nota 364, lido do banco (somente leitura)."""
    conn = get_connection()
    conn.set_session(readonly=True)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text, numero, status, data_competencia::text "
                "FROM ca.notas_fiscais WHERE numero = %s OR numero_nfse = %s LIMIT 1",
                (NUMERO_ALVO, NUMERO_ALVO))
            r = cur.fetchone()
    finally:
        conn.close()
    if not r:
        raise RuntimeError(f"nota nº {NUMERO_ALVO} não encontrada em ca.notas_fiscais")
    return r[0], {"numero": r[1], "status": r[2], "data_competencia": r[3]}


def main() -> int:
    RELATORIO["gerado_em_utc"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    uuid_nota, meta = buscar_uuid_da_nota()
    RELATORIO["alvo"] = {
        "invoice_id_interno": INVOICE_ID,
        "numero_nfse": NUMERO_ALVO,
        "uuid_mascarado": mask_id(uuid_nota),
        **meta,
    }
    logger.info("Alvo: NFS-e %s | invoiceId %s | uuid %s",
                NUMERO_ALVO, INVOICE_ID, mask_id(uuid_nota))

    token = get_access_token()          # nunca logado
    if not token:
        logger.error("get_access_token() não retornou token.")
        return 1
    logger.info("Autenticado via etl.auth (token não é registrado em log).")

    # ── 1. PDF sem Authorization: o endpoint é público? ──────────────────────
    chamar("1-pdf-invoiceid-sem-auth", f"{HOST_APP}/app/serviceinvoice/v2/{INVOICE_ID}.pdf")

    # ── 2. PDF com Bearer OAuth ─────────────────────────────────────────────
    chamar("2-pdf-invoiceid-bearer", f"{HOST_APP}/app/serviceinvoice/v2/{INVOICE_ID}.pdf", token)

    # ── 3. XML com Bearer OAuth ─────────────────────────────────────────────
    chamar("3-xml-invoiceid-bearer", f"{HOST_APP}/app/serviceinvoice/v2/{INVOICE_ID}.xml", token)

    # ── 4. UUID no lugar do invoiceId ───────────────────────────────────────
    chamar("4a-pdf-uuid-bearer", f"{HOST_APP}/app/serviceinvoice/v2/{uuid_nota}.pdf", token)
    chamar("4b-xml-uuid-bearer", f"{HOST_APP}/app/serviceinvoice/v2/{uuid_nota}.xml", token)

    # ── 5. BFF com Bearer, sem cookie ───────────────────────────────────────
    r6 = chamar("5a-bff-sem-filtros", f"{HOST_APP}/app/service-invoices/v1", token)
    if r6 and r6.get("status") in (400, 422):
        hoje = date.today()
        chamar("5b-bff-com-filtros", f"{HOST_APP}/app/service-invoices/v1", token, params={
            "startDate": (hoje - timedelta(days=90)).strftime("%Y-%m-%d"),
            "endDate":   hoje.strftime("%Y-%m-%d"),
            "page": 1, "size": 1,
        })

    # ── 6. Existe rota OAuth que devolva o invoiceId a partir do UUID? ──────
    chamar("6a-api-consulta-individual", f"{HOST_API}/v1/notas-fiscais-servico/{uuid_nota}", token)
    chamar("6b-api-listagem-por-ids", f"{HOST_API}/v1/notas-fiscais-servico", token, params={
        "ids": uuid_nota,
        "data_competencia_de":  "2026-05-15",
        "data_competencia_ate": "2026-05-30",
        "pagina": 1, "tamanho_pagina": 1,
    })

    # ── Host alternativo visto no BFF (pdfUrl da nota escriturada) ──────────
    chamar("7-pdf-host-pro-bearer", f"{HOST_PRO}/rest/serviceinvoice/v2/{INVOICE_ID}.pdf", token)

    montar_conclusoes()
    escrever_artefatos()
    logger.info("Requisições usadas: %d de %d", _reqs, MAX_REQS)
    return 0


def montar_conclusoes():
    por = {c["rotulo"]: c for c in RELATORIO["chamadas"] if not c.get("pulada")}

    def ok_arquivo(rot, tipo):
        c = por.get(rot) or {}
        return c.get("status") == 200 and (
            tipo in (c.get("content_type") or "").lower() or tipo.upper() in (c.get("assinatura") or ""))

    def sim_nao(v):
        return "SIM" if v is True else ("NÃO" if v is False else "INCONCLUSIVO")

    pdf_bearer = ok_arquivo("2-pdf-invoiceid-bearer", "pdf")
    xml_bearer = (por.get("3-xml-invoiceid-bearer", {}).get("status") == 200)
    uuid_ok    = any((por.get(r, {}).get("status") == 200) for r in ("4a-pdf-uuid-bearer", "4b-xml-uuid-bearer"))
    bff_ok     = any((por.get(r, {}).get("status") == 200) for r in ("5a-bff-sem-filtros", "5b-bff-com-filtros"))
    sem_auth   = por.get("1-pdf-invoiceid-sem-auth", {}).get("status") == 200

    RELATORIO["conclusoes"] = {
        "A_pdf_via_backend_oauth": sim_nao(pdf_bearer),
        "B_xml_via_backend_oauth": sim_nao(xml_bearer),
        "C_uuid_no_lugar_do_invoiceid": sim_nao(uuid_ok),
        "D_bff_devolve_invoiceid_com_oauth": sim_nao(bff_ok),
        "E_caminho_automatizavel_sem_sessao_humana": sim_nao(
            bool(pdf_bearer and (uuid_ok or bff_ok))),
        "endpoint_publico_sem_autenticacao": sim_nao(sem_auth),
        "classificacoes": {k: v.get("classificacao") for k, v in por.items()},
    }


def escrever_artefatos():
    with open("diag_download_notas.json", "w", encoding="utf-8") as f:
        json.dump(RELATORIO, f, ensure_ascii=False, indent=2, default=str)
    L = ["# Diagnóstico de download de NFS-e (server-side, sanitizado)", ""]
    L.append(f"- Gerado em (UTC): {RELATORIO['gerado_em_utc']}")
    L.append(f"- Requisições: {RELATORIO['orcamento']['usadas']} de {RELATORIO['orcamento']['teto']}")
    L.append("- Nenhum corpo de resposta foi gravado. Só assinatura de 8 bytes, classificada por lista branca.")
    for titulo, chave in [("Alvo", "alvo"), ("Chamadas", "chamadas"),
                          ("Conclusões", "conclusoes"), ("Erros", "erros")]:
        if RELATORIO.get(chave):
            L += ["", f"## {titulo}", "", "```json",
                  json.dumps(RELATORIO[chave], ensure_ascii=False, indent=2, default=str), "```"]
    with open("diag_download_notas.md", "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    logger.info("Artefatos escritos: diag_download_notas.json, diag_download_notas.md")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        logger.error("Falha no diagnóstico: %s", scrub(str(exc)))
        traceback.print_exc()
        try:
            escrever_artefatos()
        except Exception:
            pass
        sys.exit(1)
