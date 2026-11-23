import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { CONFIANCAS, MINIMO_CALIBRACAO, calcularPlacar } from '../../shared/desafio.ts';
import { dataBrasilia, perfilDoJogador } from '../../shared/progressao.ts';
import { todasAsAulasPublicadas } from '../../shared/aulas.ts';

const ESTUDADAS = ['disponivel', 'video_assistido', 'quiz_aprovado', 'aprovada'];
const MAX_RESULTADOS = 12;
const RANKING_DIAS = 30;
const RANKING_MINIMO_RESPOSTAS = 5;
const RANKING_TOP = 20;

function diaAnterior(data) {
  return dataBrasilia(new Date(new Date(`${data}T12:00:00Z`).getTime() - 86400000));
}

function sequenciaDeDias(respostas) {
  const dias = [
    ...new Set(
      (respostas || []).map((r) => dataBrasilia(r.respondido_em || r.created_date)).filter(Boolean)
    ),
  ].sort().reverse();
  if (!dias.length) return 0;

  const hoje = dataBrasilia();
  if (dias[0] !== hoje && dias[0] !== diaAnterior(hoje)) return 0;

  let total = 1;
  for (let indice = 1; indice < dias.length; indice += 1) {
    if (dias[indice] !== diaAnterior(dias[indice - 1])) break;
    total += 1;
  }
  return total;
}

function perguntaPublica(pergunta, minha, agora) {
  const fechada = agora >= new Date(pergunta.fecha_respostas_em).getTime();

  return {
    id: pergunta.id,
    lesson: pergunta.lesson,
    aula_titulo_pt: pergunta.aula_titulo_pt,
    aula_titulo_en: pergunta.aula_titulo_en,
    frase_aula_pt: pergunta.frase_aula_pt,
    frase_aula_en: pergunta.frase_aula_en,
    metrica: pergunta.metrica,
    ativo: pergunta.ativo,
    formato: pergunta.formato,
    endpoint_consulta: pergunta.endpoint_consulta,
    valor_referencia: pergunta.valor_referencia,
    variacao_24h: pergunta.variacao_24h ?? null,
    horario_referencia: pergunta.horario_referencia,
    snapshot_capturado_em: pergunta.snapshot_capturado_em || pergunta.horario_referencia,
    fecha_respostas_em: pergunta.fecha_respostas_em,
    resolve_em: pergunta.resolve_em,
    pergunta_pt: pergunta.pergunta_pt,
    pergunta_en: pergunta.pergunta_en,
    leitura_tutor_pt: pergunta.leitura_tutor_pt || null,
    leitura_tutor_en: pergunta.leitura_tutor_en || null,
    destaque: Boolean(pergunta.destaque),
    status: pergunta.status,
    fechada,
    // A previsão do tutor só aparece depois que as respostas fecham.
    previsao: fechada
      ? {
          lado: pergunta.previsao_tutor_lado,
          confianca: pergunta.previsao_tutor_confianca,
          motivo: pergunta.previsao_tutor_motivo,
        }
      : null,
    minha_resposta: minha
      ? {
          lado: minha.lado,
          confianca: minha.confianca,
          motivo: minha.motivo,
          respondido_em: minha.respondido_em,
        }
      : null,
  };
}

function calcularCalibracao(minhas) {
  const resolvidas = (minhas || []).filter(
    (resposta) => resposta.acertou !== undefined && resposta.acertou !== null
  );

  const faixas = CONFIANCAS.map((confianca) => {
    const daFaixa = resolvidas.filter((resposta) => Number(resposta.confianca) === confianca);
    const acertos = daFaixa.filter((resposta) => resposta.acertou).length;
    return {
      confianca,
      respostas: daFaixa.length,
      acertos,
      taxa: daFaixa.length ? acertos / daFaixa.length : null,
    };
  });

  const soma = resolvidas.reduce((acc, resposta) => acc + (Number(resposta.brier) || 0), 0);

  return {
    total: resolvidas.length,
    minimo: MINIMO_CALIBRACAO,
    faixas,
    precisao: resolvidas.length ? 1 - soma / resolvidas.length : null,
    sequencia: sequenciaDeDias(minhas),
  };
}

