import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')

BASE = 'http://127.0.0.1:54545'

def name_match_simple(a, b):
    a_tokens = a.lower().split()
    b_tokens = b.lower().split()
    if not a_tokens or not b_tokens:
        return False
    if a.lower() == b.lower():
        return True
    a_last = a_tokens[-1]
    b_last = b_tokens[-1]
    if a_last == b_last:
        if len(a_tokens) == 1 or len(b_tokens) == 1:
            return True
        a_first = a_tokens[0].rstrip('.')
        b_first = b_tokens[0].rstrip('.')
        if a_first == b_first:
            return True
        if len(a_first) == 1 and b_first.startswith(a_first):
            return True
        if len(b_first) == 1 and a_first.startswith(b_first):
            return True
    return False

def sofa_get(path):
    try:
        url = BASE + path
        data = json.loads(urllib.request.urlopen(url, timeout=15).read())
        return data
    except Exception as e:
        print(f'  ERRO: {e}')
        return None

team = 'Bahia'
tournament_id = 325

url = f'/team-events?team={team}&tournament={tournament_id}'
data = sofa_get(url)
events = data.get('events', []) if data else []
print(f'Team events (tournament={tournament_id}): {len(events)}')

bahia_players_db = [
    "C. Olivera", "K. Junior", "A. Veliz", "Everaldo", "W. Jose",
    "Ademir", "Pulga", "M. Sanabria", "R. Nestor", "M. Araujo",
    "M. Victor", "J. Lucas", "E. Carvalho", "E. Ribeiro", "N. Acevedo",
    "Z. Guilherme", "D. Duarte", "R. Mingo", "Fredi", "R. Gomez"
]

for ev in events[:3]:
    eid = ev['id']
    home = ev['homeTeam']['name']
    away = ev['awayTeam']['name']
    print(f'\n--- Evento: {home} x {away} (id={eid}) ---')
    
    stats = sofa_get(f'/player_stats?event_id={eid}')
    players = stats.get('players', []) if stats else []
    
    sofa_names = [p.get('name', '?') for p in players if 'bahia' in (p.get('team', '').lower())]
    print(f'Jogadores SofaScore (Bahia): {sofa_names}')
    
    for db_name in bahia_players_db[:5]:
        found = False
        for sp in players:
            sn = sp.get('name', '')
            if name_match_simple(db_name, sn):
                found = True
                print(f'  DB: {db_name} -> SofaScore: {sn} MATCH')
                break
        if not found:
            print(f'  DB: {db_name} -> NENHUM MATCH')
