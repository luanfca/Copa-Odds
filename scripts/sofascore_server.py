#!/usr/bin/env python3
"""
Mini-servidor HTTP que usa curl_cffi para buscar dados do SofaScore.
O Next.js chama http://localhost:54545/ para obter stats.

Uso:
    pip install curl_cffi flask
    python scripts/sofascore_server.py

Endpoints:
    GET /live                  -> jogos ao vivo
    GET /scheduled/<date>      -> jogos de uma data
    GET /event/<id>/stats      -> estatísticas do jogo
    GET /event/<id>/lineups    -> escalações + stats por jogador
    GET /resolve?home=X&away=Y&date=Z -> resolve eventId
"""

import json
import sys
import os
import unicodedata
from datetime import datetime, timedelta

# Garante que stdout aceite UTF-8 (evita UnicodeEncodeError no Windows)
sys.stdout.reconfigure(encoding='utf-8')

try:
    from flask import Flask, request, jsonify
except ImportError:
    print("Instale flask: pip install flask")
    sys.exit(1)

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    print("Instale curl_cffi: pip install curl_cffi")
    sys.exit(1)

app = Flask(__name__)

BASE_URL = "https://api.sofascore.com/api/v1"
SOFA_WWW = "https://www.sofascore.com"

# ── Proxy de saída (contorna ban de IP do SofaScore) ──────────────────
# Lê de PROXY_URL no ambiente. Credenciais nunca devem ficar no código-fonte.
_ENV_PROXY = os.environ.get("PROXY_URL", "").strip()
PROXY_URL = _ENV_PROXY

# Sessão com impersonation de Chrome + proxy de saída (quando configurado).
PROXY_SESSION = (
    cffi_requests.Session(
        impersonate="chrome120",
        proxies={"https": PROXY_URL, "http": PROXY_URL},
        verify=False,
    )
    if PROXY_URL
    else None
)
# Sessão direta (sem proxy) — fallback quando proxy esgota créditos
DIRECT_SESSION = cffi_requests.Session(
    impersonate="chrome120",
    verify=False,
)
_proxy_ok = PROXY_SESSION is not None

# NOTA: não fazemos teste de conexão aqui — o proxy testa sozinho
# em cada requisição (sofa_get). Testar na inicialização atrasa
# o Flask em até 10s e pode fazer o watchdog reiniciar em loop.


@app.route("/health")
def route_health():
    """Healthcheck local sem depender da disponibilidade do SofaScore."""
    return jsonify({"status": "ok"})


def sofa_get(path, headers=None):
    """GET com retry. Tenta proxy primeiro; se 403, cai para direto."""
    global _proxy_ok
    url = BASE_URL + path
    import time

    for attempt in range(3):
        try:
            extra = {"headers": headers} if headers else {}
            # Escolhe sessão: proxy (se disponível) ou direta
            sess = PROXY_SESSION if _proxy_ok and PROXY_SESSION else DIRECT_SESSION
            resp = sess.get(url, timeout=15, **extra)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 403:
                body_text = resp.text[:200]
                if "exhausted" in body_text.lower() or "credits" in body_text.lower():
                    print(f"[sofa_get] Proxy credits exhausted — switching to direct mode")
                    _proxy_ok = False
                    # Retry imediatamente via direto
                    resp = DIRECT_SESSION.get(url, timeout=15, **extra)
                    if resp.status_code == 200:
                        return resp.json()
                    print(f"[sofa_get] Direct also {resp.status_code} for {path[:60]}")
                    return None
                print(f"[sofa_get] 403 for {path[:60]} — reconectando...")
                try:
                    if PROXY_SESSION:
                        PROXY_SESSION.get(SOFA_WWW, timeout=10)
                except Exception:
                    pass
                time.sleep(1 * (attempt + 1))
                continue
            # Log other non-200 responses
            if resp.status_code != 200:
                print(f"[sofa_get] {resp.status_code} for {path[:60]}")
            return None
        except Exception as e:
            print(f"[sofa_get] exception: {e}")
            time.sleep(0.5)
    return None


