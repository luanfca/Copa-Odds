#!/usr/bin/env node

/**
 * Proxy local do SofaScore usando Chromium real.
 *
 * Reimplementa os endpoints usados pelo Next sem depender de curl/curl_cffi,
 * que recebe 403 nos IPs do Render e GitHub Actions. O próprio Chromium obtém
 * 200 da API oficial e mantém cookies/fingerprint de navegador.
 */

import http from 'node:http';
import { chromium } from 'playwright';

const HOST = process.env.SOFA_HOST || '127.0.0.1';
const PORT = Number(process.env.SOFA_PORT || 54545);
const API = 'https://www.sofascore.com/api/v1';
const PROXY_PREFIX =
  process.env.SOFA_PROXY_PREFIX || 'https://proxy.cors.sh/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

let browserPromise;
let pagePromise;
let proxyMode = process.env.SOFA_FORCE_PROXY === 'true';
const teamIdCache = new Map();
const responseCache = new Map();
const inflight = new Map();

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}

async function ensurePage() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  if (!pagePromise) {
    pagePromise = (async () => {
      const browser = await browserPromise;
      const context = await browser.newContext({
        userAgent: UA,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      });
      const page = await context.newPage();
      const response = await page.goto(`${API}/sport/football/events/live`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      if (!response?.ok()) {
        throw new Error(`SofaScore bootstrap HTTP ${response?.status()}`);
      }
      return page;
    })().catch((error) => {
      pagePromise = undefined;
      throw error;
    });
  }
  return pagePromise;
}

