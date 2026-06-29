/**
 * Adaptador de scraping para Bet365 Brasil — via análise de dados capturados.
 *
 * Estratégia (sem browser direto):
 * 1. Analisa dados capturados previamente (como bet365_raw.log) ou simula captura
 * 2. Extrai jogos, mercados e odds do formato proprietário da Bet365
 * 3. Converte odds fracionárias para decimais
 * 4. Mapeia para o formato padrão ScrapedMatch/ScrapedOdd
 *
 * NOTA: A implementação atual foca no parsing do formato de dados identificado
 * no arquivo bet365_raw.log. Para uso em produção, pode ser necessário adaptar
 * para capturar dados em tempo real via outros meios.
 */

import { logger } from '../lib/logger';
import { normalizeLine } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';
import type { BrowserContext } from 'playwright';

// ─── Configuração ─────────────────────────────────────────────────────────────

// Em uma implementação real, estas viriam de variáveis de ambiente ou configuração
const SIMULATE_FROM_LOG_FILE = process.env.BET365_SIMULATE_FROM_LOG === 'true';
const LOG_FILE_PATH = process.env.BET365_LOG_PATH || './bet365_raw.log';

// ─── Funções auxiliares ───────────────────────────────────────────────────────

/**
 * Converte odds fracionárias para decimais.
 * Ex: "11/2" -> 6.5, "3/4" -> 1.75, "2/1" -> 3.0
 */
function parseFractionalOdds(fractional: string): number {
  try {
    const [numerator, denominator] = fractional.split('/').map(Number);
    if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return 0;
    return (numerator / denominator) + 1;
  } catch (e) {
    logger.warn(`[Bet365] Falha ao converter odds fracionárias "${fractional}":`, { error: String(e) });
    return 0;
  }
}

/**
 * Determina o mercado com base no nome do mercado/aposta.
 * Mapeia termos comuns da Bet365 para nossos padrões internos.
 */
function determineMarket(marketName: string): string | null {
  const lower = marketName.toLowerCase().trim();

  // Desarmes / Tackles
  if (
    lower.includes('desarme') ||
    lower.includes('tackle') ||
    lower.includes('desarmes') ||
    (lower.includes('jogador') && (lower.includes('desarme') || lower.includes('tackle')))
  ) {
    return 'desarmes';
  }

  // Faltas cometidas
  if (
    lower.includes('falta cometida') ||
    lower.includes('cometer falta') ||
    lower.includes('faltas cometidas') ||
    (lower.includes('jogador') && (lower.includes('falta cometida') || lower.includes('cometer falta')))
  ) {
    return 'faltas_cometidas';
  }

  // Faltas sofridas
  if (
    lower.includes('falta sofrida') ||
    lower.includes('sofrer falta') ||
    lower.includes('faltas sofridas') ||
    (lower.includes('jogador') && (lower.includes('falta sofrida') || lower.includes('sofrer falta')))
  ) {
    return 'faltas_sofridas';
  }

  // Mercados genéricos de jogador que podem ser mapeados
  if (lower.includes('jogador')) {
    // Tentativa genérica - pode precisar de ajuste fino
    if (lower.includes('chute') || lower.includes('finalização')) return 'chutes';
    if (lower.includes('passe') || lower.includes('assistência')) return 'passes';
    if (lower.includes('desarme') || lower.includes('tackle')) return 'desarmes';
    if (lower.includes('falta')) {
      if (lower.includes('cometida')) return 'faltas_cometidas';
      if (lower.includes('sofrida')) return 'faltas_sofridas';
    }
  }

  return null; // Mercado não reconhecido
}

/**
 * Extrai e normaliza a linha de aposta (ex: "1.5" -> "2+").
 */
function normalizeBettingLine(lineValue: string): string {
  try {
    const num = parseFloat(lineValue);
    if (!isFinite(num)) return '';

    // Converte para formato "X+" onde X é o número inteiro mínimo
    const base = Math.floor(num);
    if (base < 0) return '';

    // Para valores como 0.5, 1.5, 2.5 etc., retornamos "1+", "2+", "3+" etc.
    return `${Math.ceil(num)}+`;
  } catch {
    return '';
  }
}

/**
 * Analisa uma linha de dados da Bet365 e extrai informações de evento.
 * Baseado na análise do formato observado em bet365_raw.log.
 */
