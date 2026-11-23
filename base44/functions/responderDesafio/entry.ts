import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { CONFIANCAS, HORAS_MADRUGADOR, MOTIVOS } from '../../shared/desafio.ts';
import { perfilDoJogador, pagarBonusDeSequencia } from '../../shared/progressao.ts';
import { todasAsAulasPublicadas } from '../../shared/aulas.ts';

const ESTUDADAS = ['disponivel', 'video_assistido', 'quiz_aprovado', 'aprovada'];

/**
 * Resposta do jogador ao desafio do dia.
 * Uma por jogador por pergunta, só antes do fechamento, sem edição depois.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const corpo = await req.json().catch(() => ({}));
    const perguntaId = corpo?.pergunta;
    const lado = corpo?.lado;
    const confianca = Number(corpo?.confianca);
    const motivo = corpo?.motivo || null;

    if (!perguntaId) return Response.json({ error: 'pergunta é obrigatória' }, { status: 400 });
    if (lado !== 'acima' && lado !== 'abaixo') {
      return Response.json({ error: 'Escolha ACIMA ou ABAIXO.' }, { status: 400 });
    }
    if (!CONFIANCAS.includes(confianca)) {
      return Response.json({ error: 'Confiança inválida.' }, { status: 400 });
    }
    if (motivo && !MOTIVOS.includes(motivo)) {
      return Response.json({ error: 'Motivo inválido.' }, { status: 400 });
    }

    const perfil = await perfilDoJogador(base44, user.id);
    if (!perfil) return Response.json({ error: 'Perfil não encontrado.' }, { status: 404 });

    const pergunta = await base44.asServiceRole.entities.LiveQuestion.get(perguntaId).catch(
      (e) => (e.status === 404 ? null : Promise.reject(e))
    );
    if (!pergunta) return Response.json({ error: 'Pergunta não encontrada.' }, { status: 404 });

    if (pergunta.status === 'resolvida') {
      return Response.json({ error: 'Esta pergunta já foi resolvida.' }, { status: 400 });
    }

    const agora = new Date();
    const fecha = new Date(pergunta.fecha_respostas_em).getTime();
    // Fechamento sem exceção: sem data válida ou a partir do horário de
    // fechamento, a resposta não entra (ninguém responde sabendo o resultado).
    if (!Number.isFinite(fecha) || agora.getTime() >= fecha) {
      return Response.json({ error: 'As respostas para esta pergunta já fecharam.' }, { status: 400 });
    }

    const existentes = await base44.asServiceRole.entities.Forecast.filter(
      { pergunta: perguntaId, jogador: perfil.id },
      { limit: 1 }
    );
    if ((existentes.items || []).length) {
      return Response.json({ error: 'Você já respondeu esta pergunta.' }, { status: 409 });
    }

    // Fora da Pergunta do dia, só responde quem já estudou a aula da pergunta
    // ou outra aula que ensine a mesma métrica (há uma pergunta por métrica).
    if (!pergunta.destaque) {
      const progresso = await base44.asServiceRole.entities.LessonProgress.filter(
        { player: perfil.id },
        { limit: 300 }
      );
      const estudadas = new Set(
        (progresso.items || [])
          .filter((registro) => ESTUDADAS.includes(registro.status))
          .map((registro) => registro.lesson)
      );

      if (!estudadas.has(pergunta.lesson)) {
        const aulas = await todasAsAulasPublicadas(base44);
        const daMetrica = aulas.some(
          (aula) => aula.cmc_metrica === pergunta.metrica && estudadas.has(aula.id)
        );
        if (!daMetrica) {
          return Response.json(
            { error: 'Leia a aula desta pergunta antes de responder.' },
            { status: 403 }
          );
        }
      }
    }

    const respondidoEm = agora.toISOString();
    const abertura = new Date(pergunta.created_date || pergunta.horario_referencia).getTime();
    const madrugador =
      Number.isFinite(abertura) && agora.getTime() - abertura <= HORAS_MADRUGADOR * 3600000;

    const criado = await base44.asServiceRole.entities.Forecast.create({
      jogador: perfil.id,
      usuario: user.id,
      pergunta: perguntaId,
      lado,
      confianca,
      motivo,
      respondido_em: respondidoEm,
      madrugador,
      xp_ganho: 0,
    });

    // Trava da corrida: uma resposta por pergunta e jogador. Duas chamadas
    // simultâneas passam pela checagem acima; a mais antiga fica, a outra sai.
    const minhas = await base44.asServiceRole.entities.Forecast.filter(
      { pergunta: perguntaId, jogador: perfil.id },
      { limit: 20 }
    );
    const ordenadas = [...(minhas.items || [])].sort(
      (a, b) =>
        new Date(a.created_date || 0).getTime() - new Date(b.created_date || 0).getTime() ||
        String(a.id).localeCompare(String(b.id))
    );
    if (ordenadas[0]?.id !== criado.id) {
      await base44.asServiceRole.entities.Forecast.delete(criado.id).catch(() => null);
      return Response.json({ error: 'Você já respondeu esta pergunta.' }, { status: 409 });
    }
    for (const sobra of ordenadas.slice(1)) {
      await base44.asServiceRole.entities.Forecast.delete(sobra.id).catch(() => null);
    }

    // Primeira atividade do dia: paga o bônus da sequência (uma vez por dia).
    const bonus = await pagarBonusDeSequencia(base44, perfil);

    return Response.json({
      ok: true,
      xp_sequencia: bonus.xp_ganho,
      forecast: {
        id: criado.id,
        lado,
        confianca,
        motivo,
        respondido_em: respondidoEm,
        madrugador,
      },
      fecha_respostas_em: pergunta.fecha_respostas_em,
      resolve_em: pergunta.resolve_em,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
