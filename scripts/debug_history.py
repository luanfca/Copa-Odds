"""
Script de debug para testar toda a cadeia de filtragem de histórico por competição.

Uso:
  python scripts/debug_history.py                     # Testa todos os times de um jogo do Brasileirão
  python scripts/debug_history.py --team "Flamengo"  # Testa só o Flamengo
  python scripts/debug_history.py --competition brasileirao  # Testa outra competição

Requer o servidor Python rodando: python scripts/sofascore_server.py
"""

import argparse
import json
import sys
import urllib.request
import urllib.parse
import unicodedata

SOFA_SERVER = "http://127.0.0.1:54545"

# ── IDs das competições (mesmo do COMPETITIONS no TypeScript) ──────────
COMPETITIONS = {
    "copa":              {"idSofaScore": 1,    "name": "Copa do Mundo"},
    "brasileirao":       {"idSofaScore": 325,  "name": "Brasileirão Série A"},
    "serieb":            {"idSofaScore": 390,  "name": "Brasileirão Série B"},
    "mls":               {"idSofaScore": 1509, "name": "Major League Soccer"},
    "premier_league":    {"idSofaScore": 17,   "name": "Premier League"},
    "la_liga":           {"idSofaScore": 8,    "name": "La Liga"},
    "serie_a":           {"idSofaScore": 23,   "name": "Serie A"},
    "bundesliga":        {"idSofaScore": 35,   "name": "Bundesliga"},
    "ligue_1":           {"idSofaScore": 34,   "name": "Ligue 1"},
    "champions_league":  {"idSofaScore": 7,    "name": "Champions League"},
}


def normalize(s):
    s = (s or "").lower().strip()
    s = unicodedata.normalize('NFKD', s)
    s = s.encode('ascii', 'ignore').decode('ascii')
    return s


def sofa_get(path):
    url = SOFA_SERVER + path
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  ERRO ao buscar {url}: {e}")
        return None


def test_server_connection():
    """1. Testa se o servidor Python está rodando."""
    print("=" * 70)
    print("1. TESTANDO CONEXÃO COM SERVIDOR PYTHON")
    print("=" * 70)
    data = sofa_get("/live")
    if data is None:
        print("  ❌ Servidor Python NÃO está rodando em", SOFA_SERVER)
        print("  → Execute: python scripts/sofascore_server.py")
        sys.exit(1)
    print("  ✅ Servidor Python rodando OK")
    return True


def test_team_events(team_name, tournament_id=None, competition_name=None):
    """2. Busca eventos do time e mostra torneios encontrados."""
    print()
    print("=" * 70)
    label = f"team='{team_name}'"
    if tournament_id:
        label += f", tournament_id={tournament_id}"
    if competition_name:
        label += f", competition_name='{competition_name}'"
    print(f"2. TESTANDO /team-events  ({label})")
    print("=" * 70)

    params = {"team": team_name}
    if tournament_id:
        params["tournament"] = str(tournament_id)
    if competition_name:
        params["competitionName"] = competition_name

    qs = urllib.parse.urlencode(params)
    data = sofa_get(f"/team-events?{qs}")

    if data is None or not data.get("events"):
        print("  ⚠️ Nenhum evento retornado")
        return []

    events = data["events"]
    print(f"  📊 Total de eventos retornados: {len(events)}")

    # Agrupa por torneio
    tournaments = {}
    for ev in events:
        t = ev.get("tournament", {})
        ut = t.get("uniqueTournament", {})
        t_name = ut.get("name", t.get("name", "?"))
        t_id = ut.get("id", "?")
        key = f"{t_name} (id={t_id})"
        tournaments[key] = tournaments.get(key, 0) + 1

    print("  🏆 Torneios encontrados:")
    for t, count in sorted(tournaments.items(), key=lambda x: -x[1]):
        print(f"     • {t}: {count} jogos")

    return events