/**
 * Ranking de precisão dos últimos 30 dias: só entra quem tem pelo menos 5
 * respostas resolvidas, e a ordem é pelo Brier médio (menor é melhor).
 */
async function rankingDePrecisao(base44, perfil, agora = Date.now()) {
  const desde = new Date(agora - RANKING_DIAS * 86400000).toISOString();
  const respostas = [];
  let cursor = null;

  for (let pagina = 0; pagina < 10; pagina += 1) {
    const lote = await base44.asServiceRole.entities.Forecast.filter(
      { brier: { $exists: true }, respondido_em: { $gte: desde } },
      cursor ? { limit: 200, cursor } : { limit: 200 }
    );
    respostas.push(...(lote.items || []));
    if (!lote.has_more || !lote.next_cursor) break;
    cursor = lote.next_cursor;
  }

  const porJogador = new Map();
  for (const resposta of respostas) {
    if (resposta.brier === null || resposta.brier === undefined) continue;
    if (resposta.acertou === null || resposta.acertou === undefined) continue;
    const atual = porJogador.get(resposta.jogador) || {
      jogador: resposta.jogador,
      respostas: 0,
      soma: 0,
      acertos: 0,
    };
    atual.respostas += 1;
    atual.soma += Number(resposta.brier) || 0;
    if (resposta.acertou) atual.acertos += 1;
    porJogador.set(resposta.jogador, atual);
  }

  const elegiveis = [...porJogador.values()].filter(
    (linha) => linha.respostas >= RANKING_MINIMO_RESPOSTAS
  );
  if (!elegiveis.length) {
    return { dias: RANKING_DIAS, minimo: RANKING_MINIMO_RESPOSTAS, total: 0, linhas: [], minha: null };
  }

  const perfis = await base44.asServiceRole.entities.PlayerProfile.filter(
    { id: { $in: elegiveis.map((linha) => linha.jogador) } },
    { limit: 200 }
  );
  const apelidos = new Map((perfis.items || []).map((item) => [item.id, item.apelido]));

  const classificadas = elegiveis
    .map((linha) => ({
      jogador: linha.jogador,
      apelido: apelidos.get(linha.jogador) || 'Jogador',
      respostas: linha.respostas,
      brier: Math.round((linha.soma / linha.respostas) * 10000) / 10000,
      taxa: Math.round((linha.acertos / linha.respostas) * 1000) / 1000,
    }))
    .sort((a, b) => a.brier - b.brier || b.taxa - a.taxa || a.apelido.localeCompare(b.apelido))
    .map((linha, indice) => ({ ...linha, posicao: indice + 1, eu: linha.jogador === perfil.id }));

  return {
    dias: RANKING_DIAS,
    minimo: RANKING_MINIMO_RESPOSTAS,
    total: classificadas.length,
    linhas: classificadas.slice(0, RANKING_TOP),
    minha: classificadas.find((linha) => linha.eu) || null,
  };
}

