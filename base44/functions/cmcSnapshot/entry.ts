import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  HORAS_MADRUGADOR,
  ENDPOINTS_CMC,
  METRICAS,
  buscarCmc,
  calcularPontuacao,
  dadosDaMetrica,
  dataUtc,
  explicacaoPadrao,
  formatarValor,
  gerarExplicacao,
  gerarLeituraTutor,
  inicioDoDiaUtc,
  leituraPadrao,
} from '../../shared/desafio.ts';
import { XP_POR_NIVEL, aplicarLiberacoesPorXp } from '../../shared/progressao.ts';
import { todasAsAulasPublicadas } from '../../shared/aulas.ts';
import { avisarSempre } from '../../shared/notificacoes.ts';

/** Chave opcional: sem ela a leitura usa a API pública de teste da CoinMarketCap. */
function lerChave() {
  try {
    const chave = secrets.get('CMC_API_KEY');
    if (chave) return chave;
  } catch {
    // Segredo não cadastrado: cai no ambiente e, por fim, no modo keyless.
  }
  try {
    return Deno.env.get('CMC_API_KEY') || '';
  } catch {
    return '';
  }
}

function primeiraFrase(texto) {
  const limpo = String(texto || '')
    .replace(/[#*_>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo) return '';
  const corte = limpo.match(/^(.{20,220}?[.!?])\s/);
  return corte ? corte[1] : limpo.slice(0, 200);
}

async function registrarErro(base44, acao, contexto, erro) {
  await base44.asServiceRole.entities.AdminLog.create({
    admin: 'sistema',
    admin_email: 'sistema',
    acao,
    alvo_tipo: 'sistema',
    alvo_id: contexto?.id || null,
    detalhes: { metrica: contexto?.metrica || null, erro: String(erro?.message || erro) },
    criado_em: new Date().toISOString(),
  }).catch(() => null);
}

/** Cada tentativa frustrada da coleta fica registrada para o professor ver. */
async function registrarFalhaCmc(base44, falha) {
  await base44.asServiceRole.entities.AdminLog.create({
    admin: 'sistema',
    admin_email: 'sistema',
    acao: 'cmc_falha',
    alvo_tipo: 'sistema',
    alvo_id: null,
    detalhes: {
      endpoint: falha.caminho,
      tentativa: falha.tentativa,
      motivo: falha.motivo,
      espera_seg: falha.espera ? Math.round(falha.espera / 1000) : null,
    },
    criado_em: new Date().toISOString(),
  }).catch(() => null);
}

/** Queda da fonte Pro para a pública: fica no registro para o professor ver. */
async function registrarQuedaCmc(base44, queda) {
  await base44.asServiceRole.entities.AdminLog.create({
    admin: 'sistema',
    admin_email: 'sistema',
    acao: 'cmc_fallback_keyless',
    alvo_tipo: 'sistema',
    alvo_id: null,
    detalhes: {
      de: 'pro',
      para: 'keyless',
      motivo: queda?.motivo || null,
      metricas_lidas: queda?.metricas_lidas || [],
    },
    criado_em: new Date().toISOString(),
  }).catch(() => null);
}

/** Resolve as perguntas vencidas: fecha o valor, pontua as respostas e paga o XP. */
async function resolverPerguntas(base44, snapshot, agora) {
  const pendentes = await base44.asServiceRole.entities.LiveQuestion.filter(
    { status: { $in: ['aberta', 'fechada'] } },
    { limit: 100 }
  );

  const devidas = (pendentes.items || []).filter(
    (pergunta) => pergunta.resolve_em && new Date(pergunta.resolve_em).getTime() <= agora.getTime()
  );

  const xpPorJogador = new Map();
  let resolvidas = 0;

  for (const pergunta of devidas) {
    const dados = dadosDaMetrica(snapshot.metricas, pergunta.metrica);
    if (!dados) continue;

    const fechamento = dados.valor;
    const resultado = fechamento > Number(pergunta.valor_referencia) ? 'acima' : 'abaixo';
    const formato = pergunta.formato || METRICAS[pergunta.metrica]?.formato || 'preco';

    let explicacao;
    try {
      const aula = await base44.asServiceRole.entities.Lesson.get(pergunta.lesson).catch(() => null);
      explicacao = await gerarExplicacao(base44, {
        aula,
        pergunta: pergunta.pergunta_pt,
        formato,
        valorReferencia: pergunta.valor_referencia,
        valorFechamento: fechamento,
        variacao: dados.variacao_24h,
        resultado,
      });
    } catch (erro) {
      explicacao = explicacaoPadrao({
        formato,
        valorReferencia: pergunta.valor_referencia,
        valorFechamento: fechamento,
        variacao: dados.variacao_24h,
        resultado,
      });
      await registrarErro(base44, 'llm_explicacao', pergunta, erro);
    }

    const respostas = await base44.asServiceRole.entities.Forecast.filter(
      { pergunta: pergunta.id },
      { limit: 500 }
    );
    const abertura = new Date(pergunta.created_date || pergunta.horario_referencia).getTime();

    for (const resposta of respostas.items || []) {
      const acertou = resposta.lado === resultado;
      const respondidoEm = new Date(resposta.respondido_em || resposta.created_date).getTime();
      const madrugador =
        Number.isFinite(abertura) && respondidoEm - abertura <= HORAS_MADRUGADOR * 3600000;
      const { brier, xp } = calcularPontuacao(resposta.confianca, acertou, madrugador);

      await base44.asServiceRole.entities.Forecast.update(resposta.id, {
        acertou,
        brier,
        xp_ganho: xp,
        madrugador,
      });

      xpPorJogador.set(resposta.jogador, (xpPorJogador.get(resposta.jogador) || 0) + xp);

      await avisarSempre(base44, {
        player: resposta.jogador,
        tipo: 'desafio_resolvido',
        chave: 'desafio_resolvido',
        variaveis: { xp },
        titulo: 'Desafio resolvido',
        texto: `Seu desafio foi resolvido: +${xp} XP`,
        link: '/desafio',
      });
    }

    await base44.asServiceRole.entities.LiveQuestion.update(pergunta.id, {
      status: 'resolvida',
      valor_fechamento: fechamento,
      variacao_24h_fechamento: dados.variacao_24h ?? null,
      horario_fechamento: dados.last_updated || agora.toISOString(),
      resultado,
      explicacao_pt: explicacao.pt,
      explicacao_en: explicacao.en,
      snapshot_resolucao: snapshot.id,
    });

    resolvidas += 1;
  }

  // O XP entra uma vez por jogador, somando todas as perguntas resolvidas nesta rodada.
  for (const [jogador, xp] of xpPorJogador) {
    if (!xp) continue;
    const perfil = await base44.asServiceRole.entities.PlayerProfile.get(jogador).catch(() => null);
    if (!perfil) continue;

    const novoXp = (Number(perfil.xp) || 0) + xp;
    await base44.asServiceRole.entities.PlayerProfile.update(perfil.id, {
      xp: novoXp,
      nivel: 1 + Math.floor(novoXp / XP_POR_NIVEL),
    });
    // O XP do desafio também destrava aulas.
    await aplicarLiberacoesPorXp(base44, { ...perfil, xp: novoXp }, agora);
  }

  return resolvidas;
}

/** Janela mínima de respostas e distância entre o fechamento e o resultado. */
const HORAS_MINIMAS_DE_RESPOSTA = 3;
const HORAS_ENTRE_FECHAMENTO_E_RESULTADO = 12;

/**
 * Janela da rodada. A referência do resultado é a meia-noite UTC seguinte ao
 * snapshot e as respostas fecham 12 h antes dela (12:00 UTC) — nunca depois,
 * para ninguém responder sabendo o resultado. Snapshot fora do horário, sem ao
 * menos 3 h até o fechamento, empurra a pergunta para a rodada do dia seguinte.
 */
function janelaDaRodada(capturadoEm) {
  const capturado = new Date(capturadoEm);
  const base = inicioDoDiaUtc(capturado);
  const minimo = HORAS_MINIMAS_DE_RESPOSTA * 3600000;

  for (let dia = 1; dia <= 2; dia += 1) {
    const resolve = new Date(base.getTime() + dia * 24 * 3600000);
    const fecha = new Date(resolve.getTime() - HORAS_ENTRE_FECHAMENTO_E_RESULTADO * 3600000);
    if (fecha.getTime() - capturado.getTime() >= minimo) {
      const rodada = new Date(base.getTime() + (dia - 1) * 24 * 3600000);
      return { rodada: dataUtc(rodada), fecha, resolve };
    }
  }

  // Sem janela nem no dia seguinte: fecha no mínimo e resolve 12 h depois.
  const fecha = new Date(capturado.getTime() + minimo);
  const resolve = new Date(fecha.getTime() + HORAS_ENTRE_FECHAMENTO_E_RESULTADO * 3600000);
  return { rodada: dataUtc(base), fecha, resolve };
}

/** Preserva o endpoint efetivamente chamado no snapshot de abertura. */
function endpointCotacoesDe(snapshot) {
  const lista = snapshot?.endpoints_chamados || [];
  return (
    lista.find((endpoint) => String(endpoint).includes('/cryptocurrency/quotes/latest')) ||
    ENDPOINTS_CMC[0]
  );
}

/** A pergunta do dia continua sendo a de BTC. */
const METRICA_DESTAQUE = 'btc_price';

/**
 * Uma pergunta por métrica por dia: a chave é a rodada (dia UTC) + a métrica.
 * Cada métrica usa a primeira aula do catálogo que a ensina, e a de BTC usa a
 * aula "Suporte e resistência" quando ela existe.
 */
async function criarPerguntas(base44, snapshot) {
  const endpointCotacoes = endpointCotacoesDe(snapshot);
  const aulas = await todasAsAulasPublicadas(base44);
  const comMetrica = aulas.filter(
    (aula) => METRICAS[aula.cmc_metrica] && dadosDaMetrica(snapshot.metricas, aula.cmc_metrica)
  );
  if (!comMetrica.length) return 0;

  // A janela sai do horário do snapshot de abertura: uma rodada, um snapshot, um horário.
  const { rodada, fecha, resolve } = janelaDaRodada(snapshot.capturado_em);

  // Nada de repetir métrica: nem a que ainda espera resolução, nem a que já saiu na rodada.
  const [emAberto, daRodada] = await Promise.all([
    base44.asServiceRole.entities.LiveQuestion.filter(
      { status: { $in: ['aberta', 'fechada'] } },
      { limit: 200 }
    ),
    base44.asServiceRole.entities.LiveQuestion.filter({ data_rodada: rodada }, { limit: 200 }),
  ]);
  // Pergunta vencida que ficou aberta por falta de dado não trava a métrica para sempre.
  const agoraMs = Date.now();
  const metricasUsadas = new Set(
    [...(emAberto.items || []), ...(daRodada.items || [])]
      .filter(
        (pergunta) =>
          pergunta.data_rodada === rodada || new Date(pergunta.resolve_em).getTime() > agoraMs
      )
      .map((pergunta) => pergunta.metrica)
  );

  // Uma aula representante por métrica, na ordem do catálogo.
  const porMetrica = new Map();
  for (const aula of comMetrica) {
    if (metricasUsadas.has(aula.cmc_metrica) || porMetrica.has(aula.cmc_metrica)) continue;
    porMetrica.set(aula.cmc_metrica, aula);
  }

  // A pergunta do dia é a de BTC da aula "Suporte e resistência", quando ela existe.
  const suporte = comMetrica.find(
    (aula) =>
      aula.cmc_metrica === METRICA_DESTAQUE && /suporte e resist/i.test(String(aula.titulo || ''))
  );
  if (suporte && !metricasUsadas.has(METRICA_DESTAQUE)) {
    porMetrica.set(METRICA_DESTAQUE, suporte);
  }

  const pendentes = [...porMetrica.values()];
  if (!pendentes.length) return 0;

  const leituras = await Promise.allSettled(
    pendentes.map((aula) =>
      gerarLeituraTutor(base44, {
        aula,
        metrica: aula.cmc_metrica,
        dados: dadosDaMetrica(snapshot.metricas, aula.cmc_metrica),
        metricas: { ...snapshot.metricas, capturado_em: snapshot.capturado_em },
      })
    )
  );

  let criadas = 0;

  for (let indice = 0; indice < pendentes.length; indice += 1) {
    const aula = pendentes[indice];
    const dados = dadosDaMetrica(snapshot.metricas, aula.cmc_metrica);
    const formato = METRICAS[aula.cmc_metrica].formato;
    const ativo = METRICAS[aula.cmc_metrica].ativo;

    let leitura = leituraPadrao(aula.cmc_metrica, dados);
    if (leituras[indice].status === 'fulfilled') {
      leitura = leituras[indice].value;
    } else {
      await registrarErro(base44, 'llm_leitura', { metrica: aula.cmc_metrica }, leituras[indice].reason);
    }

    const valorPt = formatarValor(dados.valor, formato, 'pt');
    const valorEn = formatarValor(dados.valor, formato, 'en');
    // Alguns modelos de pergunta já trazem o "%" depois do marcador: nunca duplica.
    const perguntaPt = String(
      aula.pergunta_modelo_pt || `${ativo} vai fechar acima ou abaixo de {valor}?`
    )
      .replaceAll('{valor}', valorPt)
      .replaceAll('%%', '%');
    const perguntaEn = String(
      aula.pergunta_modelo_en || `${ativo} will close above or below {valor}?`
    )
      .replaceAll('{valor}', valorEn)
      .replaceAll('%%', '%');

    const endpoint = formato === 'preco' || formato === 'volume'
      ? endpointCotacoes
      : METRICAS[aula.cmc_metrica].endpoint;

    await base44.asServiceRole.entities.LiveQuestion.create({
      data_rodada: rodada,
      lesson: aula.id,
      aula_titulo_pt: aula.titulo,
      aula_titulo_en: aula.titulo_en || aula.titulo,
      frase_aula_pt: primeiraFrase(aula.resumo || aula.conteudo_pt),
      frase_aula_en: primeiraFrase(aula.resumo_en || aula.conteudo_en || aula.resumo),
      metrica: aula.cmc_metrica,
      ativo,
      formato,
      endpoint_consulta: endpoint,
      valor_referencia: dados.valor,
      variacao_24h: dados.variacao_24h ?? null,
      horario_referencia: dados.last_updated || snapshot.capturado_em,
      snapshot_abertura: snapshot.id,
      snapshot_capturado_em: snapshot.capturado_em,
      fecha_respostas_em: fecha.toISOString(),
      resolve_em: resolve.toISOString(),
      pergunta_pt: perguntaPt,
      pergunta_en: perguntaEn,
      leitura_tutor_pt: leitura.leitura_pt,
      leitura_tutor_en: leitura.leitura_en,
      previsao_tutor_lado: leitura.lado,
      previsao_tutor_confianca: leitura.confianca,
      previsao_tutor_motivo: leitura.motivo,
      status: 'aberta',
      destaque: aula.cmc_metrica === METRICA_DESTAQUE,
    });

    criadas += 1;
  }

  return criadas;
}

/**
 * Leitura diária da CoinMarketCap: grava o snapshot, resolve as perguntas
 * vencidas e cria as perguntas do dia. Só o professor (ou a rotina agendada).
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    // Verificação sem coleta, sem gravar snapshots e sem alterar pontos dos jogadores.
    const corpo = await req.json().catch(() => ({}));
    if (corpo?.acao === 'verificar_endpoints') {
      return Response.json({ ok: true, endpoints_chamados: ENDPOINTS_CMC });
    }

    // Coleta de teste: passa pelo mesmo caminho da rodada e devolve o que foi
    // lido, sem gravar snapshot, sem criar perguntas e sem pagar XP.
    if (corpo?.acao === 'coleta_teste') {
      const coleta = await buscarCmc(
        lerChave(),
        (falha) => registrarFalhaCmc(base44, falha),
        (queda) => registrarQuedaCmc(base44, queda)
      );
      return Response.json({
        ok: true,
        teste: true,
        fonte: coleta.fonte,
        metricas: coleta.metricas,
        resumo: coleta.resumo,
        erros: coleta.erros,
        endpoints_chamados: coleta.endpoints_chamados,
      });
    }

    const agora = new Date();
    const rodada = dataUtc(agora);
    const daRodada = await base44.asServiceRole.entities.CmcSnapshot.filter(
      { rodada },
      { limit: 50 }
    );

    // Idempotência: a mesma rodada não é lida duas vezes em menos de um minuto.
    const ultimaLeitura = (daRodada.items || [])
      .map((registro) => new Date(registro.capturado_em).getTime())
      .sort((a, b) => b - a)[0];
    if (ultimaLeitura && agora.getTime() - ultimaLeitura < 60000) {
      return Response.json({
        ok: true,
        repetida: true,
        rodada,
        resolvidas: 0,
        criadas: 0,
        message: 'Esta rodada já foi lida há menos de um minuto.',
      });
    }

    const coleta = await buscarCmc(
      lerChave(),
      (falha) => registrarFalhaCmc(base44, falha),
      (queda) => registrarQuedaCmc(base44, queda)
    );

    if (!Object.keys(coleta.metricas).length) {
      await registrarErro(
        base44,
        'cmc_coleta',
        { metrica: null },
        new Error(coleta.erros.join(' | ') || 'sem métricas na resposta')
      );
      return Response.json(
        {
          error: 'A CoinMarketCap não devolveu nenhuma métrica agora.',
          erros: coleta.erros,
          fonte: coleta.fonte,
        },
        { status: 502 }
      );
    }

    // Uma rodada, um snapshot de abertura: se a rodada do dia já tem o dela, este é extra.
    const abertura =
      (daRodada.items || [])
        .filter((registro) => !registro.extra)
        .sort((a, b) => new Date(a.capturado_em).getTime() - new Date(b.capturado_em).getTime())[0] ||
      null;

    const snapshot = await base44.asServiceRole.entities.CmcSnapshot.create({
      capturado_em: agora.toISOString(),
      rodada,
      extra: Boolean(abertura),
      metricas: coleta.metricas,
      endpoints_chamados: coleta.endpoints_chamados,
      resposta_resumida: coleta.resumo,
      fonte: coleta.fonte,
      erros: coleta.erros,
    });

    const resolvidas = await resolverPerguntas(base44, snapshot, agora);

    // Trava da rodada: criado o snapshot, o mais antigo do dia é a abertura.
    // Dois disparos simultâneos não abrem rodada em dobro — o perdedor vira
    // extra e não cria pergunta.
    const daRodadaDepois = await base44.asServiceRole.entities.CmcSnapshot.filter(
      { rodada },
      { limit: 50 }
    );
    const ordenados = [...(daRodadaDepois.items || [])].sort(
      (a, b) =>
        new Date(a.capturado_em).getTime() - new Date(b.capturado_em).getTime() ||
        String(a.id).localeCompare(String(b.id))
    );
    const souAbertura = ordenados[0]?.id === snapshot.id;
    if (!souAbertura && snapshot.extra !== true) {
      await base44.asServiceRole.entities.CmcSnapshot.update(snapshot.id, { extra: true }).catch(() => null);
    }

    // As perguntas nascem uma única vez por rodada, sempre do snapshot de abertura.
    const aberturaFinal = souAbertura ? snapshot : abertura || ordenados[0] || snapshot;
    const janela = janelaDaRodada(aberturaFinal.capturado_em);
    const existentes = await base44.asServiceRole.entities.LiveQuestion.filter(
      { data_rodada: janela.rodada },
      { limit: 200 }
    );
    const criadas = (existentes.items || []).length
      ? 0
      : await criarPerguntas(base44, aberturaFinal);

    return Response.json({
      ok: true,
      papel: souAbertura ? 'abertura' : 'extra',
      endpoints_chamados: coleta.endpoints_chamados,
      erros_coleta: coleta.erros,
      snapshot: {
        id: snapshot.id,
        capturado_em: snapshot.capturado_em,
        fonte: snapshot.fonte,
        metricas: snapshot.metricas,
        erros: snapshot.erros,
      },
      resolvidas,
      criadas,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
