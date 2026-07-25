import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

# Pega eventos do Bahia
url = 'http://127.0.0.1:54545/team-events?team=Bahia&tournament=325'
data = json.loads(urllib.request.urlopen(url).read())
events = data.get('events', [])
print(f'Total eventos Brasileirao: {len(events)}')

if events:
    ev = events[0]
    eid = ev['id']
    home = ev['homeTeam']['name']
    away = ev['awayTeam']['name']
    print(f'Evento: {home} x {away} (id={eid})')
    
    stats_url = f'http://127.0.0.1:54545/player_stats?event_id={eid}'
    stats_data = json.loads(urllib.request.urlopen(stats_url).read())
    players = stats_data.get('players', [])
    print(f'Total jogadores: {len(players)}')
    
    teams = set(p.get('team', '') for p in players)
    print(f'Times encontrados: {teams}')
    
    for p in players[:20]:
        name = p.get('name', '?')
        team = p.get('team', '?')
        mins = p.get('minutes', 0)
        tackles = p.get('tackles', 0)
        print(f'  {name} | team={team} | min={mins} | tackles={tackles}')
else:
    print('Nenhum evento encontrado')
