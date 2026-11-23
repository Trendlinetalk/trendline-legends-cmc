/**
 * Desafio diário com dados da CoinMarketCap — regras únicas do servidor.
 * Usado por cmcSnapshot, responderDesafio, obterDesafios e obterDemo.
 */

export const CONFIANCAS = [0.55, 0.65, 0.75, 0.85, 0.95];
export const MOTIVOS = ['conceito', 'dados', 'fluxo', 'intuicao'];
export const XP_BONUS_MADRUGADOR = 2;
export const HORAS_MADRUGADOR = 3;
export const MINIMO_CALIBRACAO = 5;

/** Fonte única dos caminhos usados pela coleta, pelas perguntas e pela demo. */
export const CMC_ENDPOINTS = {
  cotacoes: '/v3/cryptocurrency/quotes/latest',
  globais: '/v1/global-metrics/quotes/latest',
  medo: '/v3/fear-and-greed/latest',
};

/** Cada métrica sabe o ativo, o formato de exibição e o endpoint que a prova. */
export const METRICAS = {
  btc_price: { ativo: 'BTC', formato: 'preco', endpoint: CMC_ENDPOINTS.cotacoes },
  eth_price: { ativo: 'ETH', formato: 'preco', endpoint: CMC_ENDPOINTS.cotacoes },
  btc_volume_24h: { ativo: 'BTC', formato: 'volume', endpoint: CMC_ENDPOINTS.cotacoes },
  total_market_cap: { ativo: 'MARKET', formato: 'market_cap', endpoint: CMC_ENDPOINTS.globais },
  btc_dominance: { ativo: 'BTC', formato: 'dominancia', endpoint: CMC_ENDPOINTS.globais },
  fear_greed: { ativo: 'FEAR', formato: 'indice', endpoint: CMC_ENDPOINTS.medo },
};

export const ENDPOINTS_CMC = [
  `${CMC_ENDPOINTS.cotacoes}?id=1,1027&convert=USD`,
  `${CMC_ENDPOINTS.globais}?convert=USD`,
  CMC_ENDPOINTS.medo,
];

export function dadosDaMetrica(metricas, metrica) {
  const dados = metricas?.[metrica];
  if (!dados || typeof dados.valor !== 'number' || !Number.isFinite(dados.valor)) return null;
  return dados;
}

export function localeDe(idioma) {
  return idioma === 'en' ? 'en-US' : 'pt-BR';
}

