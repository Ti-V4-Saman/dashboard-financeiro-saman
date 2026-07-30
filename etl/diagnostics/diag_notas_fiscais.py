"""
etl/diagnostics/diag_notas_fiscais.py

TEMPORÁRIO — SOMENTE DIAGNÓSTICO. Não faz parte do ETL de produção.
Não escreve nada em ca.notas_fiscais nem em qualquer tabela de dados.
A única escrita possível no banco é a rotação do refresh token feita por
etl.auth.get_access_token(), que é o mecanismo já existente do ETL.

Objetivo: investigar a diferença entre notas EMITIDAS pelo botão
"Emitir NFS-e" e notas ESCRITURADAS pelo botão "Escriturar NFS-e",
e rastrear o caminho API -> mapper -> banco -> dashboard.

Reutiliza, sem modificar:
  - etl.auth.get_access_token          (autenticação e rotação de token)
  - etl.client.ContaAzulClient         (HTTP, retry, paginação)
  - etl.sync.financeiro._map_nota_fiscal (mapper de produção, só leitura)

Saídas:
  - log resumido e sanitizado em stdout
  - artefatos sanitizados: diag_nf_report.json e diag_nf_report.md

PROTEÇÃO DE DADOS
  Nenhum JSON bruto é impresso. Valores só aparecem se a chave estiver na
  allowlist SAFE_VALUE_KEYS. Todo o resto vira metadado ({tipo, tamanho}).
  CPF/CNPJ, e-mail, telefone e dados bancários são mascarados por chave e,
  redundantemente, por regex sobre qualquer texto liberado.
"""

import json
import logging
import os
import re
import sys
import traceback
from collections import Counter
from datetime import date, datetime, timedelta

from etl.auth import get_access_token
from etl.client import ContaAzulClient
from etl.db import get_connection
from etl.sync.financeiro import _map_nota_fiscal

# ── Configuração ──────────────────────────────────────────────────────────────

NFSE_PATH = "/notas-fiscais-servico"
NFE_PATH  = "/notas-fiscais"

CHUNK_DAYS       = 14      # NFS-e: range máximo de 15 dias por janela
JANELA_PADRAO    = 180     # dias para trás quando data_de não é informada
MAX_REQUISICOES  = 220     # teto duro; se estourar, o relatório diz o que faltou
MAX_AMOSTRAS     = 3       # por grupo (escrituradas / não escrituradas)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s -- %(message)s",
)
# Evita que urllib3 logue URLs completas com query string.
logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger("diag_nf")

_req_count = 0


def _budget_ok(rotulo: str) -> bool:
    """Controla o teto de requisições e registra o que foi cortado."""
    global _req_count
    if _req_count >= MAX_REQUISICOES:
        RELATORIO["cortes"].append(f"teto de {MAX_REQUISICOES} requisições atingido antes de: {rotulo}")
        return False
    _req_count += 1
    return True


# ── Campos que o diagnóstico deve investigar (lista pedida no escopo) ─────────

CAMPOS_INVESTIGADOS = [
    "id", "status", "numero", "number", "numero_nfse", "venda", "id_venda",
    "sale", "cliente", "customer", "cliente_id", "nome_cliente",
    "documento_cliente", "data_competencia", "data_emissao", "emission_date",
    "informacao_transmissao", "data_inicio_emissao", "informacoes_cancelamento",
    "escriturado_manualmente", "tipo_negociacao", "tipo", "serie",
    "chave_acesso", "url", "pdf", "xml", "download", "arquivo", "anexos",
]

# Chaves brutas que _map_nota_fiscal realmente consome (lidas do código-fonte
# de produção em etl/sync/financeiro.py:385-405). Serve para calcular o
# conjunto de campos DESCARTADOS pelo mapper.
CHAVES_CONSUMIDAS_PELO_MAPPER = {
    "id", "uuid", "numero", "number", "numero_nfse", "serie", "series",
    "status", "situacao", "chave_acesso", "access_key", "data_emissao",
    "emission_date", "data_competencia", "venda", "id_venda", "sale",
    "cliente", "customer", "valor_total", "total", "valor_total_nfse",
    "tipo", "type", "id_contrato", "contrato", "numero_venda", "numero_rps",
    "nome_cliente",
}

# Colunas existentes em ca.notas_fiscais (o upsert deriva colunas das chaves
# do mapper; nada fora desta lista pode ser persistido).
COLUNAS_TABELA = [
    "id", "numero", "serie", "status", "chave_acesso", "data_emissao",
    "venda_id", "cliente_id", "valor_total", "tipo", "synced_at",
    "contrato_id", "numero_venda", "numero_rps", "numero_nfse",
    "data_competencia", "nome_cliente",
]

