"""
etl/diagnostics/backfill_notas_fiscais.py

TEMPORÁRIO. Backfill controlado SOMENTE de notas fiscais.

Dois modos, escolhidos por BACKFILL_MODO:

  dry_run   — nenhuma escrita. Conexão aberta com set_session(readonly=True),
              o que faz o Postgres REJEITAR qualquer INSERT/UPDATE/DELETE no
              nível do servidor. Nem `upsert` nem `sync_notas_fiscais` são
              importados neste caminho.

  executar  — chama EXCLUSIVAMENTE sync_notas_fiscais(conn, client, mode="full").
              Nenhum outro sync, nenhum etl.main, nenhum DELETE.

Ressalva honesta sobre "não escrever": etl.auth.get_access_token() rotaciona o
refresh token e grava em ca.config usando conexão PRÓPRIA. Isso acontece nos
dois modos, é o mecanismo de produção que estamos reutilizando de propósito, e
não toca em ca.notas_fiscais.

Reutiliza, sem modificar:
  - etl.auth.get_access_token
  - etl.client.ContaAzulClient
  - etl.sync.financeiro._map_nota_fiscal        (dry_run, em memória)
  - etl.sync.financeiro.sync_notas_fiscais      (só no modo executar)
  - etl.diagnostics.diag_notas_fiscais          (sanitização e SQL de cobertura)
"""

import hashlib
import json
import logging
import os
import sys
import traceback
from collections import Counter
from datetime import date, datetime, timedelta

from etl.auth import get_access_token
from etl.client import ContaAzulClient
from etl.db import get_connection
from etl.sync.financeiro import _map_nota_fiscal
from etl.diagnostics.diag_notas_fiscais import (
    NFSE_PATH,
    CHUNK_DAYS,
    COLUNAS_TABELA,
    SQL_VENDAS_COMPETENCIA,
    mask_id,
    sanitize,
    scrub,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s -- %(message)s",
)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logger = logging.getLogger("backfill_nf")

# Alvos da investigação desta etapa.
ALVO_NUMERO_NFSE = 174
ALVO_VENDA_ID    = "6ceb3071-9967-4502-b319-0c26f6e9c169"
JANELA_FEV       = ("2026-02-01", "2026-02-28")

# Colunas comparadas para decidir "mudaria" (synced_at muda sempre).
COLUNAS_COMPARADAS = [c for c in COLUNAS_TABELA if c != "synced_at"]

RELATORIO = {
    "modo": None,
    "gerado_em_utc": None,
    "janela": {},
    "erros": [],
    "api": {},
    "banco_antes": {},
    "banco_depois": {},
    "comparacao": {},
    "duplicidades": {},
    "alvo": {},
    "validacao": {},
    "nfe_divida_latente": {},
    "snapshot": {},
}


def _erro(etapa, exc):
    msg = scrub(f"{type(exc).__name__}: {exc}", limite=200)
    logger.error("%s -> %s", etapa, msg)
    RELATORIO["erros"].append({"etapa": etapa, "erro": msg})


# ── SQL (somente leitura) ─────────────────────────────────────────────────────

SQL_TODAS_AS_NOTAS = """
SELECT id::text, numero, serie, status, chave_acesso, data_emissao::text,
       venda_id::text, cliente_id::text, valor_total::float, tipo,
       contrato_id::text, numero_venda, numero_rps, numero_nfse,
       data_competencia::text, nome_cliente
FROM ca.notas_fiscais
"""

SQL_STATS = """
SELECT count(*)                              AS total,
       count(venda_id)                       AS com_venda_id,
       count(*) - count(venda_id)             AS sem_venda_id,
       min(data_emissao)::text                AS min_data_emissao,
       max(data_emissao)::text                AS max_data_emissao
FROM ca.notas_fiscais
"""

SQL_STATS_POR_STATUS = """
SELECT COALESCE(status, '(null)') AS status, count(*)
FROM ca.notas_fiscais GROUP BY 1 ORDER BY 1
"""

SQL_DUPLICIDADE_VENDA_NUMERO = """
SELECT venda_id::text, numero, count(*) AS n
FROM ca.notas_fiscais
WHERE venda_id IS NOT NULL AND numero IS NOT NULL
GROUP BY 1, 2 HAVING count(*) > 1
ORDER BY n DESC
"""