function numero(valor, idioma, casas = 0) {
  return new Intl.NumberFormat(localeDe(idioma), {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor);
}

/** Valor no formato do jogo: preço, market cap em trilhões, volume em bilhões, %. */
export function formatarValor(valor, formato, idioma = 'pt') {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  switch (formato) {
    case 'preco':
      return `US$ ${numero(valor, idioma, valor >= 1000 ? 0 : 2)}`;
    case 'market_cap':
      return idioma === 'en'
        ? `US$ ${numero(valor / 1e12, idioma, 2)} trillion`
        : `US$ ${numero(valor / 1e12, idioma, 2)} trilhões`;
    case 'volume':
      return idioma === 'en'
        ? `US$ ${numero(valor / 1e9, idioma, 2)} billion`
        : `US$ ${numero(valor / 1e9, idioma, 2)} bilhões`;
    case 'dominancia':
      return `${numero(valor, idioma, 2)}%`;
    default:
      return numero(valor, idioma, 0);
  }
}

export function formatarVariacao(valor, idioma = 'pt') {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  return `${valor > 0 ? '+' : ''}${numero(valor, idioma, 2)}%`;
}

/**
 * brier = (p - o)²; XP = round(40 - 44 × (p - o)²) + 2 para quem responde nas
 * primeiras 3 h. Sem piso artificial: o pior caso (95% errado) já fecha em 0 e
 * chutar 95% não premia. Teto de 40 por resposta certa com 95%.
 */
export function calcularPontuacao(confianca, acertou, madrugador = false) {
  const p = Number(confianca) || 0;
  const o = acertou ? 1 : 0;
  const erro = p - o;
  const brier = Number((erro * erro).toFixed(4));
  const calibracao = Math.round(40 - 44 * erro * erro);
  const xp = calibracao + (madrugador ? XP_BONUS_MADRUGADOR : 0);
  return { brier, xp, calibracao };
}

/**
 * Placar alunos × tutor: taxa de acerto e precisão (1 - Brier médio) das respostas
 * já resolvidas. Usado pela sala do Desafio e pelo modo demo.
 */
export function calcularPlacar(resolvidas, respostas) {
  let total = 0;
  let acertos = 0;
  let somaBrier = 0;

  for (const resposta of respostas || []) {
    if (resposta.acertou === undefined || resposta.acertou === null) continue;
    total += 1;
    if (resposta.acertou) acertos += 1;
    somaBrier += Number(resposta.brier) || 0;
  }

  const comPrevisao = (resolvidas || []).filter((q) => q.previsao_tutor_lado && q.resultado);
  let acertosTutor = 0;
  let somaTutor = 0;

  for (const pergunta of comPrevisao) {
    const acertou = pergunta.previsao_tutor_lado === pergunta.resultado ? 1 : 0;
    acertosTutor += acertou;
    const p = Number(pergunta.previsao_tutor_confianca) || 0.65;
    somaTutor += (p - acertou) * (p - acertou);
  }

  return {
    alunos: {
      respostas: total,
      taxa: total ? acertos / total : null,
      brier: total ? somaBrier / total : null,
      precisao: total ? 1 - somaBrier / total : null,
    },
    tutor: {
      respostas: comPrevisao.length,
      taxa: comPrevisao.length ? acertosTutor / comPrevisao.length : null,
      brier: comPrevisao.length ? somaTutor / comPrevisao.length : null,
      precisao: comPrevisao.length ? 1 - somaTutor / comPrevisao.length : null,
    },
  };
}

export function inicioDoDiaUtc(quando) {
  const data = new Date(quando);
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

export function dataUtc(quando) {
  return new Date(quando).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* CoinMarketCap                                                       */
/* ------------------------------------------------------------------ */

function cotacaoDe(item) {
  if (!item) return null;
  const quote = item.quote;

  // v3: quote é uma lista; o item do USD traz os campos no próprio objeto
  // (symbol: "USD", price, volume_24h, last_updated) e alguns proxies aninham em .USD.
  if (Array.isArray(quote)) {
    for (const linha of quote) {
      if (!linha) continue;
      if (typeof linha.price === 'number') return linha;
      if (linha.USD) return linha.USD;
    }
    return null;
  }

  // v2: quote é objeto por moeda.
  if (quote?.USD) return quote.USD;
  if (typeof quote?.price === 'number') return quote;
  return null;
}

const CANONICOS = { BTC: 1, ETH: 1027 };

/** v2 devolve objeto por símbolo; v3 devolve lista com vários ativos do mesmo símbolo. */
function normalizarCotacoes(payload) {
  const lista = Array.isArray(payload) ? payload : Object.values(payload || {});
  const porSimbolo = new Map();

  for (const item of lista) {
    const quote = cotacaoDe(item);
    if (!quote || !item?.symbol) continue;
    const canonico = CANONICOS[item.symbol];
    const atual = porSimbolo.get(item.symbol);
    if (!atual || item.id === canonico) {
      porSimbolo.set(item.symbol, {
        id: item.id,
        preco: quote.price,
        volume_24h: quote.volume_24h,
        variacao_24h: quote.percent_change_24h,
        last_updated: quote.last_updated,
      });
    }
  }
  return porSimbolo;
}

/** Espera crescente entre as tentativas: 30 s, 2 min e 5 min. */
export const ESPERAS_CMC = [30000, 120000, 300000];

/**
 * A requisição é cortada em 5 min: a coleta reserva 4,5 min para as tentativas.
 * Uma espera que não caberia no orçamento não é feita, e a falha vai para o log.
 */
const ORCAMENTO_CMC = 270000;

function valeRepetir(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Lê a CoinMarketCap. Com CMC_API_KEY usa a API Pro; sem chave usa a API
 * pública de teste (keyless). A chave nunca sai do servidor.
 * Uma chamada por endpoint, já com todos os símbolos juntos, e até 3 novas
 * tentativas com espera crescente quando a CMC responde 429/5xx.
 */
export async function buscarCmc(chave, registrarFalha, registrarQueda, rapido = false) {
  const pro = Boolean(chave);
  const base = pro
    ? 'https://pro-api.coinmarketcap.com'
    : 'https://pro-api.coinmarketcap.com/trial-pro-api';
  const cabecalhos = pro
    ? { 'X-CMC_PRO_API_KEY': chave, Accept: 'application/json' }
    : { Accept: 'application/json' };
  // A reserva keyless roda sem esperas: o orçamento já foi gasto na tentativa Pro.
  const esperas = rapido ? [] : ESPERAS_CMC;

  // Pro e keyless usam os mesmos endpoints e os IDs canônicos de BTC e ETH.
  const [caminhoCotacoes, caminhoGlobais, caminhoMedo] = ENDPOINTS_CMC;
  const inicio = Date.now();
  const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const pedir = async (caminho) => {
    let motivo = 'sem resposta';

    for (let tentativa = 0; tentativa <= esperas.length; tentativa += 1) {
      let resposta = null;
      try {
        resposta = await fetch(`${base}${caminho}`, {
          headers: cabecalhos,
          signal: AbortSignal.timeout(12000),
        });
      } catch (erro) {
        motivo = String(erro?.message || erro);
      }

      if (resposta?.ok) return resposta.json();
      if (resposta) {
        motivo = `HTTP ${resposta.status}`;
        if (!valeRepetir(resposta.status)) {
          throw new Error(`CoinMarketCap ${caminho} respondeu ${resposta.status}`);
        }
      }

      const espera = esperas[tentativa];
      if (espera === undefined) break;
      if (Date.now() - inicio + espera > ORCAMENTO_CMC) {
        if (registrarFalha) {
          await registrarFalha({ caminho, tentativa: tentativa + 1, motivo, espera: null });
        }
        break;
      }
      if (registrarFalha) {
        await registrarFalha({ caminho, tentativa: tentativa + 1, motivo, espera });
      }
      await dormir(espera);
    }

    throw new Error(`CoinMarketCap ${caminho}: ${motivo}`);
  };

  const [cotacoes, globais, medo] = await Promise.allSettled([
    pedir(caminhoCotacoes),
    pedir(caminhoGlobais),
    pedir(caminhoMedo),
  ]);

  const metricas = {};
  const erros = [];
  const resumo = {};

  if (cotacoes.status === 'fulfilled') {
    const porSimbolo = normalizarCotacoes(cotacoes.value?.data);
    const btc = porSimbolo.get('BTC');
    const eth = porSimbolo.get('ETH');

    if (btc) {
      metricas.btc_price = { valor: btc.preco, variacao_24h: btc.variacao_24h, last_updated: btc.last_updated };
      metricas.btc_volume_24h = { valor: btc.volume_24h, variacao_24h: btc.variacao_24h, last_updated: btc.last_updated };
      resumo.btc = { price: btc.preco, volume_24h: btc.volume_24h, percent_change_24h: btc.variacao_24h };
    }
    if (eth) {
      metricas.eth_price = { valor: eth.preco, variacao_24h: eth.variacao_24h, last_updated: eth.last_updated };
      resumo.eth = { price: eth.preco, percent_change_24h: eth.variacao_24h };
    }
    if (!btc && !eth) erros.push('Cotações sem BTC/ETH na resposta');
  } else {
    erros.push(String(cotacoes.reason?.message || cotacoes.reason));
  }

  if (globais.status === 'fulfilled') {
    const dados = globais.value?.data || {};
    const quote = dados.quote?.USD || {};
    if (typeof quote.total_market_cap === 'number') {
      metricas.total_market_cap = {
        valor: quote.total_market_cap,
        variacao_24h: null,
        last_updated: dados.last_updated || null,
      };
    }
    if (typeof dados.btc_dominance === 'number') {
      metricas.btc_dominance = {
        valor: dados.btc_dominance,
        variacao_24h: dados.btc_dominance_24h_percentage_change ?? null,
        last_updated: dados.last_updated || null,
      };
    }
    resumo.global = {
      total_market_cap: quote.total_market_cap ?? null,
      btc_dominance: dados.btc_dominance ?? null,
      last_updated: dados.last_updated ?? null,
    };
  } else {
    erros.push(String(globais.reason?.message || globais.reason));
  }

  if (medo.status === 'fulfilled') {
    const dados = medo.value?.data || {};
    if (typeof dados.value === 'number') {
      metricas.fear_greed = {
        valor: dados.value,
        variacao_24h: null,
        last_updated: dados.update_time || null,
        classificacao: dados.value_classification || null,
      };
    }
    resumo.fear_greed = { value: dados.value ?? null, classification: dados.value_classification ?? null };
  } else {
    // Fear and greed pode falhar sem derrubar a rodada.
    erros.push(String(medo.reason?.message || medo.reason));
  }

  const coleta = {
    metricas,
    erros,
    resumo,
    fonte: pro ? 'pro' : 'keyless',
    endpoints_chamados: [caminhoCotacoes, caminhoGlobais, caminhoMedo],
    endpointCotacoes: caminhoCotacoes,
  };

  // Pro sem as métricas essenciais (chave recusada, cota estourada ou resposta
  // vazia): cai para a API pública de teste, avisa o professor e segue a rodada.
  const essenciais = Boolean(coleta.metricas.btc_price && coleta.metricas.total_market_cap);
  if (pro && !essenciais) {
    if (registrarQueda) {
      await registrarQueda({
        motivo: erros.join(' | ') || 'métricas essenciais ausentes na resposta Pro',
        metricas_lidas: Object.keys(metricas),
      });
    }
    const reserva = await buscarCmc('', registrarFalha, null, true);
    reserva.erros = [...erros.map((erro) => `pro: ${erro}`), ...reserva.erros];
    return reserva;
  }

  return coleta;
}

/* ------------------------------------------------------------------ */
/* Tutor Trendline Talk                                                */
/* ------------------------------------------------------------------ */

export const PERSONA_TUTOR = `Você é o "Trendline Talk", analista de mercado cripto do jogo Trendline Legends.
Fale como um mentor didático e neutro: ensine o conceito, nunca dê recomendação de investimento,
nunca prometa resultado e nunca diga qual lado vai acontecer. Use apenas os números do snapshot
informado e o conceito da aula.`;

function normalizarLeitura(bruto) {
  const texto = (valor, padrao) => {
    const limpo = String(valor || '').trim();
    return limpo || padrao;
  };
  const confianca = Math.min(0.95, Math.max(0.55, Number(bruto?.confianca) || 0.65));

  return {
    leitura_pt: {
      a_favor_acima: texto(bruto?.acima_pt, 'A média de 24 h ainda sustenta o preço acima do fechamento anterior.'),
      a_favor_abaixo: texto(bruto?.abaixo_pt, 'Perder o fechamento anterior enfraquece a estrutura estudada na aula.'),
    },
    leitura_en: {
      a_favor_acima: texto(bruto?.acima_en, 'The 24 h average still holds the price above the previous close.'),
      a_favor_abaixo: texto(bruto?.abaixo_en, 'Losing the previous close weakens the structure studied in the lesson.'),
    },
    lado: bruto?.lado === 'abaixo' ? 'abaixo' : 'acima',
    confianca,
    motivo: texto(bruto?.motivo, 'Leitura técnica do fechamento anterior com o conceito da aula.'),
  };
}

/** Resumo do snapshot inteiro para o prompt do tutor: preço, variação, dominância e medo. */
export function resumoContexto(metricas, idioma = 'pt') {
  const linhas = [];
  const comVariacao = (dados, rotulo, formato) => {
    if (!dadosDaMetrica(metricas, rotulo.chave)) return;
    const variacao = formatarVariacao(dados.variacao_24h, idioma);
    linhas.push(
      `${rotulo.nome}: ${formatarValor(dados.valor, formato, idioma)}${variacao ? ` (24 h: ${variacao})` : ''}`
    );
  };

  const btc = dadosDaMetrica(metricas, 'btc_price');
  if (btc) comVariacao(btc, { chave: 'btc_price', nome: 'BTC' }, 'preco');
  const eth = dadosDaMetrica(metricas, 'eth_price');
  if (eth) comVariacao(eth, { chave: 'eth_price', nome: 'ETH' }, 'preco');
  const volume = dadosDaMetrica(metricas, 'btc_volume_24h');
  if (volume) linhas.push(`Volume 24 h do BTC: ${formatarValor(volume.valor, 'volume', idioma)}`);
  const marketCap = dadosDaMetrica(metricas, 'total_market_cap');
  if (marketCap) linhas.push(`Market cap total: ${formatarValor(marketCap.valor, 'market_cap', idioma)}`);
  const dominancia = dadosDaMetrica(metricas, 'btc_dominance');
  if (dominancia) {
    const variacao = formatarVariacao(dominancia.variacao_24h, idioma);
    linhas.push(
      `Dominância do BTC: ${formatarValor(dominancia.valor, 'dominancia', idioma)}${variacao ? ` (24 h: ${variacao})` : ''}`
    );
  }
  const medo = dadosDaMetrica(metricas, 'fear_greed');
  if (medo) {
    linhas.push(
      `Fear & Greed: ${formatarValor(medo.valor, 'indice', idioma)}${medo.classificacao ? ` (${medo.classificacao})` : ''}`
    );
  }

  return linhas.join('\n');
}

/** Leitura (dois argumentos) + previsão própria do tutor, em PT e EN. */
export async function gerarLeituraTutor(base44, { aula, metrica, dados, metricas }) {
  const formato = METRICAS[metrica]?.formato || 'preco';
  const valorPt = formatarValor(dados.valor, formato, 'pt');
  const variacao = formatarVariacao(dados.variacao_24h, 'pt') || 'sem variação informada';
  const contexto = resumoContexto(metricas || {}, 'pt') || 'sem outros números no snapshot';

  const prompt = `${PERSONA_TUTOR}

AULA: ${aula.titulo}
CONCEITO DA AULA: ${String(aula.conteudo_pt || aula.resumo || aula.titulo || '').slice(0, 900)}

SNAPSHOT DA COINMARKETCAP (capturado em ${metricas?.capturado_em || dados.last_updated || 'agora'}):
${contexto}

MÉTRICA DA PERGUNTA:
- métrica: ${metrica}
- valor de referência: ${valorPt}
- variação de 24 h: ${variacao}
- atualizado em: ${dados.last_updated || 'agora'}

A PERGUNTA: o valor de fechamento de amanhã (00:00 UTC) fica ACIMA ou ABAIXO de ${valorPt}?

Regras dos argumentos:
- cada argumento (acima_pt, abaixo_pt, acima_en, abaixo_en) cita pelo menos um número real do snapshot
  (preço, variação de 24 h, dominância do BTC, market cap, volume ou Fear & Greed);
- nenhum argumento diz qual lado vai acontecer: você apresenta o argumento de cada lado, não o vencedor.

Devolva JSON com:
- acima_pt e abaixo_pt: um argumento curto cada (no máximo 35 palavras), ligado ao conceito da aula;
- acima_en e abaixo_en: os mesmos argumentos em inglês;
- lado: sua previsão própria, "acima" ou "abaixo";
- confianca: número entre 0.55 e 0.95;
- motivo: uma frase curta (no máximo 25 palavras) justificando a previsão.`;

  const resposta = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        acima_pt: { type: 'string' },
        abaixo_pt: { type: 'string' },
        acima_en: { type: 'string' },
        abaixo_en: { type: 'string' },
        lado: { type: 'string', enum: ['acima', 'abaixo'] },
        confianca: { type: 'number' },
        motivo: { type: 'string' },
      },
      required: ['acima_pt', 'abaixo_pt', 'acima_en', 'abaixo_en', 'lado', 'confianca', 'motivo'],
    },
  });

  return normalizarLeitura(resposta);
}