# ── Sanitização ───────────────────────────────────────────────────────────────

_RE_DOC = re.compile(
    r"\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})\b"
)
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_RE_PHONE = re.compile(r"\+?\d{0,3}\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b")
_RE_LONGNUM = re.compile(r"\b\d{11,}\b")          # chaves de acesso, contas
_RE_BEARER = re.compile(r"(?i)bearer\s+\S+")

# Valores desta allowlist podem aparecer no log/artefato.
SAFE_VALUE_KEYS = {
    "status", "situacao", "numero", "number", "numero_nfse", "numero_rps",
    "numero_venda", "numero_nota", "serie", "series", "tipo", "type",
    "tipo_negociacao", "escriturado_manualmente", "data_competencia",
    "data_emissao", "emission_date", "data_inicio_emissao",
    "data_inicio_cancelamento", "cidade_emissao", "codigo_cnae",
    "valor_total", "total", "valor_total_nfse", "valor_iss", "valor_liquido",
    "motivo", "usuario_cancelamento", "content_type", "http_status",
}

# Chaves cujo valor NUNCA aparece, só metadado.
BLOCK_VALUE_KEYS = {
    "documento_cliente", "documento_tomador", "documento", "cpf", "cnpj",
    "nome_cliente", "nome_destinatario", "razao_social", "email", "e_mail",
    "telefone", "celular", "endereco", "logradouro", "bairro", "cep",
    "banco", "agencia", "conta", "conta_bancaria", "chave_pix", "pix",
    "observacoes", "descricao", "discriminacao", "usuario",
    "authorization", "token", "access_token", "refresh_token",
    "client_secret", "id_token",
}

CHAVES_ID = {
    "id", "uuid", "id_venda", "venda", "sale", "id_contrato", "contrato",
    "id_cliente", "cliente", "customer", "cliente_id", "venda_id",
    "contrato_id", "evento_id", "id_reconciliacao",
}

_RE_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


def mask_id(v):
    """UUID -> 'a1b2c3d4…9f8e' (suficiente para correlacionar, não expõe o todo)."""
    s = str(v)
    if _RE_UUID.match(s):
        return f"{s[:8]}…{s[-4:]}"
    if len(s) > 12:
        return f"{s[:4]}…{s[-4:]}"
    return s


def scrub(texto: str, limite: int = 80) -> str:
    """Remove PII residual de qualquer texto liberado e limita o tamanho."""
    t = _RE_BEARER.sub("<bearer:redacted>", str(texto))
    t = _RE_EMAIL.sub("<email>", t)
    t = _RE_DOC.sub("<doc>", t)
    t = _RE_PHONE.sub("<fone>", t)
    t = _RE_LONGNUM.sub("<num-longo>", t)
    if len(t) > limite:
        t = t[:limite] + "…"
    return t


def sanitize(chave, valor, _prof: int = 0):
    """
    Converte um valor de payload em algo publicável.
    Allowlist para valores; todo o resto vira {tipo, tamanho}.
    """
    k = str(chave).lower()

    if _prof > 4:
        return "<profundidade-max>"

    if valor is None:
        return None

    if isinstance(valor, bool):
        return valor

    if isinstance(valor, dict):
        return {kk: sanitize(kk, vv, _prof + 1) for kk, vv in valor.items()}

    if isinstance(valor, list):
        amostra = [sanitize(chave, v, _prof + 1) for v in valor[:3]]
        return {"_lista": True, "n": len(valor), "amostra": amostra}

    if k in BLOCK_VALUE_KEYS:
        return {"_tipo": type(valor).__name__, "_len": len(str(valor))}

    if k in CHAVES_ID:
        return mask_id(valor)

    if isinstance(valor, (int, float)):
        return valor if k in SAFE_VALUE_KEYS else {"_tipo": type(valor).__name__}

    if isinstance(valor, str):
        if _RE_UUID.match(valor):
            return mask_id(valor)
        if k in SAFE_VALUE_KEYS:
            return scrub(valor)
        return {"_tipo": "str", "_len": len(valor)}

    return {"_tipo": type(valor).__name__}


def inventario_campos(raw: dict) -> dict:
    """Estrutura + tipos + valores não sensíveis de um payload."""
    inv = {}
    for k, v in raw.items():
        inv[k] = {"tipo": type(v).__name__, "valor": sanitize(k, v)}
    return inv