# ── Cache de Team IDs (SofaScore) ──────────────────────────────────
# Obtidos via sofascore.com/football/team/{name}/{id}
# Úteis porque a API de search retorna 403
TEAM_ID_CACHE = {
    # Brasileirão Série A (IDs verified from sofascore.com URLs)
    "bahia": 1955,
    "botafogo": 1958,
    "corinthians": 1957,
    "cruzeiro": 1954,
    "flamengo": 5981,
    "fluminense": 1961,
    "gremio": 5926,
    "gremio rs": 5926,
    "internacional": 1966,
    "palmeiras": 1963,
    "santos": 1968,
    "sao paulo": 1981,
    "sao paulo sp": 1981,
    "vasco da gama": 1974,
    "athletico pr": 1967,
    "athletico-paranaense": 1967,
    "coritiba": 1982,
    "bragantino": 1999,
    "red bull bragantino": 1999,
    "chapecoense": 21845,
    "mirassol": 21982,
    "vitoria": 1962,
    "ceara": 2001,
    "sport recife": 1959,
    "goias": 1960,
    "fortaleza": 2020,
    "juventude": 1980,
    "novorizontino": 135514,
    "gremio novorizontino": 135514,
    "atletico mineiro": 1977,
    "atletico mg": 1977,
    "atletico-mg": 1977,
    "cuiaba": 49202,
    "cuiabá": 49202,
    "parana": 15247,
    "remo": 6052,

    # MLS (IDs verified from sofascore.com URLs)
    "atlanta united": 243211,
    "austin fc": 377973,
    "charlotte fc": 404108,
    "charlotte": 404108,
    "chicago fire": 2505,
    "cf montreal": 22006,
    "colorado rapids": 2510,
    "columbus crew": 2504,
    "dc united": 2502,
    "fc cincinnati": 215167,
    "fc dallas": 2512,
    "dallas": 2512,
    "houston dynamo": 2508,
    "houston dynamo fc": 2508,
    "inter miami": 337602,
    "la galaxy": 2513,
    "la fc": 274650,
    "los angeles fc": 274650,
    "minnesota united": 41618,
    "nashville sc": 337612,
    "new england revolution": 2511,
    "new york red bulls": 2506,
    "new york city fc": 187643,
    "orlando city": 52237,
    "philadelphia union": 39833,
    "portland timbers": 22007,
    "real salt lake": 5133,
    "san diego fc": 1043961,
    "san diego": 1043961,
    "san jose earthquakes": 21825,
    "seattle sounders": 22009,
    "sporting kansas city": 2509,
    "sporting kc": 2509,
    "st. louis city": 407803,
    "st louis city": 407803,
    "saint louis city": 407803,
    "toronto fc": 7080,
    "vancouver whitecaps": 22010,
}

def resolve_team_id(team_name):
    """Encontra o SofaScore team ID pelo nome."""
    key = normalize(team_name)
    # Tenta match exato primeiro
    if key in TEAM_ID_CACHE:
        return TEAM_ID_CACHE[key]
    # Tenta match parcial (ex.: "sao paulo" em vez de "sao paulo sp")
    for cache_key, team_id in TEAM_ID_CACHE.items():
        if key in cache_key or cache_key in key:
            return team_id
    # Tenta match com palavras-chave
    key_parts = set(key.split())
    for cache_key, team_id in TEAM_ID_CACHE.items():
        cache_parts = set(cache_key.split())
        if key_parts & cache_parts:  # intersecção não vazia
            return team_id
    return None


# ── Team name matching ──────────────────────────────────────────────

def normalize(s):
    """Normaliza: lower case, strip, remove acentos."""
    s = (s or "").lower().strip()
    # Decompose Unicode e remove combining marks (acentos)
    s = unicodedata.normalize('NFKD', s)
    s = s.encode('ascii', 'ignore').decode('ascii')
    return s