export function leituraPadrao(metrica, dados) {
  const formato = METRICAS[metrica]?.formato || 'preco';
  const valorPt = formatarValor(dados?.valor, formato, 'pt');
  const valorEn = formatarValor(dados?.valor, formato, 'en');

  return {
    leitura_pt: {
      a_favor_acima: `Enquanto o preço não perde ${valorPt}, a estrutura estudada na aula segue válida e o fechamento pode se manter acima.`,
      a_favor_abaixo: `Um fechamento abaixo de ${valorPt} invalida a região estudada na aula e abre espaço para o preço buscar níveis mais baixos.`,
    },
    leitura_en: {
      a_favor_acima: `While the price holds above ${valorEn}, the structure from the lesson stays valid and the close can remain higher.`,
      a_favor_abaixo: `A close below ${valorEn} invalidates the area studied in the lesson and opens room for lower levels.`,
    },
    lado: 'acima',
    confianca: 0.65,
    motivo: 'Leitura padrão do fechamento anterior, usada quando o tutor não respondeu.',
  };
}

/** Explicação do resultado (até 80 palavras), em PT e EN. */
export async function gerarExplicacao(base44, { aula, pergunta, formato, valorReferencia, valorFechamento, variacao, resultado }) {
  const refPt = formatarValor(valorReferencia, formato, 'pt');
  const fechPt = formatarValor(valorFechamento, formato, 'pt');
  const variacaoPt = formatarVariacao(variacao, 'pt') || 'sem variação informada';

  const prompt = `${PERSONA_TUTOR}

AULA: ${aula?.titulo || 'Conceito de mercado'}
CONCEITO DA AULA: ${String(aula?.conteudo_pt || aula?.resumo || '').slice(0, 700)}

RESULTADO DO DESAFIO:
- pergunta: ${pergunta}
- valor de referência: ${refPt}
- valor de fechamento: ${fechPt}
- variação de 24 h: ${variacaoPt}
- resultado: o valor fechou ${resultado.toUpperCase()} da referência

Explique em no máximo 80 palavras, em português e em inglês: o que aconteceu com o número,
a ligação com o conceito da aula e uma lição prática de gestão de risco.
Devolva JSON com as chaves "pt" e "en".`;

  const resposta = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: { pt: { type: 'string' }, en: { type: 'string' } },
      required: ['pt', 'en'],
    },
  });

  const pt = String(resposta?.pt || '').trim();
  const en = String(resposta?.en || '').trim();
  if (!pt || !en) throw new Error('Explicação vazia');
  return { pt, en };
}

export function explicacaoPadrao({ formato, valorReferencia, valorFechamento, variacao, resultado }) {
  const refPt = formatarValor(valorReferencia, formato, 'pt');
  const fechPt = formatarValor(valorFechamento, formato, 'pt');
  const refEn = formatarValor(valorReferencia, formato, 'en');
  const fechEn = formatarValor(valorFechamento, formato, 'en');
  const varPt = formatarVariacao(variacao, 'pt') || 'sem variação';
  const varEn = formatarVariacao(variacao, 'en') || 'no change';

  return {
    pt: `A métrica fechou em ${fechPt} (${varPt}), contra a referência de ${refPt}: o resultado foi ${resultado}. A aula mostra que o fechamento é o que confirma a estrutura, não o movimento do meio do caminho. Lição prática: espere o candle fechar antes de agir e mantenha o risco pequeno quando a leitura ainda é incerta.`,
    en: `The metric closed at ${fechEn} (${varEn}) against the ${refEn} reference: the outcome was ${resultado}. The lesson shows that the close confirms the structure, not the move in between. Practical lesson: wait for the candle to close before acting and keep risk small while your read is still uncertain.`,
  };
}