def presenca_campos_investigados(raw: dict) -> dict:
    """Para cada campo da lista do escopo: presente? tipo? valor liberado?"""
    out = {}
    for campo in CAMPOS_INVESTIGADOS:
        if campo in raw:
            out[campo] = {
                "presente": True,
                "tipo": type(raw[campo]).__name__,
                "valor": sanitize(campo, raw[campo]),
            }
        else:
            out[campo] = {"presente": False}
    return out


# ── Relatório acumulado ───────────────────────────────────────────────────────

RELATORIO = {
    "gerado_em_utc": None,
    "janela": {},
    "cortes": [],
    "erros": [],
    "endpoints": {},
    "amostras": [],
    "arquivos_nota": {},
    "dashboard": {},
    "conclusoes": {},
}


def _erro(rotulo: str, exc: Exception):
    msg = scrub(f"{type(exc).__name__}: {exc}", limite=200)
    logger.error("%s -> %s", rotulo, msg)
    RELATORIO["erros"].append({"etapa": rotulo, "erro": msg})


# ── Etapa 1: coleta na API ────────────────────────────────────────────────────

def janelas(de: date, ate: date):
    cursor = de
    while cursor <= ate:
        fim = min(cursor + timedelta(days=CHUNK_DAYS), ate)
        yield cursor, fim
        cursor = fim + timedelta(days=1)


def coletar_nfse(client, de, ate):
    """Mesma paginação e mesmos parâmetros usados por sync_notas_fiscais."""
    itens = []
    for ini, fim in janelas(de, ate):
        if not _budget_ok(f"NFS-e {ini}..{fim}"):
            break
        try:
            chunk = client.get_all(NFSE_PATH, extra_params={
                "data_competencia_de":  ini.strftime("%Y-%m-%d"),
                "data_competencia_ate": fim.strftime("%Y-%m-%d"),
            })
            itens.extend(chunk or [])
        except Exception as exc:
            _erro(f"coletar_nfse {ini}..{fim}", exc)
    return itens


def sondar_nfe(client, de, ate):
    """
    Compara os DOIS conjuntos de parâmetros em /notas-fiscais:
      (a) data_competencia_de/ate  -> o que sync_notas_fiscais usa hoje
      (b) data_inicial/data_final  -> o que a doc do endpoint especifica
    Só status code; nenhum corpo é publicado.
    """
    res = {}
    base = {"pagina": 1, "tamanho_pagina": 10}
    tentativas = {
        "params_do_etl_atual": dict(base, **{
            "data_competencia_de":  de.strftime("%Y-%m-%d"),
            "data_competencia_ate": min(de + timedelta(days=CHUNK_DAYS), ate).strftime("%Y-%m-%d"),
        }),
        "params_da_documentacao": dict(base, **{
            "data_inicial": de.strftime("%Y-%m-%d"),
            "data_final":   min(de + timedelta(days=CHUNK_DAYS), ate).strftime("%Y-%m-%d"),
        }),
    }
    for rotulo, params in tentativas.items():
        if not _budget_ok(f"NF-e probe {rotulo}"):
            continue
        try:
            resp = client._request("GET", NFE_PATH, params=params)
            body_items = []
            if resp.ok:
                try:
                    body_items = client._extract_items(resp.json())
                except Exception:
                    body_items = []
            res[rotulo] = {
                "http_status": resp.status_code,
                "content_type": resp.headers.get("content-type"),
                "itens_retornados": len(body_items),
                "chaves_do_primeiro_item": sorted(body_items[0].keys()) if body_items and isinstance(body_items[0], dict) else [],
                "seria_considerado_disponivel_pelo_etl": resp.status_code not in (400, 404),
            }
        except Exception as exc:
            _erro(f"sondar_nfe {rotulo}", exc)
    return res


def coletar_nfe_correto(client, de, ate):
    """Coleta NF-e com os parâmetros corretos, para saber se existe NF-e real."""
    itens = []
    for ini, fim in janelas(de, ate):
        if not _budget_ok(f"NF-e {ini}..{fim}"):
            break
        try:
            resp = client._request("GET", NFE_PATH, params={
                "data_inicial": ini.strftime("%Y-%m-%d"),
                "data_final":   fim.strftime("%Y-%m-%d"),
                "pagina": 1, "tamanho_pagina": 100,
            })
            if resp.ok:
                itens.extend(client._extract_items(resp.json()))
        except Exception as exc:
            _erro(f"coletar_nfe_correto {ini}..{fim}", exc)
    return itens