SQL_ALVO_POR_NUMERO = """
SELECT id::text, status, venda_id::text, data_emissao::text,
       valor_total::float, numero, numero_nfse, data_competencia::text
FROM ca.notas_fiscais
WHERE numero = %s OR numero_nfse = %s
"""

SQL_NOTAS_DA_VENDA = """
SELECT id::text, status, numero, data_emissao::text, valor_total::float
FROM ca.notas_fiscais WHERE venda_id = %s
"""

SQL_NOTAS_DE_JULHO = """
SELECT id::text, status, numero, venda_id::text, valor_total::float
FROM ca.notas_fiscais
WHERE data_emissao BETWEEN '2026-07-01' AND '2026-07-31'
ORDER BY numero
"""

# Cobertura: mesma definição da rota /api/notas-fiscais (regime competência).
SQL_COBERTURA = SQL_VENDAS_COMPETENCIA

SQL_VENDAS_COM_NF_EMITIDA = """
SELECT DISTINCT venda_id::text
FROM ca.notas_fiscais
WHERE status = 'EMITIDA' AND venda_id = ANY(%s::uuid[])
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(v):
    """Hash estável para comparar campo sensível sem publicá-lo."""
    if v is None:
        return None
    return hashlib.sha256(str(v).encode("utf-8")).hexdigest()[:16]


def _norm(col, v):
    """Normaliza valor de coluna para comparação API-mapeada × banco."""
    if v is None or v == "":
        return None
    if col in ("valor_total",):
        return round(float(v), 2)
    if col in ("numero", "numero_rps", "numero_nfse"):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    if col == "nome_cliente":
        return _hash(v)
    return str(v)


def _assinatura(row):
    """Tupla comparável das colunas persistidas, exceto synced_at."""
    return tuple(_norm(c, row.get(c)) for c in COLUNAS_COMPARADAS)


def janelas(de, ate):
    cursor = de
    while cursor <= ate:
        fim = min(cursor + timedelta(days=CHUNK_DAYS), ate)
        yield cursor, fim
        cursor = fim + timedelta(days=1)


def stats_tabela(cur):
    out = {}
    cur.execute(SQL_STATS)
    cols = [d[0] for d in cur.description]
    out.update(dict(zip(cols, cur.fetchone())))
    cur.execute(SQL_STATS_POR_STATUS)
    out["por_status"] = {r[0]: r[1] for r in cur.fetchall()}
    return out


def snapshot_tabela(cur):
    """
    Snapshot lógico de ca.notas_fiscais para rollback/diff.

    Fidelidade total em todas as colunas EXCETO nome_cliente, que é gravado
    como hash — o artefato do Actions é visível a qualquer pessoa com leitura
    no repo, então nome de cliente não entra. Restaurar nome_cliente, se algum
    dia for preciso, é um re-sync a partir da API (que é a fonte da verdade).

    Retorna (snapshot_sanitizado, linhas_cruas_por_id). As linhas cruas ficam
    apenas em memória, para servir de baseline de comparação — se o baseline
    viesse do snapshot já hasheado, toda linha apareceria como "alterada".
    """
    cur.execute(SQL_TODAS_AS_NOTAS)
    cols = [d[0] for d in cur.description]
    cruas, linhas = {}, []
    for row in cur.fetchall():
        d = dict(zip(cols, row))
        cruas[d["id"]] = d
        pub = dict(d)
        pub["nome_cliente"] = {"_sha256_16": _hash(d.get("nome_cliente"))}
        linhas.append(pub)
    snap = {
        "tomado_em_utc": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "tabela": "ca.notas_fiscais",
        "n_linhas": len(linhas),
        "colunas": cols,
        "observacao": "nome_cliente substituído por hash sha256[:16]; demais colunas em fidelidade total",
        "linhas": linhas,
    }
    return snap, cruas


def coletar_nfse(client, de, ate):
    itens, req = [], 0
    for ini, fim in janelas(de, ate):
        try:
            chunk = client.get_all(NFSE_PATH, extra_params={
                "data_competencia_de":  ini.strftime("%Y-%m-%d"),
                "data_competencia_ate": fim.strftime("%Y-%m-%d"),
            })
            req += 1
            itens.extend(chunk or [])
        except Exception as exc:
            _erro(f"coletar_nfse {ini}..{fim}", exc)
    logger.info("NFS-e coletadas: %d (em %d janelas)", len(itens), req)
    return itens


def cobertura(cur, de, ate):
    """Cobertura no regime competência, igual à rota."""
    cur.execute(SQL_COBERTURA, (de, ate))
    vendas = [r[0] for r in cur.fetchall()]
    if not vendas:
        return {"denominador": 0, "com_nf_emitida": 0, "cobertura_pct": 100,
                "vendas_sem_nf": []}
    cur.execute(SQL_VENDAS_COM_NF_EMITIDA, (vendas,))
    com_nf = {r[0] for r in cur.fetchall()}
    sem_nf = [v for v in vendas if v not in com_nf]
    return {
        "denominador": len(vendas),
        "com_nf_emitida": len(com_nf & set(vendas)),
        "cobertura_pct": min(100, round(len(com_nf & set(vendas)) / len(vendas) * 100)),
        "vendas_sem_nf": [mask_id(v) for v in sem_nf[:20]],
        "n_vendas_sem_nf": len(sem_nf),
        "alvo_esta_sem_nf": ALVO_VENDA_ID in sem_nf,
        "alvo_no_denominador": ALVO_VENDA_ID in vendas,
    }


def checar_alvo(cur, mapeadas_por_id=None):
    """NFS-e 174 e venda alvo: estado no banco e o que seria/foi gravado."""
    out = {"numero_nfse_alvo": ALVO_NUMERO_NFSE, "venda_alvo": mask_id(ALVO_VENDA_ID)}
    try:
        cur.execute(SQL_ALVO_POR_NUMERO, (ALVO_NUMERO_NFSE, ALVO_NUMERO_NFSE))
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        out["no_banco"] = [{k: sanitize(k, v) for k, v in r.items()} for r in rows]
        out["existe_no_banco"] = bool(rows)

        cur.execute(SQL_NOTAS_DA_VENDA, (ALVO_VENDA_ID,))
        cols = [d[0] for d in cur.description]
        nv = [dict(zip(cols, r)) for r in cur.fetchall()]
        out["notas_da_venda_alvo"] = [{k: sanitize(k, v) for k, v in r.items()} for r in nv]
    except Exception as exc:
        _erro("checar_alvo", exc)

    if mapeadas_por_id is not None:
        cand = [m for m in mapeadas_por_id.values()
                if m.get("numero") == ALVO_NUMERO_NFSE
                or m.get("numero_nfse") == ALVO_NUMERO_NFSE]
        out["seria_gravado"] = [
            {k: sanitize(k, v) for k, v in c.items() if k != "synced_at"} for c in cand
        ]
    return out


# ── Modo dry_run ──────────────────────────────────────────────────────────────

def modo_dry_run(client, de, ate):
    conn = get_connection()
    conn.set_session(readonly=True)     # servidor rejeita qualquer escrita
    cur = conn.cursor()

    RELATORIO["banco_antes"] = stats_tabela(cur)

    itens = coletar_nfse(client, de, ate)
    RELATORIO["api"] = {
        "endpoint": NFSE_PATH,
        "total_retornado": len(itens),
        "escriturado_manualmente_true":  sum(1 for i in itens if i.get("escriturado_manualmente") is True),
        "escriturado_manualmente_false": sum(1 for i in itens if i.get("escriturado_manualmente") is False),
        "sem_o_campo":  sum(1 for i in itens if "escriturado_manualmente" not in i),
        "valor_null":   sum(1 for i in itens if "escriturado_manualmente" in i
                            and i.get("escriturado_manualmente") is None),
        "distribuicao_por_status": dict(sorted(Counter(str(i.get("status")) for i in itens).items())),
        "min_data_competencia": min((str(i.get("data_competencia")) for i in itens if i.get("data_competencia")), default=None),
        "max_data_competencia": max((str(i.get("data_competencia")) for i in itens if i.get("data_competencia")), default=None),
    }

    # Mapeia em memória com o mapper de produção. Nada é gravado.
    mapeadas, ids_repetidos = {}, Counter()
    for raw in itens:
        if not isinstance(raw, dict) or not raw:
            continue
        row = _map_nota_fiscal(raw)
        if not row.get("id"):
            continue
        ids_repetidos[row["id"]] += 1
        mapeadas[row["id"]] = row

    RELATORIO["api"]["com_venda_id"] = sum(1 for m in mapeadas.values() if m.get("venda_id"))
    RELATORIO["api"]["sem_venda_id"] = sum(1 for m in mapeadas.values() if not m.get("venda_id"))

    # Estado atual do banco, para o diff
    cur.execute(SQL_TODAS_AS_NOTAS)
    cols = [d[0] for d in cur.description]
    banco = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}

    novos, mudariam, identicos, detalhe_mudanca = [], [], [], []
    for nid, m in mapeadas.items():
        if nid not in banco:
            novos.append(nid)
            continue
        if _assinatura(m) == _assinatura(banco[nid]):
            identicos.append(nid)
        else:
            mudariam.append(nid)
            difs = {}
            for c in COLUNAS_COMPARADAS:
                a, b = _norm(c, banco[nid].get(c)), _norm(c, m.get(c))
                if a != b:
                    difs[c] = {"banco": sanitize(c, a), "api": sanitize(c, b)}
            detalhe_mudanca.append({"nota": mask_id(nid), "diferencas": difs})

    no_banco_e_nao_na_api = [i for i in banco if i not in mapeadas]

    RELATORIO["comparacao"] = {
        "total_api_mapeado": len(mapeadas),
        "total_existente_no_banco": len(banco),
        "novos": len(novos),
        "mudariam": len(mudariam),
        "identicos": len(identicos),
        "no_banco_mas_ausentes_na_api": len(no_banco_e_nao_na_api),
        "no_banco_mas_ausentes_na_api_ids": [mask_id(i) for i in no_banco_e_nao_na_api[:20]],
        "detalhe_das_mudancas": detalhe_mudanca[:20],
        "nota": "upsert nunca deleta; 'ausentes na api' permanecem intactos",
    }

    dup_id = {k: v for k, v in ids_repetidos.items() if v > 1}
    dup_vn = Counter((m.get("venda_id"), m.get("numero")) for m in mapeadas.values()
                     if m.get("venda_id") and m.get("numero"))
    try:
        cur.execute(SQL_DUPLICIDADE_VENDA_NUMERO)
        dup_banco = [{"venda": mask_id(r[0]), "numero": r[1], "n": r[2]} for r in cur.fetchall()]
    except Exception as exc:
        _erro("duplicidade banco", exc)
        dup_banco = []

    RELATORIO["duplicidades"] = {
        "por_id_na_api": [{"nota": mask_id(k), "n": v} for k, v in dup_id.items()],
        "por_venda_id_mais_numero_na_api": [
            {"venda": mask_id(k[0]), "numero": k[1], "n": v}
            for k, v in dup_vn.items() if v > 1
        ],
        "por_venda_id_mais_numero_no_banco": dup_banco,
    }

    RELATORIO["alvo"] = checar_alvo(cur, mapeadas)
    RELATORIO["alvo"]["cobertura_fevereiro_atual"] = cobertura(cur, *JANELA_FEV)

    cur.close()
    conn.close()
    return 0


# ── Modo executar ─────────────────────────────────────────────────────────────

def modo_executar(client, de, ate):
    # Import local: sync_notas_fiscais só existe neste caminho de código.
    from etl.sync.financeiro import sync_notas_fiscais

    # 1. Snapshot + estado ANTES, em conexão read-only separada.
    ro = get_connection()
    ro.set_session(readonly=True)
    cur_ro = ro.cursor()
    RELATORIO["banco_antes"] = stats_tabela(cur_ro)
    RELATORIO["banco_antes"]["cobertura_fevereiro"] = cobertura(cur_ro, *JANELA_FEV)
    RELATORIO["alvo"] = {"antes": checar_alvo(cur_ro)}
    snap, antes_cruas = snapshot_tabela(cur_ro)
    cur_ro.execute(SQL_NOTAS_DE_JULHO)
    cols = [d[0] for d in cur_ro.description]
    julho_antes = {r[0]: dict(zip(cols, r)) for r in cur_ro.fetchall()}
    ids_antes = set(antes_cruas)
    assinaturas_antes = {i: _assinatura(r) for i, r in antes_cruas.items()}
    cur_ro.close()
    ro.close()

    with open("backfill_notas_snapshot_pre.json", "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2, default=str)
    RELATORIO["snapshot"] = {
        "arquivo": "backfill_notas_snapshot_pre.json",
        "n_linhas": snap["n_linhas"],
        "tomado_em_utc": snap["tomado_em_utc"],
    }
    logger.info("Snapshot pré-backfill: %d linhas", snap["n_linhas"])

    # 2. O ÚNICO sync chamado.
    conn = get_connection()
    registros = sync_notas_fiscais(conn, client, mode="full")
    logger.info("sync_notas_fiscais(mode='full') -> %s registro(s)", registros)
    conn.close()
    RELATORIO["validacao"]["registros_reportados_pelo_sync"] = registros

    # 3. Estado DEPOIS, conexão nova read-only.
    ro2 = get_connection()
    ro2.set_session(readonly=True)
    c2 = ro2.cursor()
    RELATORIO["banco_depois"] = stats_tabela(c2)
    RELATORIO["banco_depois"]["cobertura_fevereiro"] = cobertura(c2, *JANELA_FEV)
    RELATORIO["alvo"]["depois"] = checar_alvo(c2)

    c2.execute(SQL_TODAS_AS_NOTAS)
    cols = [d[0] for d in c2.description]
    depois = {r[0]: dict(zip(cols, r)) for r in c2.fetchall()}
    ids_depois = set(depois)

    c2.execute(SQL_NOTAS_DE_JULHO)
    cols_j = [d[0] for d in c2.description]
    julho_depois = {r[0]: dict(zip(cols_j, r)) for r in c2.fetchall()}

    removidos = ids_antes - ids_depois
    novos = ids_depois - ids_antes
    atualizados = [i for i in (ids_antes & ids_depois)
                   if assinaturas_antes.get(i) != _assinatura(depois[i])]
    perderam_venda = [
        i for i in (ids_antes & ids_depois)
        if antes_cruas[i].get("venda_id") is not None
        and depois[i].get("venda_id") is None
    ]
    julho_alterado = [
        {"nota": mask_id(i),
         "antes": {k: sanitize(k, v) for k, v in julho_antes[i].items()},
         "depois": {k: sanitize(k, v) for k, v in julho_depois.get(i, {}).items()}}
        for i in julho_antes
        if i not in julho_depois or _assinatura(julho_antes[i]) != _assinatura(julho_depois[i])
    ]

    ant = RELATORIO["banco_antes"]
    dep = RELATORIO["banco_depois"]
    RELATORIO["validacao"].update({
        "1_nfse_174_existe":     RELATORIO["alvo"]["depois"].get("existe_no_banco"),
        "2_a_6_dados_do_alvo":   RELATORIO["alvo"]["depois"].get("no_banco"),
        "7_alvo_no_denominador": dep["cobertura_fevereiro"]["alvo_no_denominador"],
        "8_alvo_ainda_sem_nf":   dep["cobertura_fevereiro"]["alvo_esta_sem_nf"],
        "9_cobertura_fevereiro": {
            "antes_pct":  ant["cobertura_fevereiro"]["cobertura_pct"],
            "depois_pct": dep["cobertura_fevereiro"]["cobertura_pct"],
            "denominador_antes":  ant["cobertura_fevereiro"]["denominador"],
            "denominador_depois": dep["cobertura_fevereiro"]["denominador"],
        },
        "10_julho_2026_alterado": julho_alterado,
        "10_julho_2026_sem_alteracao": not julho_alterado,
        "11_notas_novas": len(novos),
        "12_notas_atualizadas": len(atualizados),
        "13_perderam_venda_id": [mask_id(i) for i in perderam_venda],
        "13_nenhuma_perdeu_venda_id": not perderam_venda,
        "14_registros_removidos": len(removidos),
        "14_removidos_e_zero": len(removidos) == 0,
        "14_ids_removidos": [mask_id(i) for i in list(removidos)[:20]],
        "total_antes": ant["total"],
        "total_depois": dep["total"],
    })

    c2.close()
    ro2.close()
    return 0


# ── NF-e: dívida latente (documentação, sem correção) ─────────────────────────

def documentar_nfe():
    RELATORIO["nfe_divida_latente"] = {
        "endpoint": "/notas-fiscais",
        "params_usados_hoje_por_sync_notas_fiscais": "data_competencia_de / data_competencia_ate",
        "resultado_com_params_de_hoje": "HTTP 400",
        "efeito": ("probe trata 400 como indisponível (status in (400,404)), "
                   "então /notas-fiscais é descartado silenciosamente em todo run"),
        "params_da_documentacao": "data_inicial / data_final",
        "resultado_com_params_corretos": "HTTP 200",
        "registros_retornados_com_params_corretos": 0,
        "conclusao": ("dívida latente: o bug de parâmetros é real, mas o endpoint "
                      "não devolve registros nesta operação, portanto NÃO causa o "
                      "incidente atual das NFS-e escrituradas"),
        "acao_nesta_etapa": "nenhuma — não corrigir agora, conforme escopo",
    }


# ── Artefatos ─────────────────────────────────────────────────────────────────

def escrever_artefatos(modo):
    base = "backfill_notas_dry_run" if modo == "dry_run" else "backfill_notas_resultado"

    with open(f"{base}.json", "w", encoding="utf-8") as f:
        json.dump(RELATORIO, f, ensure_ascii=False, indent=2, default=str)

    L = [f"# Backfill Notas Fiscais — modo `{modo}` (sanitizado)", ""]
    L.append(f"- Gerado em (UTC): {RELATORIO['gerado_em_utc']}")
    L.append(f"- Janela: {RELATORIO['janela']}")
    if RELATORIO["erros"]:
        L += ["", "## Erros", ""] + [f"- `{e['etapa']}`: {e['erro']}" for e in RELATORIO["erros"]]
    for titulo, chave in [
        ("API", "api"), ("Banco antes", "banco_antes"), ("Banco depois", "banco_depois"),
        ("Comparação", "comparacao"), ("Duplicidades", "duplicidades"),
        ("Alvo (NFS-e 174 / venda)", "alvo"), ("Validação", "validacao"),
        ("Snapshot", "snapshot"), ("NF-e — dívida latente", "nfe_divida_latente"),
    ]:
        if RELATORIO.get(chave):
            L += ["", f"## {titulo}", "", "```json",
                  json.dumps(RELATORIO[chave], ensure_ascii=False, indent=2, default=str), "```"]

    with open(f"{base}.md", "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    logger.info("Artefatos escritos: %s.json, %s.md", base, base)


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    modo = (os.getenv("BACKFILL_MODO") or "").strip()
    if modo not in ("dry_run", "executar"):
        logger.error("BACKFILL_MODO inválido. Use 'dry_run' ou 'executar'.")
        return 2

    hoje = date.today()
    de_s  = (os.getenv("BACKFILL_DATA_DE") or "").strip()
    ate_s = (os.getenv("BACKFILL_DATA_ATE") or "").strip()
    de  = date.fromisoformat(de_s)  if de_s  else date(2015, 1, 1)
    ate = date.fromisoformat(ate_s) if ate_s else date(hoje.year, 12, 31)

    RELATORIO["modo"] = modo
    RELATORIO["gerado_em_utc"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    RELATORIO["janela"] = {"de": de.isoformat(), "ate": ate.isoformat()}
    if modo == "executar":
        RELATORIO["janela"]["aviso"] = (
            "sync_notas_fiscais(mode='full') define a janela internamente "
            "(2015-01-01 até 31/12 do ano corrente). Os inputs de data NÃO "
            "afetam este modo — valem só para o dry_run."
        )
    logger.info("Modo: %s | janela: %s .. %s", modo, de, ate)

    token = get_access_token()      # nunca logado
    if not token:
        logger.error("get_access_token() não retornou token.")
        return 1
    logger.info("Autenticado via etl.auth (token não é registrado em log).")
    client = ContaAzulClient(token)

    documentar_nfe()

    rc = modo_dry_run(client, de, ate) if modo == "dry_run" else modo_executar(client, de, ate)
    escrever_artefatos(modo)
    return rc


if __name__ == "__main__":
    _modo = (os.getenv("BACKFILL_MODO") or "desconhecido").strip()
    try:
        sys.exit(main())
    except Exception as exc:
        logger.error("Falha no backfill: %s", scrub(str(exc), 200))
        traceback.print_exc()
        try:
            escrever_artefatos(_modo)
        except Exception:
            pass
        sys.exit(1)