def test_filter_by_tournament_id(team_name, tournament_id):
    """3. Testa filtro por tournament_id e compara com o que o Python retorna."""
    print()
    print("=" * 70)
    print(f"3. TESTANDO FILTRO POR tournament_id={tournament_id} ({team_name})")
    print("=" * 70)

    # Busca SEM filtro
    params_no_filter = urllib.parse.urlencode({"team": team_name})
    data_no_filter = sofa_get(f"/team-events?{params_no_filter}")
    events_no_filter = (data_no_filter or {}).get("events", [])

    # Busca COM filtro
    params_with_filter = urllib.parse.urlencode({"team": team_name, "tournament": str(tournament_id)})
    data_with_filter = sofa_get(f"/team-events?{params_with_filter}")
    events_with_filter = (data_with_filter or {}).get("events", [])

    print(f"  Sem filtro:     {len(events_no_filter)} eventos")
    print(f"  Com filtro:     {len(events_with_filter)} eventos")

    # Verifica se algum evento passou no filtro NÃO deveria ter passado
    wrong = []
    for ev in events_with_filter:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        if t.get("id") != tournament_id:
            wrong.append(ev)

    if wrong:
        print(f"  ❌ PROBLEMA: {len(wrong)} eventos passaram no filtro MAS NÃO são do tournament_id={tournament_id}:")
        for ev in wrong[:5]:
            t = ev.get("tournament", {}).get("uniqueTournament", {})
            print(f"     → {ev.get('homeTeam',{}).get('name','?')} x {ev.get('awayTeam',{}).get('name','?')} | torneio={t.get('name','?')} (id={t.get('id','?')})")
    else:
        print(f"  ✅ Filtro do Python está correto: todos os {len(events_with_filter)} eventos são do torneio {tournament_id}")

    # Verifica eventos SEM filtro que NÃO são do torneio alvo (mostra a dispersão)
    non_target = []
    for ev in events_no_filter:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        if t.get("id") != tournament_id:
            non_target.append(ev)

    if non_target:
        print(f"  ⚠️ {len(non_target)} eventos de OUTROS torneios (sem filtro):")
        other_tournaments = {}
        for ev in non_target:
            t = ev.get("tournament", {}).get("uniqueTournament", {})
            t_name = t.get("name", ev.get("tournament", {}).get("name", "?"))
            t_id = t.get("id", "?")
            key = f"{t_name} (id={t_id})"
            other_tournaments[key] = other_tournaments.get(key, 0) + 1
        for t, count in sorted(other_tournaments.items(), key=lambda x: -x[1]):
            print(f"     • {t}: {count} jogos")

    return events_with_filter


def test_client_side_filter(events, tournament_id, competition_name):
    """4. Simula o filtro client-side do getPlayerHistory (TypeScript)."""
    print()
    print("=" * 70)
    print(f"4. SIMULANDO FILTRO CLIENT-SIDE (getPlayerHistory)")
    print(f"   tournament_id={tournament_id}, competition_name='{competition_name}'")
    print("=" * 70)

    filtered = []
    for ev in events:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        ev_tournament_id = t.get("id", 0)
        ev_tournament_name = t.get("name", ev.get("tournament", {}).get("name", ""))

        by_id = tournament_id is not None and ev_tournament_id == tournament_id
        by_name = False
        if competition_name:
            by_name = competition_name.lower() in ev_tournament_name.lower()

        if by_id or by_name:
            filtered.append(ev)

    print(f"  Eventos antes:  {len(events)}")
    print(f"  Eventos depois: {len(filtered)}")

    wrong = []
    for ev in filtered:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        ev_tournament_id = t.get("id", 0)
        ev_tournament_name = t.get("name", "")
        if tournament_id and ev_tournament_id != tournament_id:
            if not (competition_name and competition_name.lower() in ev_tournament_name.lower()):
                wrong.append(ev)

    if wrong:
        print(f"  ❌ PROBLEMA: {len(wrong)} eventos passaram no filtro client-side indevidamente:")
        for ev in wrong[:5]:
            t = ev.get("tournament", {}).get("uniqueTournament", {})
            print(f"     → {ev.get('homeTeam',{}).get('name','?')} x {ev.get('awayTeam',{}).get('name','?')} | torneio={t.get('name','?')} (id={t.get('id','?')})")
    else:
        print(f"  ✅ Filtro client-side OK")

    return filtered


def test_tournament_id_matches(team_name):
    """5. Verifica se os IDs das competições no TypeScript batem com o SofaScore."""
    print()
    print("=" * 70)
    print(f"5. VERIFICANDO SE OS IDs DAS COMPETIÇÕES BATEM COM O SOFASCORE ({team_name})")
    print("=" * 70)

    # Busca eventos sem filtro
    params = urllib.parse.urlencode({"team": team_name})
    data = sofa_get(f"/team-events?{params}")
    events = (data or {}).get("events", [])

    if not events:
        print("  ⚠️ Nenhum evento retornado")
        return

    # Coleta todos os torneios que aparecem
    sofa_tournaments = {}
    for ev in events:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        t_id = t.get("id")
        t_name = t.get("name", ev.get("tournament", {}).get("name", "?"))
        if t_id and t_id not in sofa_tournaments:
            sofa_tournaments[t_id] = t_name

    print("  Torneios no SofaScore (para este time):")
    for t_id, t_name in sorted(sofa_tournaments.items()):
        print(f"     id={t_id}: {t_name}")

    print()
    print("  Comparando com COMPETITIONS do TypeScript:")
    for key, comp in COMPETITIONS.items():
        sofa_id = comp["idSofaScore"]
        if sofa_id in sofa_tournaments:
            match_str = "✅" if sofa_tournaments[sofa_id] else "❌"
            print(f"     {key:20s} → idSofaScore={sofa_id:8d} → SofaScore diz: '{sofa_tournaments[sofa_id]}' {match_str}")
        else:
            print(f"     {key:20s} → idSofaScore={sofa_id:8d} → ⚠️ NÃO encontrado nos eventos deste time")