# ── Etapa 2: escolha de amostras (sem presumir qual é manual) ─────────────────

def escolher_amostras(itens):
    """
    Separa por escriturado_manualmente SEM assumir semântica.
    Se o campo não vier na listagem, reporta isso e cai para amostragem
    por status/venda, deixando explícito que a classificação é indefinida.
    """
    num_manual  = os.getenv("DIAG_NUMERO_NOTA_MANUAL", "").strip()
    num_emitida = os.getenv("DIAG_NUMERO_NOTA_EMITIDA", "").strip()
    venda_manual  = os.getenv("DIAG_VENDA_ID_MANUAL", "").strip()
    venda_emitida = os.getenv("DIAG_VENDA_ID_EMITIDA", "").strip()

    def bate(item, numero, venda):
        if numero:
            for k in ("numero_nfse", "numero", "numero_rps", "numero_nota"):
                if str(item.get(k, "")) == numero:
                    return True
        if venda:
            if str(item.get("id_venda", "")).lower() == venda.lower():
                return True
        return False

    selecionadas, rotulos = [], []

    for rotulo, numero, venda in (
        ("informada_como_manual",  num_manual,  venda_manual),
        ("informada_como_emitida", num_emitida, venda_emitida),
    ):
        if numero or venda:
            achou = [i for i in itens if bate(i, numero, venda)]
            for i in achou[:1]:
                selecionadas.append(i)
                rotulos.append(rotulo)
            if not achou:
                RELATORIO["cortes"].append(
                    f"{rotulo}: nenhum item da janela casou com o identificador informado"
                )

    campo_presente = any("escriturado_manualmente" in i for i in itens)
    RELATORIO["endpoints"].setdefault("nfse", {})["campo_escriturado_manualmente_na_listagem"] = campo_presente

    if campo_presente:
        grupo_true  = [i for i in itens if i.get("escriturado_manualmente") is True]
        grupo_false = [i for i in itens if i.get("escriturado_manualmente") is False]
        for i in grupo_true[:MAX_AMOSTRAS]:
            if i not in selecionadas:
                selecionadas.append(i); rotulos.append("escriturado_manualmente=true")
        for i in grupo_false[:MAX_AMOSTRAS]:
            if i not in selecionadas:
                selecionadas.append(i); rotulos.append("escriturado_manualmente=false")
    else:
        # Sem o campo, não presumimos nada: amostramos por status distinto.
        vistos = set()
        for i in itens:
            st = i.get("status")
            if st not in vistos:
                vistos.add(st)
                selecionadas.append(i)
                rotulos.append(f"classificacao_indefinida/status={st}")
            if len(selecionadas) >= MAX_AMOSTRAS * 2:
                break

    return list(zip(rotulos, selecionadas))


# ── Etapa 3: consulta individual + arquivos ───────────────────────────────────

CANDIDATOS_ARQUIVO = [
    ("GET", "{base}/{id}",            "consulta individual"),
    ("GET", "{base}/{id}/pdf",        "PDF"),
    ("GET", "{base}/{id}/xml",        "XML"),
    ("GET", "{base}/{id}/danfse",     "DANFSe"),
    ("GET", "{base}/{id}/download",   "download genérico"),
    ("GET", "{base}/{id}/arquivo",    "arquivo"),
    ("GET", "{base}/{id}/documentos", "documentos"),
]

_RE_URL = re.compile(r"https?://[^\s\"']+")


def consultar_individual(client, nota_id):
    if not _budget_ok(f"consulta individual {mask_id(nota_id)}"):
        return None
    try:
        return client.get(f"{NFSE_PATH}/{nota_id}")
    except Exception as exc:
        _erro(f"consulta individual {mask_id(nota_id)}", exc)
        return None