function parseBet365Line(line: string): {
  eventName?: string;
  homeTeam?: string;
  awayTeam?: string;
  marketName?: string;
  oddsValue?: string;
  isTeamLine?: boolean;
  teamId?: number;
} | null {
  // Ignora linhas vazias ou de cabeçalho
  if (!line || line.trim() === '' || line.startsWith('F|PS;')) return null;

  // Divide a linha pelos separadores de segmento
  const segments = line.split('|');

  // Procura por informações de evento
  let eventName: string | undefined;
  let homeTeam: string | undefined;
  let awayTeam: string | undefined;
  let marketName: string | undefined;
  let oddsValue: string | undefined;
  let isTeamLine = false;
  let teamId: number | undefined;

  // Analisa cada segmento
  for (const segment of segments) {
    if (segment.startsWith('EV;')) {
      // Segmento de evento - pode conter informações básicas
      // O nome do evento muitas vezes vem em segmentos MA; ou NA;
    } else if (segment.startsWith('MG;')) {
      // Segmento de jogo (match) - contém informações dos times
      const mgParts = segment.split(';');
      for (const part of mgParts) {
        if (part.startsWith('NA=')) {
          // Nome do jogo: NA=Time A v Time B
          const matchName = part.substring(3);
          if (matchName.includes(' v ')) {
            const teams = matchName.split(' v ');
            if (teams.length === 2) {
              awayTeam = teams[0].trim();
              homeTeam = teams[1].trim();
            } else {
              eventName = matchName;
            }
          }
        }
      }
    } else if (segment.startsWith('MA;')) {
      // Segmento de mercado - contém nome do mercado e odds
      const maParts = segment.split(';');
      for (const part of maParts) {
        if (part.startsWith('NA=')) {
          marketName = part.substring(3);
        } else if (part.startsWith('OD=')) {
          oddsValue = part.substring(3);
        }
      }
    } else if (segment.startsWith('TE;')) {
      // Segmento de time (team)
      isTeamLine = true;
      const teParts = segment.split(';');
      for (const part of teParts) {
        if (part.startsWith('NA=')) {
          // Nome do time
          const teamName = part.substring(3);
          // Em linhas de time, normalmente temos apenas um time por linha
          // O contexto (se é time 1 ou 2) vem do ID ou posição
        } else if (part.startsWith('ID=')) {
          // ID do time - pode ajudar a determinar se é time 1 ou 2
          try {
            teamId = parseInt(part.substring(3), 10);
          } catch {
            // Ignora se não for um número válido
          }
        }
      }
    }
  }

  // Retorna os dados extraídos se encontramos algo útil
  if (eventName || homeTeam || awayTeam || marketName || oddsValue) {
    return {
      eventName,
      homeTeam,
      awayTeam,
      marketName,
      oddsValue,
      isTeamLine,
      teamId
    };
  }

  return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping Bet365.
 *
 * Esta implementação foca no parsing de dados capturados previamente
 * (como no bet365_raw.log) em vez de interação direta com o site via browser.
 * Para uso em produção em tempo real, seria necessário adaptar para:
 * 1. Captura de tráfego em tempo real via proxy ou similares
 * 2. Ou uso de APIs oficiais se disponíveis
 * 3. Ou análise de WebSocket/SSE se o site usar essas tecnologias
 */
export async function scrapeBet365(browserContext?: BrowserContext): Promise<ScrapedMatch[]> {
  logger.info('[Bet365] Iniciando processamento de dados capturados...');
  const results: ScrapedMatch[] = [];

  try {
    let content: string;

    if (SIMULATE_FROM_LOG_FILE) {
      // Lê o arquivo de log para simulação/teste
      const fs = await import('fs');
      const path = await import('path');

      const resolvedPath = path.resolve(process.cwd(), LOG_FILE_PATH);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Arquivo de log não encontrado: ${resolvedPath}`);
      }

      content = fs.readFileSync(resolvedPath, 'utf8');
      logger.info(`[Bet365] Carregado arquivo de log: ${resolvedPath}`);
    } else {
      // Em uma implementação real, aqui faríamos a captura em tempo real
      // Por enquanto, vamos simular com dados vazios e logar um aviso
      logger.warn('[Bet365] Modo de captura em tempo real não implementado. Retornando resultados vazios.');
      return [];
    }

    // Processa linha por linha
    const lines = content.split('\n');
    const matches: Map<string, {
      homeTeam: string;
      awayTeam: string;
      dateTime: Date;
      stage: string;
      odds: Map<string, { market: string; odds: number }>
    }> = new Map();

    let currentMatchKey = '';
    let currentHomeTeam = '';
    let currentAwayTeam = '';
    let currentEventName = '';
    let currentDateTime = new Date(); // Valor padrão, seria extraído dos dados reais
    let currentStage = 'Copa do Mundo 2026'; // Valor padrão

    for (const line of lines) {
      const parsed = parseBet365Line(line.trim());
      if (!parsed) continue;

      // Atualiza informações do evento/jogo
      if (parsed.eventName) {
        currentEventName = parsed.eventName;
        // Tentativa de extrair data/hora do nome do evento se disponível
        // Isso seria específico do formato da Bet365
      }

      if (parsed.homeTeam !== undefined && parsed.awayTeam !== undefined) {
        currentHomeTeam = parsed.homeTeam;
        currentAwayTeam = parsed.awayTeam;

        // Cria uma chave única para o jogo
        const normalizedHome = currentHomeTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normalizedAway = currentAwayTeam.toLowerCase().replace(/[^a-z0-9]/g, '');
        currentMatchKey = `${normalizedHome}_vs_${normalizedAway}`;

        // Inicializa entrada para este jogo se ainda não existir
        if (!matches.has(currentMatchKey)) {
          matches.set(currentMatchKey, {
            homeTeam: currentHomeTeam,
            awayTeam: currentAwayTeam,
            dateTime: currentDateTime,
            stage: currentStage,
            odds: new Map()
          });
        }
      }

      // Processa informações de mercado e odds
      if (parsed.marketName && parsed.oddsValue) {
        // Garante que temos um jogo atual para associar o mercado
        if (!currentMatchKey) {
          // Se não temos um jogo definido, usa um padrão ou tenta inferir
          currentMatchKey = 'unknown_match';
          if (!matches.has(currentMatchKey)) {
            matches.set(currentMatchKey, {
              homeTeam: 'Time Desconhecido 1',
              awayTeam: 'Time Desconhecido 2',
              dateTime: new Date(),
              stage: 'Desconhecido',
              odds: new Map()
            });
          }
        }

        const matchData = matches.get(currentMatchKey);
        if (matchData) {
          const marketType = determineMarket(parsed.marketName);
          if (marketType) {
            const decimalOdds = parseFractionalOdds(parsed.oddsValue);
            if (decimalOdds > 1) { // Só aceita odds válidas (> 1.0)
              // Se já existe uma odd para este mercado, mantemos a melhor (menor valor para favoritos, ou simplesmente a primeira encontrada)
              // Em uma implementação mais sofisticada, poderíamos manter todas as odds e deixar o processo de merge decidir
              if (!matchData.odds.has(marketType)) {
                matchData.odds.set(marketType, decimalOdds);
              }
            }
          }
        }
      }
    }

    // Converte o mapa de partidas para o formato de retorno
    for (const [key, match] of matches.entries()) {
      // Converte as odds do mapa para o array de ScrapedOdd
      const oddsArray: ScrapedOdd[] = [];

      for (const [market, oddsValue] of match.odds.entries()) {
        oddsArray.push({
          playerName: '', // Em uma implementação real, extrairíamos os nomes dos jogadores dos dados
          team: '',       // O time seria determinado durante o processo de merge com outros sources
          line: '',       // Linha seria determinada baseado no tipo de mercado
          value: oddsValue,
          house: 'bet365',
          market,
          url: undefined  // URL seria opcional e poderia ser adicionada se disponível
        });
      }

      // Só adiciona partidas que têm pelo menos uma odd válida
      if (oddsArray.length > 0) {
        results.push({
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          dateTime: match.dateTime,
          stage: match.stage,
          odds: oddsArray
        });
      }
    }

    logger.info(`[Bet365] Processamento concluído. ${results.length} jogos com odds válidos encontrados.`);
    return results;

  } catch (error) {
    logger.error('[Bet365] Erro durante o processamento de dados:', { error: String(error) });
    return [];
  }
}