TEAM_PT_EN = {
    "brasil": "brazil", "franca": "france", "alemanha": "germany",
    "espanha": "spain", "inglaterra": "england", "italia": "italy",
    "marrocos": "morocco", "argentina": "argentina", "portugal": "portugal",
    "holanda": "netherlands", "croacia": "croatia", "belgica": "belgium",
    "mexico": "mexico", "japao": "japan", "coreia do sul": "south korea",
    "uruguai": "uruguay", "colombia": "colombia", "suica": "switzerland",
    "dinamarca": "denmark", "servia": "serbia", "polonia": "poland",
    "senegal": "senegal", "canada": "canada", "equador": "ecuador",
    "catar": "qatar", "gana": "ghana", "camaroes": "cameroon",
    "tunisia": "tunisia", "australia": "australia", "noruega": "norway",
    "irlanda": "ireland", "escocia": "scotland", "gales": "wales",
    "turquia": "turkiye", "nova zelandia": "new zealand",
    "paraguai": "paraguay", "peru": "peru", "costa rica": "costa rica",
    "egito": "egypt", "arabia saudita": "saudi arabia",
    "estados unidos": "usa", "paises baixos": "netherlands",
    "pais de gales": "wales",
}


def team_matches(event_name, our_name):
    e = normalize(event_name)
    o = normalize(our_name)
    if not e or not o:
        return False
    if e == o:
        return True
    oen = TEAM_PT_EN.get(o)
    if oen and (e == oen or oen in e or e in oen):
        return True
    if e in o or o in e:
        return True
    return False


# ── Routes ──────────────────────────────────────────────────────────

@app.route("/live")
def route_live():
    data = sofa_get("/sport/football/events/live")
    return jsonify(data or {"events": []})


@app.route("/scheduled/<date>")
def route_scheduled(date):
    # Tenta múltiplos paths da API do SofaScore (o path mudou ao longo do tempo)
    paths = [
        f"/sport/football/scheduled-events/{date}",
        f"/sport/football/events/{date}",
        f"/sport/football/events/{date}/scheduled",
    ]
    for path in paths:
        data = sofa_get(path)
        if data and data.get("events"):
            return jsonify(data)
    return jsonify({"events": []})


@app.route("/event/<int:event_id>/stats")
def route_stats(event_id):
    data = sofa_get(f"/event/{event_id}/statistics")
    return jsonify(data or {})


@app.route("/event/<int:event_id>/lineups")
def route_lineups(event_id):
    data = sofa_get(f"/event/{event_id}/lineups")
    return jsonify(data or {})


@app.route("/event/<int:event_id>")
def route_event(event_id):
    data = sofa_get(f"/event/{event_id}")
    return jsonify(data or {})


@app.route("/team/<int:team_id>/events")
def route_team_events(team_id):
    """Últimos eventos de um time (endpoint confirmado via browser)."""
    data = sofa_get(f"/team/{team_id}/events/last/0")
    return jsonify(data or {"events": []})