def sondar_arquivos(client, nota_id, payload_individual):
    """
    Uma única nota, no máximo 7 requisições. Nenhum conteúdo fiscal é
    publicado: só status, content-type e tamanho em bytes.
    """
    resultado = {"nota": mask_id(nota_id), "tentativas": [], "urls_no_payload": []}

    if isinstance(payload_individual, dict):
        texto = json.dumps(payload_individual, ensure_ascii=False, default=str)
        for url in set(_RE_URL.findall(texto)):
            partes = url.split("?", 1)
            resultado["urls_no_payload"].append({
                "host_e_path": partes[0][:120],
                "tem_query_string": len(partes) > 1,
                "query_omitida": len(partes) > 1,
            })
        for k in ("url", "pdf", "xml", "danfse", "download", "arquivo", "anexos", "links"):
            if k in payload_individual:
                resultado.setdefault("chaves_de_arquivo_presentes", []).append(k)

    for metodo, tmpl, rotulo in CANDIDATOS_ARQUIVO:
        path = tmpl.format(base=NFSE_PATH, id=nota_id)
        if not _budget_ok(f"arquivo {rotulo}"):
            break
        try:
            resp = client._request(metodo, path)
            resultado["tentativas"].append({
                "rotulo": rotulo,
                "endpoint": tmpl.format(base=NFSE_PATH, id="{id}"),
                "metodo": metodo,
                "http_status": resp.status_code,
                "content_type": resp.headers.get("content-type"),
                "bytes": len(resp.content or b""),
                "utilizavel": bool(resp.ok and resp.content),
            })
        except Exception as exc:
            resultado["tentativas"].append({
                "rotulo": rotulo, "erro": scrub(str(exc), 120),
            })
    return resultado


# ── Etapa 4: mapper e banco ───────────────────────────────────────────────────

def analisar_mapper(raw):
    mapeado = _map_nota_fiscal(raw)
    persistiveis, vazios = {}, []
    for col, val in mapeado.items():
        if col == "synced_at":
            continue
        if val in (None, "", 0, 0.0):
            vazios.append(col)
        persistiveis[col] = sanitize(col, val)

    descartados = sorted(set(raw.keys()) - CHAVES_CONSUMIDAS_PELO_MAPPER)
    fora_da_tabela = sorted(set(mapeado.keys()) - set(COLUNAS_TABELA))

    return {
        "reconhecido_pelo_mapper": bool(mapeado.get("id")),
        "campos_persistidos": persistiveis,
        "campos_mapeados_mas_vazios": sorted(vazios),
        "campos_do_payload_descartados": descartados,
        "campos_do_mapper_sem_coluna_na_tabela": fora_da_tabela,
    }


SQL_NOTA = """
SELECT id::text, numero, serie, status, chave_acesso, data_emissao::text,
       venda_id::text, cliente_id::text, valor_total::float, tipo,
       contrato_id::text, numero_venda, numero_rps, numero_nfse,
       data_competencia::text, nome_cliente, synced_at::text
FROM ca.notas_fiscais WHERE id = %s
"""


def analisar_banco(cur, nota_id):
    try:
        cur.execute(SQL_NOTA, (nota_id,))
        row = cur.fetchone()
        if not row:
            return {"existe_no_banco": False}
        cols = [d[0] for d in cur.description]
        d = dict(zip(cols, row))
        return {
            "existe_no_banco": True,
            "colunas": {k: sanitize(k, v) for k, v in d.items()},
            "venda_id_nulo": d.get("venda_id") is None,
            "cliente_id_nulo": d.get("cliente_id") is None,
        }
    except Exception as exc:
        _erro(f"analisar_banco {mask_id(nota_id)}", exc)
        return {"existe_no_banco": "erro"}


# ── Etapa 5: simulação da rota /api/notas-fiscais ─────────────────────────────
# SQL copiado do ramo 'competencia' de app/api/notas-fiscais/route.ts (linhas
# 147-196) e da query de cobertura (linhas 268-272). Somente leitura.

SQL_VENDAS_COMPETENCIA = """
WITH parcelas_status AS (
  SELECT cr.id_venda, pr.id AS parcela_id,
    (pr.conciliado IS TRUE OR EXISTS (
      SELECT 1 FROM ca.baixas b2
      WHERE b2.evento_id = pr.id AND b2.id_reconciliacao IS NOT NULL
    )) AS conciliada
  FROM ca.contas_receber cr
  JOIN ca.parcelas_receber pr ON pr.conta_receber_id = cr.id
  WHERE cr.id_venda IS NOT NULL
    AND cr.status NOT IN ('Cancelado','Renegociado')
    AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
),
vendas_competencia AS (
  SELECT cr.id_venda,
    MIN(COALESCE(cr.data_competencia, cr.data_vencimento)) AS data_ref
  FROM ca.contas_receber cr
  WHERE cr.id_venda IS NOT NULL
    AND cr.status NOT IN ('Cancelado','Renegociado')
    AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
    AND COALESCE(cr.data_competencia, cr.data_vencimento) BETWEEN %s AND %s
  GROUP BY cr.id_venda
)
SELECT vc.id_venda::text
FROM vendas_competencia vc
LEFT JOIN ca.vendas v ON v.id = vc.id_venda
WHERE
  (v.id_contrato IS NULL AND EXISTS (
    SELECT 1 FROM parcelas_status ps WHERE ps.id_venda = vc.id_venda AND ps.conciliada))
  OR
  (v.id_contrato IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM parcelas_status ps WHERE ps.id_venda = vc.id_venda AND NOT ps.conciliada))
"""