async function proxyGet(path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(PROXY_PREFIX + API + path, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': UA,
        },
      });
      if (response.ok) return await response.json();
      lastError = new Error(`Proxy HTTP ${response.status} em ${path}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError || new Error(`Falha no proxy SofaScore em ${path}`);
}

async function sofaGetFresh(path) {
  if (proxyMode) return proxyGet(path);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const page = await ensurePage();
      const result = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json, text/plain, */*' },
        });
        const text = await response.text();
        return { status: response.status, text };
      }, API + path);
      if (result.status === 200) return JSON.parse(result.text);
      lastError = new Error(`HTTP ${result.status} em ${path}`);
      if (result.status === 403) {
        proxyMode = true;
        return proxyGet(path);
      }
    } catch (error) {
      lastError = error;
      pagePromise = undefined;
      if (/403/.test(String(error))) {
        proxyMode = true;
        return proxyGet(path);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError || new Error(`Falha SofaScore em ${path}`);
}

async function sofaGet(path) {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expires > now) return cached.data;
  if (inflight.has(path)) return inflight.get(path);

  const request = sofaGetFresh(path)
    .then((data) => {
      const ttl = path.includes('/events/live') ? 15_000 : 6 * 60 * 60_000;
      responseCache.set(path, { data, expires: Date.now() + ttl });
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

async function resolveTeamId(teamName) {
  const key = normalize(teamName);
  if (teamIdCache.has(key)) return teamIdCache.get(key);

  const data = await sofaGet(`/search/all?q=${encodeURIComponent(teamName)}`);
  const teams = (data?.results || []).filter(
    (result) =>
      result?.type === 'team' &&
      result?.entity?.sport?.slug === 'football',
  );
  const exact =
    teams.find((result) => namesMatch(result.entity?.name, teamName)) ||
    teams[0];
  const id = exact?.entity?.id || null;
  teamIdCache.set(key, id);
  return id;
}

async function teamEvents(url) {
  const team = url.searchParams.get('team') || '';
  const tournamentId = Number(url.searchParams.get('tournament') || 0);
  const competitionName = url.searchParams.get('competitionName') || '';
  const pages = Math.min(
    Math.max(Number(url.searchParams.get('pages') || 4), 1),
    6,
  );
  const teamId = await resolveTeamId(team);
  if (!teamId) return { events: [] };

  const all = [];
  for (let page = 0; page < pages; page++) {
    const data = await sofaGet(`/team/${teamId}/events/last/${page}`);
    const events = data?.events || [];
    if (!events.length) break;
    all.push(...events);
    if (events.length < 20) break;
  }

  const deduped = Array.from(
    new Map(all.filter((event) => event?.id).map((event) => [event.id, event])).values(),
  );
  const events = deduped.filter((event) => {
    const tournament = event?.tournament?.uniqueTournament;
    if (tournamentId) return tournament?.id === tournamentId;
    if (competitionName) {
      return namesMatch(
        tournament?.name || event?.tournament?.name,
        competitionName,
      );
    }
    return true;
  });
  return { events };
}

async function playerStats(eventId) {
  const [lineups, eventPayload] = await Promise.all([
    sofaGet(`/event/${eventId}/lineups`),
    sofaGet(`/event/${eventId}`),
  ]);
  const event = eventPayload?.event || eventPayload || {};
  const teams = {
    home: event?.homeTeam?.name || 'Home',
    away: event?.awayTeam?.name || 'Away',
  };
  const players = [];

  for (const side of ['home', 'away']) {
    for (const entry of lineups?.[side]?.players || []) {
      const player = entry?.player || {};
      const stats = entry?.statistics || {};
      const minutes = Number(stats.minutesPlayed || 0);
      if (!player.name || minutes <= 0) continue;
      players.push({
        name: player.name || player.shortName || '',
        team: teams[side],
        tackles: Number(stats.totalTackle ?? stats.tackles ?? 0),
        foulsCommitted: Number(stats.fouls ?? 0),
        foulsSuffered: Number(stats.wasFouled ?? 0),
        shots: Number(stats.totalShots ?? 0),
        shotsOnTarget: Number(
          stats.onTargetScoringAttempt ?? stats.shotsOnTarget ?? 0,
        ),
        minutes,
      });
    }
  }
  return { players };
}

async function resolveEvent(url) {
  const home = url.searchParams.get('home') || '';
  const away = url.searchParams.get('away') || '';
  const date = (url.searchParams.get('date') || '').slice(0, 10);

  for (const team of [home, away]) {
    const id = await resolveTeamId(team);
    if (!id) continue;
    for (const page of [0, 1]) {
      const data = await sofaGet(`/team/${id}/events/last/${page}`);
      for (const event of data?.events || []) {
        const samePair =
          (namesMatch(event?.homeTeam?.name, home) &&
            namesMatch(event?.awayTeam?.name, away)) ||
          (namesMatch(event?.homeTeam?.name, away) &&
            namesMatch(event?.awayTeam?.name, home));
        if (!samePair) continue;
        if (
          date &&
          new Date(Number(event.startTimestamp || 0) * 1000)
            .toISOString()
            .slice(0, 10) !== date
        ) {
          continue;
        }
        return { eventId: event.id };
      }
    }
  }

  if (date) {
    const data = await sofaGet(`/sport/football/scheduled-events/${date}`);
    const hit = (data?.events || []).find(
      (event) =>
        (namesMatch(event?.homeTeam?.name, home) &&
          namesMatch(event?.awayTeam?.name, away)) ||
        (namesMatch(event?.homeTeam?.name, away) &&
          namesMatch(event?.awayTeam?.name, home)),
    );
    if (hit) return { eventId: hit.id };
  }
  return { eventId: null };
}

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/health') {
      return send(response, 200, {
        status: 'ok',
        engine: proxyMode ? 'proxy' : 'chromium',
      });
    }
    if (url.pathname === '/live') {
      return send(
        response,
        200,
        await sofaGet('/sport/football/events/live'),
      );
    }
    if (url.pathname === '/team-events') {
      return send(response, 200, await teamEvents(url));
    }
    if (url.pathname === '/player_stats') {
      const eventId = Number(url.searchParams.get('event_id') || 0);
      return send(
        response,
        eventId ? 200 : 400,
        eventId ? await playerStats(eventId) : { players: [] },
      );
    }
    if (url.pathname === '/resolve') {
      return send(response, 200, await resolveEvent(url));
    }

    const eventStats = url.pathname.match(/^\/event\/(\d+)\/stats$/);
    if (eventStats) {
      return send(
        response,
        200,
        await sofaGet(`/event/${eventStats[1]}/statistics`),
      );
    }
    const teamRoute = url.pathname.match(/^\/team\/(\d+)\/events$/);
    if (teamRoute) {
      return send(
        response,
        200,
        await sofaGet(`/team/${teamRoute[1]}/events/last/0`),
      );
    }
    if (
      /^\/event\/\d+(?:\/lineups)?$/.test(url.pathname) ||
      url.pathname.startsWith('/sport/')
    ) {
      return send(response, 200, await sofaGet(url.pathname));
    }

    return send(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(`[SofaChromium] ${url.pathname}:`, String(error));
    return send(response, 502, { error: String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SofaScore Chromium em http://${HOST}:${PORT}`);
});

async function shutdown() {
  server.close();
  const browser = await browserPromise?.catch(() => null);
  await browser?.close().catch(() => null);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
