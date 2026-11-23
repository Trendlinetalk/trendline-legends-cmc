import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { ENDPOINTS_CMC, METRICAS, calcularPlacar } from '../../shared/desafio.ts';

/**
 * Modo demo para jurados: leitura pública, sem login e sem dado pessoal.
 * Devolve a pergunta do dia, um ciclo completo de exemplo e o último snapshot.
 * Enquanto não houver dois snapshots reais, o ciclo vem marcado como amostra.
 */

const EXEMPLO = {
  aula_titulo_pt: 'Suporte e resistência',
  aula_titulo_en: 'Support and resistance',
  pergunta_pt: 'O BTC vai fechar acima ou abaixo de US$ 62.169?',
  pergunta_en: 'Will BTC close above or below US$ 62,169?',
  metrica: 'btc_price',
  ativo: 'BTC',
  formato: 'preco',
  endpoint_consulta: METRICAS.btc_price.endpoint,
  valor_referencia: 62169,
  variacao_24h: -1.84,
  horario_referencia: '2026-11-18T00:00:00Z',
  valor_fechamento: 63480,
  variacao_24h_fechamento: 2.11,
  horario_fechamento: '2026-11-19T00:00:00Z',
  resultado: 'acima',
  previsao_tutor_lado: 'acima',
  previsao_tutor_confianca: 0.65,
  previsao_tutor_motivo: 'O fechamento anterior segurou o preço acima do suporte estudado na aula.',
  leitura_tutor_pt: {
    a_favor_acima: 'O preço fechou acima do suporte estudado e a média de 24 h segue apontando para cima.',
    a_favor_abaixo: 'Uma perda do suporte estudado abriria espaço para o preço buscar níveis mais baixos.',
  },
  leitura_tutor_en: {
    a_favor_acima: 'Price closed above the support studied in the lesson and the 24 h average still points up.',
    a_favor_abaixo: 'Losing the studied support would open room for the price to seek lower levels.',
  },
  explicacao_pt:
    'O BTC fechou em US$ 63.480, acima da referência de US$ 62.169. A aula mostra que o fechamento confirma o suporte, não o movimento do meio do caminho. Lição prática: espere o candle fechar e mantenha o risco pequeno quando a leitura ainda é incerta.',
  explicacao_en:
    'BTC closed at US$ 63,480, above the US$ 62,169 reference. The lesson shows that the close confirms the support, not the move in between. Practical lesson: wait for the candle to close and keep risk small while your read is uncertain.',
  xp_exemplo: 35,
  calibracao_exemplo: [
    { confianca: 0.55, respostas: 12, acertos: 8 },
    { confianca: 0.75, respostas: 9, acertos: 6 },
    { confianca: 0.95, respostas: 4, acertos: 4 },
  ],
  amostra: true,
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const [snapshots, abertas, resolvidas] = await Promise.all([
      base44.asServiceRole.entities.CmcSnapshot.list({ sort: '-capturado_em', limit: 2 }),
      base44.asServiceRole.entities.LiveQuestion.filter(
        { status: { $in: ['aberta', 'fechada'] } },
        { limit: 20 }
      ),
      base44.asServiceRole.entities.LiveQuestion.filter(
        { status: 'resolvida' },
        { sort: '-resolve_em', limit: 40 }
      ),
    ]);

    const listaSnapshots = snapshots.items || [];
    const ultimo = listaSnapshots[0] || null;
    const perguntas = abertas.items || [];
    const destaque = perguntas.find((pergunta) => pergunta.destaque) || perguntas[0] || null;
    const resolvidasLista = resolvidas.items || [];
    const resolvida = resolvidasLista[0] || null;

    const respostas = resolvidasLista.length
      ? (
          await base44.asServiceRole.entities.Forecast.filter(
            { pergunta: { $in: resolvidasLista.map((pergunta) => pergunta.id) } },
            { limit: 500 }
          )
        ).items || []
      : [];

    const exemplo = resolvida
      ? {
          aula_titulo_pt: resolvida.aula_titulo_pt,
          aula_titulo_en: resolvida.aula_titulo_en,
          pergunta_pt: resolvida.pergunta_pt,
          pergunta_en: resolvida.pergunta_en,
          metrica: resolvida.metrica,
          ativo: resolvida.ativo,
          formato: resolvida.formato,
          endpoint_consulta: resolvida.endpoint_consulta,
          valor_referencia: resolvida.valor_referencia,
          variacao_24h: resolvida.variacao_24h,
          horario_referencia: resolvida.horario_referencia,
          valor_fechamento: resolvida.valor_fechamento,
          variacao_24h_fechamento: resolvida.variacao_24h_fechamento,
          horario_fechamento: resolvida.horario_fechamento,
          resultado: resolvida.resultado,
          previsao_tutor_lado: resolvida.previsao_tutor_lado,
          previsao_tutor_confianca: resolvida.previsao_tutor_confianca,
          previsao_tutor_motivo: resolvida.previsao_tutor_motivo,
          leitura_tutor_pt: resolvida.leitura_tutor_pt,
          leitura_tutor_en: resolvida.leitura_tutor_en,
          explicacao_pt: resolvida.explicacao_pt,
          explicacao_en: resolvida.explicacao_en,
          xp_exemplo: 35,
          calibracao_exemplo: EXEMPLO.calibracao_exemplo,
          amostra: false,
        }
      : EXEMPLO;

    return Response.json({
      ok: true,
      endpoints: ENDPOINTS_CMC,
      snapshot: ultimo
        ? {
            capturado_em: ultimo.capturado_em,
            fonte: ultimo.fonte,
            metricas: ultimo.metricas,
            endpoints_chamados: ultimo.endpoints_chamados || [],
            erros: ultimo.erros || [],
          }
        : null,
      destaque: destaque
        ? {
            aula_titulo_pt: destaque.aula_titulo_pt,
            aula_titulo_en: destaque.aula_titulo_en,
            pergunta_pt: destaque.pergunta_pt,
            pergunta_en: destaque.pergunta_en,
            metrica: destaque.metrica,
            ativo: destaque.ativo,
            formato: destaque.formato,
            endpoint_consulta: destaque.endpoint_consulta,
            valor_referencia: destaque.valor_referencia,
            variacao_24h: destaque.variacao_24h,
            horario_referencia: destaque.horario_referencia,
            fecha_respostas_em: destaque.fecha_respostas_em,
            resolve_em: destaque.resolve_em,
            leitura_tutor_pt: destaque.leitura_tutor_pt,
            leitura_tutor_en: destaque.leitura_tutor_en,
            destaque: Boolean(destaque.destaque),
          }
        : null,
      exemplo,
      placar: calcularPlacar(resolvidasLista, respostas),
      // Só o ciclo resolvido é amostra enquanto não houver uma pergunta real resolvida.
      amostra: !resolvida,
      perguntas_abertas: perguntas.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