SQL_A_RECEBER = """
SELECT cr.id_venda::text
FROM ca.contas_receber cr
WHERE cr.id_venda IS NOT NULL
  AND cr.status IN ('Aberto', 'Atrasado', 'Parcial')
  AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
  AND cr.data_vencimento BETWEEN %s AND %s
GROUP BY cr.id_venda
"""


def simular_dashboard(cur, amostras_db, de, ate):
    """
    Reproduz as condições da rota sem alterá-la:
      - entra em rows?  (nf.data_emissao BETWEEN de AND ate)
      - qual kind?      (EMITIDA -> emitida; CANCELADA/CANCELAMENTO_MANUAL -> cancelada; resto -> falha)
      - conta na cobertura? (status = 'EMITIDA' AND venda_id no conjunto de vendas recebidas+conciliadas)
    """
    out = {"janela": {"de": de, "ate": ate}, "regime_simulado": "competencia", "notas": []}
    try:
        cur.execute(SQL_VENDAS_COMPETENCIA, (de, ate))
        vendas_recebidas = {r[0] for r in cur.fetchall()}
        cur.execute(SQL_A_RECEBER, (de, ate))
        vendas_a_receber = {r[0] for r in cur.fetchall()}
        out["vendas_recebidas_conciliadas_na_janela"] = len(vendas_recebidas)
        out["vendas_a_receber_na_janela"] = len(vendas_a_receber)
    except Exception as exc:
        _erro("simular_dashboard/vendas", exc)
        return out

    for item in amostras_db:
        nota_id = item["nota_id"]
        banco = item["banco"]
        if not banco.get("existe_no_banco") or banco.get("existe_no_banco") == "erro":
            out["notas"].append({
                "nota": mask_id(nota_id),
                "entra_em_rows": False,
                "motivo": "não existe em ca.notas_fiscais — a rota lê apenas do banco",
            })
            continue

        cols = banco["colunas"]
        status = cols.get("status")
        data_emissao = cols.get("data_emissao")
        # venda_id vem mascarado no relatório; para a lógica usamos o valor real
        venda_real = item.get("venda_id_real")

        entra = bool(data_emissao and de <= str(data_emissao) <= ate)
        if status == "EMITIDA":
            kind = "emitida"
        elif status in ("CANCELADA", "CANCELAMENTO_MANUAL"):
            kind = "cancelada"
        else:
            kind = "falha"

        no_denominador = bool(venda_real and venda_real in vendas_recebidas)
        cobre = bool(venda_real and status == "EMITIDA" and venda_real in (vendas_recebidas | vendas_a_receber))

        impedimento = None
        if not entra:
            impedimento = "data_emissao fora da janela consultada"
        elif status != "EMITIDA":
            impedimento = f"status '{status}' != 'EMITIDA' — a query de cobertura filtra status = 'EMITIDA'"
        elif not venda_real:
            impedimento = "venda_id nulo no banco — não há como vincular à venda"
        elif not no_denominador:
            impedimento = "venda não está no conjunto recebidas+conciliadas da janela (fora do denominador)"

        out["notas"].append({
            "nota": mask_id(nota_id),
            "status_no_banco": status,
            "entra_em_rows": entra,
            "kind": kind,
            "conta_como_emitida": kind == "emitida",
            "classificada_como_falha": kind == "falha",
            "venda_no_denominador_de_cobertura": no_denominador,
            "cobriria_a_venda": cobre,
            "condicao_que_impede": impedimento,
        })
    return out


# ── Relatório final ───────────────────────────────────────────────────────────