@app.route("/team-events")
def route_team_events_by_name():
    """Últimos eventos de um time pelo nome (resolve ID automaticamente).
    
    Query params:
        team (obrigatório): nome do time
        competitionName (opcional): nome do torneio para filtrar (ex: "Brasileirão Série A")
        tournament (opcional): ID do torneio (uniqueTournament.id) para filtrar
    """
    team = request.args.get("team", "")
    if not team:
        return jsonify({"events": []})
    tid = resolve_team_id(team)
    if not tid:
        print(f"[team-events] Team not found in cache: {team}")
        return jsonify({"events": []})
    
    competition_name = request.args.get("competitionName")  
    tournament_id = request.args.get("tournament", type=int)
    
    print(f"[team-events] {team} -> id={tid}" + (f" (filter: tourn={competition_name or tournament_id})" if competition_name or tournament_id else ""))
    
    # Fetch multiple pages to get enough events (default 1 page = ~20 events, fetch up to 4 pages)
    pages = int(request.args.get("pages", 4))
    all_events = []
    for page in range(pages):
        data = sofa_get(f"/team/{tid}/events/last/{page}")
        events_page = (data or {}).get("events", [])
        if not events_page:
            break
        all_events.extend(events_page)
        # If we got fewer than expected, no more pages
        if len(events_page) < 20:
            break
    
    if not all_events:
        print(f"[team-events DEBUG] {team}: Nenhum evento retornado da API SofaScore")
        return jsonify({"events": []})
    
    # Deduplicate events by ID (pages may overlap)
    seen_ids = set()
    deduped = []
    for ev in all_events:
        eid = ev.get("id")
        if eid and eid not in seen_ids:
            seen_ids.add(eid)
            deduped.append(ev)
    events = deduped
    print(f"[team-events DEBUG] {team}: {len(events)} eventos brutos da API ({pages} pages, deduped from {len(all_events)})")
    
    # Loga todos os torneios encontrados antes do filtro
    tournaments_before = {}
    for ev in events:
        tid_evt = ev.get("tournament", {}).get("uniqueTournament", {})
        t_name = tid_evt.get("name", ev.get("tournament", {}).get("name", "?"))
        t_id = tid_evt.get("id", "?")
        key = f"{t_name} (id={t_id})"
        tournaments_before[key] = tournaments_before.get(key, 0) + 1
    print(f"[team-events DEBUG] {team}: Torneios ANTES do filtro: {tournaments_before}")
    
    events_before_count = len(events)
    
    # Filtro por ID do torneio (exato, mais confiável)
    if tournament_id:
        print(f"[team-events DEBUG] {team}: Filtrando por tournament_id={tournament_id}")
        events = [
            ev for ev in events
            if ev.get("tournament", {}).get("uniqueTournament", {}).get("id") == tournament_id
        ]
    # Filtro por nome do torneio (fallback quando ID não disponível)
    elif competition_name:
        cn = normalize(competition_name)
        print(f"[team-events DEBUG] {team}: Filtrando por competition_name='{competition_name}' (normalized='{cn}')")
        events = [
            ev for ev in events
            if cn in normalize(ev.get("tournament", {}).get("name", ""))
            or cn in normalize(ev.get("tournament", {}).get("uniqueTournament", {}).get("name", ""))
        ]
    
    print(f"[team-events DEBUG] {team}: {events_before_count} -> {len(events)} eventos depois do filtro")
    
    # Loga os torneios que passaram no filtro
    if events:
        tournaments_after = {}
        for ev in events:
            tid_evt = ev.get("tournament", {}).get("uniqueTournament", {})
            t_name = tid_evt.get("name", ev.get("tournament", {}).get("name", "?"))
            t_id = tid_evt.get("id", "?")
            key = f"{t_name} (id={t_id})"
            tournaments_after[key] = tournaments_after.get(key, 0) + 1
        print(f"[team-events DEBUG] {team}: Torneios DEPOIS do filtro: {tournaments_after}")
    
    return jsonify({"events": events})


@app.route("/resolve")
def route_resolve():
    """Resolve eventId por nomes dos times + data.
    
    Estratégia:
    1. Live events (mais rápido)
    2. Team events search (via /team/{id}/events/last/0 — confirmado funcionando)
    3. Scheduled-events (pode estar bloqueado)
    """
    home = request.args.get("home", "")
    away = request.args.get("away", "")
    date_str = request.args.get("date", "")

    # 1. Tenta jogos ao vivo
    live_data = sofa_get("/sport/football/events/live")
    for ev in (live_data or {}).get("events", []):
        eh = ev.get("homeTeam", {}).get("name", "")
        ea = ev.get("awayTeam", {}).get("name", "")
        eid = ev.get("id")
        if not eid:
            continue
        if (team_matches(eh, home) and team_matches(ea, away)) or \
           (team_matches(eh, away) and team_matches(ea, home)):
            return jsonify({"eventId": eid})

    # 2. Team ID cache (rápido, sem chamadas de API desnecessárias)
    # Usa cache de team IDs conhecidos + /team/{id}/events/last/0
    match_date = date_str[:10] if date_str else ""
    
    def find_in_team_events(tname):
        tid = resolve_team_id(tname)
        if not tid:
            return None
        print(f"[resolve] Cache: {tname} -> id={tid}")
        tdata = sofa_get(f"/team/{tid}/events/last/0")
        if not tdata or not tdata.get("events"):
            return None
        for ev in tdata["events"]:
            eh = ev.get("homeTeam", {}).get("name", "")
            ea = ev.get("awayTeam", {}).get("name", "")
            eid = ev.get("id")
            if not eid:
                continue
            if (team_matches(eh, home) and team_matches(ea, away)) or \
               (team_matches(eh, away) and team_matches(ea, home)):
                if match_date:
                    ts = ev.get("startTimestamp", 0)
                    if ts:
                        evd = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                        if evd != match_date:
                            # Pode ser diferença de fuso horário — tenta sem filtro de data
                            # na próxima iteração do time oponente
                            continue
                print(f"[resolve] ✅ {home} vs {away} -> eventId={eid} (cache)")
                return eid
        return None
    
    for tn in [home, away]:
        if tn:
            eid = find_in_team_events(tn)
            if eid:
                return jsonify({"eventId": eid})

    # 3. Fallback: scheduled-events
    if date_str:
        base = datetime.strptime(date_str[:10], "%Y-%m-%d")
        paths = [
            "/sport/football/scheduled-events/{d}",
            "/sport/football/events/{d}",
        ]
        for off in range(-7, 8):
            d = (base + timedelta(days=off)).strftime("%Y-%m-%d")
            for ev_path in paths:
                sched = sofa_get(ev_path.format(d=d))
                if sched and sched.get("events"):
                    for ev in sched["events"]:
                        eh = ev.get("homeTeam", {}).get("name", "")
                        ea = ev.get("awayTeam", {}).get("name", "")
                        eid = ev.get("id")
                        if not eid:
                            continue
                        if (team_matches(eh, home) and team_matches(ea, away)) or \
                           (team_matches(eh, away) and team_matches(ea, home)):
                            print(f"[resolve] {home} vs {away} -> eventId={eid} (scheduled)")
                            return jsonify({"eventId": eid})
                    break

    print(f"[resolve] {home} vs {away} ({date_str[:10]}) -> NOT FOUND")
    return jsonify({"eventId": None})