/**
 * Tudo o que a sala do Desafio precisa: perguntas abertas visíveis ao jogador,
 * resultados das que ele respondeu, placar alunos × tutor e a calibração dele.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const perfil = await perfilDoJogador(base44, user.id);
    if (!perfil) return Response.json({ error: 'Perfil não encontrado.' }, { status: 404 });

    const [abertas, resolvidas, progresso, minhas, aulas] = await Promise.all([
      base44.asServiceRole.entities.LiveQuestion.filter(
        { status: { $in: ['aberta', 'fechada'] } },
        { limit: 100 }
      ),
      base44.asServiceRole.entities.LiveQuestion.filter(
        { status: 'resolvida' },
        { sort: '-resolve_em', limit: 40 }
      ),
      base44.asServiceRole.entities.LessonProgress.filter({ player: perfil.id }, { limit: 300 }),
      base44.asServiceRole.entities.Forecast.filter({ jogador: perfil.id }, { limit: 500 }),
      todasAsAulasPublicadas(base44),
    ]);

    const aulasPublicadas = new Set(aulas.map((aula) => aula.id));
    const metricaPorAula = new Map(aulas.map((aula) => [aula.id, aula.cmc_metrica]));

    const estudadas = new Set(
      (progresso.items || [])
        .filter((registro) => ESTUDADAS.includes(registro.status))
        .map((registro) => registro.lesson)
    );
    // Uma pergunta por métrica ao dia: quem estudou qualquer aula da métrica a vê.
    const metricasEstudadas = new Set(
      [...estudadas].map((id) => metricaPorAula.get(id)).filter(Boolean)
    );
    const minhasPorPergunta = new Map((minhas.items || []).map((r) => [r.pergunta, r]));
    const resolvidasLista = resolvidas.items || [];
    const agora = Date.now();

    // Pergunta de fear_greed sem aula correspondente fica só como contexto do tutor.
    const visiveis = (pergunta) => {
      if (pergunta.metrica === 'fear_greed' && !aulasPublicadas.has(pergunta.lesson)) return false;
      return (
        Boolean(pergunta.destaque) ||
        estudadas.has(pergunta.lesson) ||
        metricasEstudadas.has(pergunta.metrica)
      );
    };

    const perguntas = (abertas.items || [])
      .filter(visiveis)
      .sort(
        (a, b) =>
          Number(Boolean(b.destaque)) - Number(Boolean(a.destaque)) ||
          new Date(a.fecha_respostas_em).getTime() - new Date(b.fecha_respostas_em).getTime()
      )
      .map((pergunta) => perguntaPublica(pergunta, minhasPorPergunta.get(pergunta.id), agora));

    // Média de respostas "acima" e placar saem das respostas das perguntas resolvidas.
    const idsResolvidas = resolvidasLista.map((pergunta) => pergunta.id);
    const respostasResolvidas = idsResolvidas.length
      ? (
          await base44.asServiceRole.entities.Forecast.filter(
            { pergunta: { $in: idsResolvidas } },
            { limit: 500 }
          )
        ).items || []
      : [];

    const porPergunta = new Map();
    for (const resposta of respostasResolvidas) {
      const lista = porPergunta.get(resposta.pergunta) || [];
      lista.push(resposta);
      porPergunta.set(resposta.pergunta, lista);
    }

    const resultados = resolvidasLista
      .filter(
        (pergunta) => visiveis(pergunta) && (minhasPorPergunta.has(pergunta.id) || pergunta.destaque)
      )
      .slice(0, MAX_RESULTADOS)
      .map((pergunta) => {
        const doGrupo = porPergunta.get(pergunta.id) || [];
        const acima = doGrupo.filter((resposta) => resposta.lado === 'acima').length;
        const minha = minhasPorPergunta.get(pergunta.id);

        return {
          ...perguntaPublica(pergunta, minha, agora),
          valor_fechamento: pergunta.valor_fechamento,
          variacao_24h_fechamento: pergunta.variacao_24h_fechamento ?? null,
          horario_fechamento: pergunta.horario_fechamento,
          resultado: pergunta.resultado,
          explicacao_pt: pergunta.explicacao_pt,
          explicacao_en: pergunta.explicacao_en,
          media_acima: doGrupo.length ? acima / doGrupo.length : null,
          total_respostas: doGrupo.length,
          minha_resposta: minha
            ? {
                lado: minha.lado,
                confianca: minha.confianca,
                motivo: minha.motivo,
                respondido_em: minha.respondido_em,
                xp_ganho: Number(minha.xp_ganho) || 0,
                acertou: Boolean(minha.acertou),
                brier: Number(minha.brier) || 0,
              }
            : null,
        };
      });

    const ranking = await rankingDePrecisao(base44, perfil);

    return Response.json({
      ok: true,
      perguntas,
      resultados,
      abertas: perguntas.filter((pergunta) => new Date(pergunta.fecha_respostas_em).getTime() > agora)
        .length,
      destaque: perguntas.find((pergunta) => pergunta.destaque) || null,
      placar: calcularPlacar(resolvidasLista, respostasResolvidas),
      calibracao: calcularCalibracao(minhas.items || []),
      ranking_precisao: ranking,
      desde: resolvidasLista.length
        ? [...resolvidasLista].sort(
            (a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
          )[0].created_date
        : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