def montar_conclusoes(itens_nfse, amostras, nfe_probe, arquivos):
    campo = RELATORIO["endpoints"].get("nfse", {}).get("campo_escriturado_manualmente_na_listagem")

    def sim_nao(v):
        return "SIM" if v is True else ("NÃO" if v is False else "INCONCLUSIVO")

    status_vistos = sorted({
        a["campos_investigados"].get("status", {}).get("valor")
        for a in amostras if a.get("campos_investigados")
    } - {None})

    # arquivos_nota contém, além dos dicts por nota, a chave textual "_escopo".
    # Filtrar por isinstance evita AttributeError ao chamar .get() numa str.
    tem_arquivo = any(
        t.get("utilizavel")
        for r in arquivos.values() if isinstance(r, dict)
        for t in r.get("tentativas", [])
        if t.get("rotulo") != "consulta individual"
    ) if arquivos else None

    return {
        "A_notas_escrituradas_aparecem_na_api": sim_nao(bool(itens_nfse)) if campo else "INCONCLUSIVO",
        "B_campo_que_identifica_escrituracao_manual":
            "escriturado_manualmente (presente na listagem)" if campo
            else "campo NÃO retornado pela listagem nesta organização — ver artefato",
        "C_status_observados": status_vistos,
        "D_possuem_venda_id": None,   # preenchido na análise por amostra
        "E_chegam_ao_banco": None,
        "F_campos_descartados_pelo_etl": None,
        "G_aparecem_no_dashboard": None,
        "H_contam_na_cobertura": None,
        "I_arquivos_pdf_xml_danfse": sim_nao(tem_arquivo),
        "J_causa_raiz": None,
        "K_menor_proximo_passo": None,
        "observacao": "Campos D-H e J-K são derivados por amostra em RELATORIO['amostras'] e RELATORIO['dashboard'].",
    }