@app.route("/player_stats")
def route_player_stats():
    """Busca stats por jogador de um jogo via lineups."""
    event_id = request.args.get("event_id", type=int)
    if not event_id:
        return jsonify({"players": []})

    lineups = sofa_get(f"/event/{event_id}/lineups") or {}
    event = sofa_get(f"/event/{event_id}") or {}
    ev = event.get("event", event)
    home_name = ev.get("homeTeam", {}).get("name", "Home")
    away_name = ev.get("awayTeam", {}).get("name", "Away")

    players = []
    for side, team_name in [("home", home_name), ("away", away_name)]:
        team_data = lineups.get(side, {})
        for entry in team_data.get("players", []):
            p = entry.get("player", {})
            s = entry.get("statistics", {})
            if not s:
                continue
            minutes = s.get("minutesPlayed", 0) or 0
            if minutes <= 0:
                continue
            # SofaScore lineups usam totalShots + onTargetScoringAttempt
            # (shotsOnTarget existe em outros endpoints de time, não no jogador).
            shots = s.get("totalShots", 0) or 0
            shots_on = (
                s.get("onTargetScoringAttempt")
                or s.get("shotsOnTarget")
                or s.get("onTarget")
                or 0
            )
            players.append({
                "name": p.get("name", p.get("shortName", "")),
                "team": team_name,
                "tackles": s.get("tackles", s.get("totalTackle", 0)) or 0,
                "foulsCommitted": s.get("fouls", 0) or 0,
                "foulsSuffered": s.get("wasFouled", 0) or 0,
                "shots": shots,
                "shotsOnTarget": shots_on,
                "minutes": minutes,
            })

    # Log: mostra chaves disponíveis do primeiro jogador para debug
    if players:
        first_stats = None
        for side in ["home", "away"]:
            team_data = lineups.get(side, {})
            for entry in team_data.get("players", []):
                s = entry.get("statistics", {})
                if s:
                    first_stats = s
                    break
            if first_stats:
                break
        if first_stats:
            print(f"[player_stats] event={event_id} players={len(players)} stat_keys={list(first_stats.keys())[:15]}")

    return jsonify({"players": players})


if __name__ == "__main__":
    host = os.environ.get("SOFA_HOST", "127.0.0.1")
    port = int(os.environ.get("SOFA_PORT", "54545"))
    print(f"Sofascore Server rodando em http://{host}:{port}")
    print("Endpoints: /live, /resolve, /player_stats, /event/<id>/lineups")
    print("Stats: tackles, foulsCommitted, foulsSuffered, SHOTS, SHOTS_ON_TARGET")
    app.run(host=host, port=port, debug=False)