def test_full_chain(team_name, competition_key):
    """6. Teste completo: simula o que o Next.js faz."""
    print()
    print("=" * 70)
    print(f"6. TESTE COMPLETO DA CADEIA: team='{team_name}', competition='{competition_key}'")
    print("=" * 70)

    comp = COMPETITIONS.get(competition_key)
    if not comp:
        print(f"  ❌ Competição '{competition_key}' não encontrada")
        return

    tournament_id = comp.get("idSofaScore")
    competition_name = comp["name"]

    print(f"  Config: tournament_id={tournament_id}, competition_name='{competition_name}'")

    # Passo 1: Busca SEM filtro
    params = urllib.parse.urlencode({"team": team_name})
    data_all = sofa_get(f"/team-events?{params}")
    events_all = (data_all or {}).get("events", [])

    # Passo 2: Busca COM filtro (como o Next.js faz)
    params_filtered = urllib.parse.urlencode({"team": team_name, "tournament": str(tournament_id)})
    data_filtered = sofa_get(f"/team-events?{params_filtered}")
    events_filtered = (data_filtered or {}).get("events", [])

    print(f"\n  Passo 1 - SofaScore bruto:          {len(events_all)} eventos")
    print(f"  Passo 2 - Filtro Python (tournament={tournament_id}): {len(events_filtered)} eventos")

    # Passo 3: Filtro client-side (simula JS)
    client_filtered = []
    for ev in events_filtered:
        t = ev.get("tournament", {}).get("uniqueTournament", {})
        ev_tid = t.get("id", 0)
        ev_tname = t.get("name", "")
        by_id = tournament_id is not None and ev_tid == tournament_id
        by_name = competition_name.lower() in ev_tname.lower()
        if by_id or by_name:
            client_filtered.append(ev)

    print(f"  Passo 3 - Filtro client-side:       {len(client_filtered)} eventos")

    # Passo 4: Mostra os 5 jogos mais recentes
    finished = [e for e in client_filtered if e.get("startTimestamp", 0) > 0]
    finished.sort(key=lambda e: e.get("startTimestamp", 0), reverse=True)
    top5 = finished[:5]

    print(f"\n  📋 Últimos 5 jogos na competição '{competition_name}':")
    if not top5:
        print("     ⚠️ NENHUM JOGO ENCONTRADO")
    else:
        for i, ev in enumerate(top5, 1):
            home = ev.get("homeTeam", {}).get("name", "?")
            away = ev.get("awayTeam", {}).get("name", "?")
            ts = ev.get("startTimestamp", 0)
            from datetime import datetime
            date = datetime.fromtimestamp(ts).strftime("%d/%m/%Y") if ts else "?"
            t = ev.get("tournament", {}).get("uniqueTournament", {})
            print(f"     {i}. {date} | {home} x {away} | {t.get('name','?')} (id={t.get('id','?')})")

    # Passo 5: Verifica se algum jogo não é da competição correta
    wrong = [e for e in client_filtered if e.get("startTimestamp", 0) > 0]
    wrong = [e for e in wrong if e.get("tournament", {}).get("uniqueTournament", {}).get("id") != tournament_id]

    print()
    if wrong:
        print(f"  ❌ PROBLEMA DETECTADO: {len(wrong)} jogos de OUTRAS competições passaram pelo filtro!")
        for ev in wrong[:5]:
            t = ev.get("tournament", {}).get("uniqueTournament", {})
            home = ev.get("homeTeam", {}).get("name", "?")
            away = ev.get("awayTeam", {}).get("name", "?")
            print(f"     → {home} x {away} | {t.get('name','?')} (id={t.get('id','?')})")
        print()
        print("  DIAGNÓSTICO: O problema está na cadeia de filtros.")
        print("  Verifique os logs acima para entender onde o filtro falha.")
    else:
        print(f"  ✅ Todos os {len(client_filtered)} jogos filtrados são da competição correta.")
        print(f"  Se o histórico ainda mostra jogos errados, o problema pode estar:")
        print(f"     a) Cache antigo (reinicie o Next.js)")
        print(f"     b) competition errada no banco (SELECT competition FROM matches)")


def main():
    parser = argparse.ArgumentParser(description="Debug de histórico por competição")
    parser.add_argument("--team", default="Flamengo", help="Nome do time (default: Flamengo)")
    parser.add_argument("--competition", default="brasileirao", choices=list(COMPETITIONS.keys()),
                        help="Competição (default: brasileirao)")
    args = parser.parse_args()

    team = args.team
    comp_key = args.competition
    comp = COMPETITIONS[comp_key]

    print()
    print("🔍 DEBUG DE HISTÓRICO POR COMPETIÇÃO")
    print(f"   Time: {team}")
    print(f"   Competição: {comp_key} (name='{comp['name']}', idSofaScore={comp['idSofaScore']})")
    print()

    # 1. Conexão
    test_server_connection()

    # 2. Eventos sem filtro
    test_team_events(team)

    # 3. Eventos com filtro
    test_team_events(team, tournament_id=comp["idSofaScore"])

    # 4. Filtro por tournament_id
    test_filter_by_tournament_id(team, comp["idSofaScore"])

    # 5. Verificar se IDs batem
    test_tournament_id_matches(team)

    # 6. Teste completo da cadeia
    test_full_chain(team, comp_key)

    print()
    print("=" * 70)
    print("DEBUG COMPLETO")
    print("=" * 70)


if __name__ == "__main__":
    main()
