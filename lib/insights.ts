import type { Lancamento } from './types'
import { fR } from './utils'

export interface Insight {
  type: 'danger' | 'warn' | 'ok' | 'info'
  icon: string
  title: string
  body: string
  val?: string
}

export function generateInsights(
  op: Lancamento[],
  rec: number,
  desp: number
): Insight[] {
  const insights: Insight[] = []
  const resultado = rec - desp
  const margem = rec > 0 ? (resultado / rec) * 100 : 0

  // 1. Resultado
  if (resultado < 0) {
    insights.push({
      type: 'danger',
      icon: '📉',
      title: 'Resultado Negativo',
      body: `O período apresenta prejuízo de ${fR(Math.abs(resultado))}. Revise despesas ou busque aumento de receita.`,
      val: fR(resultado),
    })
  } else if (margem < 10) {
    insights.push({
      type: 'warn',
      icon: '⚠️',
      title: 'Margem Baixa',
      body: `Margem de ${margem.toFixed(1)}% está abaixo de 10%. Atenção ao controle de custos.`,
      val: `${margem.toFixed(1)}%`,
    })
  } else {
    insights.push({
      type: 'ok',
      icon: '✅',
      title: 'Resultado Positivo',
      body: `Margem de ${margem.toFixed(1)}% — resultado saudável no período.`,
      val: `${margem.toFixed(1)}%`,
    })
  }

  // 2. Lançamentos atrasados
  const hoje = new Date()
  const atrasados = op.filter(
    r =>
      r.situacao &&
      r.situacao.toLowerCase().includes('atraso') &&
      r.data &&
      r.data < hoje
  )
  const totalAtrasado = atrasados.reduce((s, r) => s + r.valor, 0)
  if (atrasados.length > 0) {
    insights.push({
      type: 'danger',
      icon: '🔴',
      title: `${atrasados.length} Lançamento(s) Atrasado(s)`,
      body: `Total de ${fR(totalAtrasado)} em atraso. Verifique cobranças pendentes.`,
      val: fR(totalAtrasado),
    })
  } else {
    insights.push({
      type: 'ok',
      icon: '✅',
      title: 'Sem Atrasos',
      body: 'Nenhum lançamento em atraso no período filtrado.',
    })
  }

  // 3. Qualidade dos dados
  const semCat = op.filter(r => !r.cat1 || r.cat1 === '(em branco)').length
  const semCC = op.filter(r => !r.cc1 || r.cc1 === '(em branco)').length
  const pctSemCat = op.length > 0 ? (semCat / op.length) * 100 : 0
  const pctSemCC = op.length > 0 ? (semCC / op.length) * 100 : 0
  if (pctSemCat > 10 || pctSemCC > 10) {
    insights.push({
      type: 'warn',
      icon: '🏷️',
      title: 'Qualidade dos Dados',
      body: `${semCat} sem categoria (${pctSemCat.toFixed(0)}%) e ${semCC} sem centro de custo (${pctSemCC.toFixed(0)}%). Classifique para análises precisas.`,
    })
  } else {
    insights.push({
      type: 'ok',
      icon: '✅',
      title: 'Dados Bem Classificados',
      body: `${pctSemCat.toFixed(0)}% sem categoria e ${pctSemCC.toFixed(0)}% sem CC — boa qualidade de dados.`,
    })
  }

  // 4. Concentração de receita
  const receitas = op.filter(r => r.tipo === 'Receita' && !r.isTransfer)
  const catMap = new Map<string, number>()
  for (const r of receitas) {
    for (const c of r.categorias) {
      catMap.set(c.nome, (catMap.get(c.nome) || 0) + r.valor)
    }
  }
  if (catMap.size > 0 && rec > 0) {
    const [topCat, topVal] = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0]
    const pct = (topVal / rec) * 100
    if (pct > 70) {
      insights.push({
        type: 'warn',
        icon: '⚡',
        title: 'Concentração de Receita',
        body: `${pct.toFixed(0)}% da receita concentrada em "${topCat}". Diversifique fontes de renda.`,
        val: `${pct.toFixed(0)}%`,
      })
    } else {
      insights.push({
        type: 'ok',
        icon: '📊',
        title: 'Receita Diversificada',
        body: `Maior categoria "${topCat}" representa ${pct.toFixed(0)}% da receita — diversificação adequada.`,
        val: `${pct.toFixed(0)}%`,
      })
    }
  }

  // 5. Maior categoria de despesa
  const despesas = op.filter(r => r.tipo === 'Despesa' && !r.isTransfer)
  const despCatMap = new Map<string, number>()
  for (const r of despesas) {
    for (const c of r.categorias) {
      despCatMap.set(c.nome, (despCatMap.get(c.nome) || 0) + r.valor)
    }
  }
  if (despCatMap.size > 0) {
    const [topDesp, topDespVal] = [...despCatMap.entries()].sort((a, b) => b[1] - a[1])[0]
    const pct = desp > 0 ? (topDespVal / desp) * 100 : 0
    insights.push({
      type: 'info',
      icon: '💸',
      title: 'Maior Despesa',
      body: `"${topDesp}" é a maior categoria de despesa com ${fR(topDespVal)} (${pct.toFixed(0)}% do total).`,
      val: fR(topDespVal),
    })
  }

  // 6. Lead Broker como % da receita
  const leadBroker = op
    .filter(
      r =>
        r.tipo === 'Despesa' &&
        !r.isTransfer &&
        (r.cat1.toLowerCase().includes('lead') ||
          r.cat1.toLowerCase().includes('broker') ||
          r.desc.toLowerCase().includes('lead') ||
          r.fornecedor.toLowerCase().includes('lead'))
    )
    .reduce((s, r) => s + r.valor, 0)
  if (leadBroker > 0 && rec > 0) {
    const pct = (leadBroker / rec) * 100
    insights.push({
      type: pct > 15 ? 'warn' : 'ok',
      icon: '🎯',
      title: 'Custo Lead/Broker',
      body: `Lead/Broker representa ${pct.toFixed(1)}% da receita bruta.${pct > 15 ? ' Avalie a eficiência de aquisição.' : ' Dentro do limite recomendado.'}`,
      val: `${pct.toFixed(1)}%`,
    })
  }

  // 7. Royalties como % da receita
  const royalties = op
    .filter(
      r =>
        r.tipo === 'Despesa' &&
        !r.isTransfer &&
        (r.cat1.toLowerCase().includes('royalt') ||
          r.desc.toLowerCase().includes('royalt'))
    )
    .reduce((s, r) => s + r.valor, 0)
  if (royalties > 0 && rec > 0) {
    const pct = (royalties / rec) * 100
    insights.push({
      type: 'info',
      icon: '📋',
      title: 'Royalties',
      body: `Royalties representam ${pct.toFixed(1)}% da receita bruta — total de ${fR(royalties)}.`,
      val: `${pct.toFixed(1)}%`,
    })
  }

  // 8. Carga tributária
  const impostos = op
    .filter(
      r =>
        r.tipo === 'Despesa' &&
        !r.isTransfer &&
        (r.cat1.toLowerCase().includes('iss') ||
          r.cat1.toLowerCase().includes('pis') ||
          r.cat1.toLowerCase().includes('cofins') ||
          r.cat1.toLowerCase().includes('das') ||
          r.cat1.toLowerCase().includes('imposto') ||
          r.cat1.toLowerCase().includes('tribut'))
    )
    .reduce((s, r) => s + r.valor, 0)
  if (impostos > 0 && rec > 0) {
    const pct = (impostos / rec) * 100
    insights.push({
      type: pct > 10 ? 'warn' : 'ok',
      icon: '🏛️',
      title: 'Carga Tributária',
      body: `ISS/PIS/COFINS/DAS totalizam ${fR(impostos)} (${pct.toFixed(1)}% da receita).${pct > 10 ? ' Verifique enquadramento tributário.' : ' Carga dentro do esperado.'}`,
      val: `${pct.toFixed(1)}%`,
    })
  }

  return insights
}