def escrever_artefatos():
    with open("diag_nf_report.json", "w", encoding="utf-8") as f:
        json.dump(RELATORIO, f, ensure_ascii=False, indent=2, default=str)

    linhas = ["# Diagnóstico Notas Fiscais (sanitizado)", ""]
    linhas.append(f"- Gerado em (UTC): {RELATORIO['gerado_em_utc']}")
    linhas.append(f"- Janela: {RELATORIO['janela']}")
    linhas.append(f"- Requisições feitas: {_req_count} (teto {MAX_REQUISICOES})")
    if RELATORIO["cortes"]:
        linhas += ["", "## Cortes / limites atingidos", ""]
        linhas += [f"- {c}" for c in RELATORIO["cortes"]]
    if RELATORIO["erros"]:
        linhas += ["", "## Erros", ""]
        linhas += [f"- `{e['etapa']}`: {e['erro']}" for e in RELATORIO["erros"]]

    linhas += ["", "## Endpoints", "", "```json",
               json.dumps(RELATORIO["endpoints"], ensure_ascii=False, indent=2, default=str), "```"]
    linhas += ["", "## Amostras", "", "```json",
               json.dumps(RELATORIO["amostras"], ensure_ascii=False, indent=2, default=str), "```"]
    linhas += ["", "## Dashboard simulado", "", "```json",
               json.dumps(RELATORIO["dashboard"], ensure_ascii=False, indent=2, default=str), "```"]
    linhas += ["", "## Arquivos da nota", "", "```json",
               json.dumps(RELATORIO["arquivos_nota"], ensure_ascii=False, indent=2, default=str), "```"]
    linhas += ["", "## Conclusões", "", "```json",
               json.dumps(RELATORIO["conclusoes"], ensure_ascii=False, indent=2, default=str), "```"]

    with open("diag_nf_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")

    logger.info("Artefatos escritos: diag_nf_report.json, diag_nf_report.md")


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    RELATORIO["gerado_em_utc"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"

    hoje = date.today()
    de_s  = os.getenv("DIAG_DATA_DE", "").strip()
    ate_s = os.getenv("DIAG_DATA_ATE", "").strip()
    de  = date.fromisoformat(de_s)  if de_s  else hoje - timedelta(days=JANELA_PADRAO)
    ate = date.fromisoformat(ate_s) if ate_s else hoje
    RELATORIO["janela"] = {"de": de.isoformat(), "ate": ate.isoformat(),
                           "chunk_dias": CHUNK_DAYS + 1}
    logger.info("Janela de diagnóstico: %s .. %s", de, ate)

    # 1. Autenticação — mecanismo de produção, sem caminho paralelo.
    token = get_access_token()          # NUNCA logado
    if not token:
        logger.error("get_access_token() não retornou token.")
        return 1
    logger.info("Autenticado via etl.auth (token não é registrado em log).")
    client = ContaAzulClient(token)

    # 2. NFS-e
    itens_nfse = coletar_nfse(client, de, ate)
    logger.info("NFS-e coletadas na janela: %d", len(itens_nfse))
    chaves_uniao = sorted({k for i in itens_nfse if isinstance(i, dict) for k in i})
    RELATORIO["endpoints"].setdefault("nfse", {}).update({
        "path": NFSE_PATH,
        "params": ["data_competencia_de", "data_competencia_ate", "pagina", "tamanho_pagina"],
        "itens_na_janela": len(itens_nfse),
        "uniao_das_chaves_retornadas": chaves_uniao,
        "campos_investigados_ausentes_em_todos": [
            c for c in CAMPOS_INVESTIGADOS if c not in chaves_uniao
        ],
        "contagem_escriturado_manualmente": {
            "total_itens": len(itens_nfse),
            "true":        sum(1 for i in itens_nfse if i.get("escriturado_manualmente") is True),
            "false":       sum(1 for i in itens_nfse if i.get("escriturado_manualmente") is False),
            "sem_o_campo": sum(1 for i in itens_nfse if "escriturado_manualmente" not in i),
            "valor_null":  sum(1 for i in itens_nfse
                               if "escriturado_manualmente" in i
                               and i.get("escriturado_manualmente") is None),
        },
        "distribuicao_por_status": dict(
            sorted(Counter(str(i.get("status")) for i in itens_nfse).items())
        ),
    })

    # 3. NF-e: prova de qual conjunto de parâmetros funciona
    nfe_probe = sondar_nfe(client, de, ate)
    itens_nfe = coletar_nfe_correto(client, de, ate) if any(
        v.get("http_status") == 200 for v in nfe_probe.values()
    ) else []
    RELATORIO["endpoints"]["nfe"] = {
        "path": NFE_PATH,
        "comparacao_de_parametros": nfe_probe,
        "itens_com_params_corretos_na_janela": len(itens_nfe),
        "uniao_das_chaves_retornadas": sorted({k for i in itens_nfe if isinstance(i, dict) for k in i}),
    }

    # 4. Amostras
    amostras = escolher_amostras(itens_nfse)
    logger.info("Amostras selecionadas: %d", len(amostras))

    conn = get_connection()
    conn.set_session(readonly=True)     # garante zero escrita nesta conexão
    cur = conn.cursor()

    amostras_db = []
    for rotulo, raw in amostras:
        nota_id = raw.get("id")
        individual = consultar_individual(client, nota_id) if nota_id else None
        chaves_extra = sorted(set(individual) - set(raw)) if isinstance(individual, dict) else []

        banco = analisar_banco(cur, nota_id) if nota_id else {"existe_no_banco": False}
        venda_real = None
        try:
            cur.execute("SELECT venda_id::text FROM ca.notas_fiscais WHERE id = %s", (nota_id,))
            r = cur.fetchone()
            venda_real = r[0] if r else None
        except Exception as exc:
            _erro("venda_id real", exc)

        entrada = {
            "rotulo": rotulo,
            "nota": mask_id(nota_id),
            "retornada_pela_api": True,
            "campos_investigados": presenca_campos_investigados(raw),
            "inventario_listagem": inventario_campos(raw),
            "consulta_individual_disponivel": isinstance(individual, dict),
            "chaves_extra_na_consulta_individual": chaves_extra,
            "mapper": analisar_mapper(raw),
            "banco": banco,
        }
        RELATORIO["amostras"].append(entrada)
        amostras_db.append({"nota_id": nota_id, "banco": banco,
                            "venda_id_real": venda_real, "rotulo": rotulo,
                            "individual": individual})

    # 5. Arquivos — UMA nota só
    if amostras_db:
        alvo = amostras_db[0]
        if alvo["nota_id"]:
            RELATORIO["arquivos_nota"][mask_id(alvo["nota_id"])] = sondar_arquivos(
                client, alvo["nota_id"], alvo.get("individual")
            )
        RELATORIO["arquivos_nota"]["_escopo"] = (
            "sondagem limitada a 1 nota e 7 endpoints; nenhum conteúdo fiscal publicado"
        )

    # 6. Dashboard
    RELATORIO["dashboard"] = simular_dashboard(
        cur, amostras_db, de.isoformat(), ate.isoformat()
    )

    # 7. Conclusões
    RELATORIO["conclusoes"] = montar_conclusoes(
        itens_nfse, RELATORIO["amostras"], nfe_probe, RELATORIO["arquivos_nota"]
    )

    cur.close()
    conn.close()

    escrever_artefatos()
    logger.info("Diagnóstico concluído. Requisições: %d", _req_count)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        logger.error("Falha no diagnóstico: %s", scrub(str(exc), 200))
        traceback.print_exc()
        try:
            escrever_artefatos()
        except Exception:
            pass
        sys.exit(1)
