"""
FotMob per-player tackle (desarmes) scraper.
Loads the match page via nodriver, extracts __NEXT_DATA__ embedded JSON,
and returns per-player tackle counts.
"""
import asyncio
import json
import sys
import io
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


async def get_match_tackles(match_id: str) -> dict:
    import nodriver as uc

    browser = await uc.start(headless=True)
    try:
        page = await browser.get(f'https://www.fotmob.com/match/{match_id}')
        await asyncio.sleep(8)

        next_data_raw = await page.evaluate('''
            (() => {
                const el = document.getElementById('__NEXT_DATA__');
                if (!el) return null;
                return el.textContent;
            })()
        ''')

        if not next_data_raw:
            return {"error": "No __NEXT_DATA__ found on page"}

        next_data = json.loads(next_data_raw)
        page_props = next_data.get('props', {}).get('pageProps', {})

        general = page_props.get('general', {})
        home_team = general.get('homeTeam', {})
        away_team = general.get('awayTeam', {})

        player_stats = page_props.get('content', {}).get('playerStats', {})

        home_id = home_team.get('id')
        away_id = away_team.get('id')

        results = {
            "matchId": match_id,
            "homeTeam": home_team.get('name', ''),
            "homeTeamId": home_id,
            "awayTeam": away_team.get('name', ''),
            "awayTeamId": away_id,
            "players": {}
        }

        for pid, pdata in player_stats.items():
            name = pdata.get('name', '')
            team_name = pdata.get('teamName', '')
            team_id = pdata.get('teamId')
            is_gk = pdata.get('isGoalkeeper', False)
            stat_groups = pdata.get('stats', [])

            tackles = None
            interceptions = None
            minutes = None
            rating = None

            for sg in stat_groups:
                stats_dict = sg.get('stats', {})
                if 'Tackles' in stats_dict:
                    tackle_stat = stats_dict['Tackles']
                    if 'stat' in tackle_stat:
                        tackles = tackle_stat['stat'].get('value')
                if 'Interceptions' in stats_dict:
                    int_stat = stats_dict['Interceptions']
                    if 'stat' in int_stat:
                        interceptions = int_stat['stat'].get('value')
                if 'Minutes played' in stats_dict:
                    min_stat = stats_dict['Minutes played']
                    if 'stat' in min_stat:
                        minutes = min_stat['stat'].get('value')
                if 'FotMob rating' in stats_dict:
                    rat_stat = stats_dict['FotMob rating']
                    if 'stat' in rat_stat:
                        rating = rat_stat['stat'].get('value')

            if tackles is not None or not is_gk:
                results["players"][pid] = {
                    "name": name,
                    "team": team_name,
                    "teamId": team_id,
                    "isGoalkeeper": is_gk,
                    "minutes": minutes,
                    "rating": rating,
                    "tackles": tackles,
                    "interceptions": interceptions
                }

        return results

    finally:
        browser.stop()


def print_tackle_table(data: dict):
    print(f"\n{'='*65}")
    print(f"  {data['homeTeam']} vs {data['awayTeam']} - Match ID: {data['matchId']}")
    print(f"{'='*65}")

    for team_id, team_label in [(data['homeTeamId'], data['homeTeam']), (data['awayTeamId'], data['awayTeam'])]:
        players = [p for p in data['players'].values() if p.get('teamId') == team_id]
        players.sort(key=lambda x: x.get('tackles') or 0, reverse=True)

        print(f"\n  {team_label}:")
        print(f"  {'Player':<25} {'Min':>4} {'Tkl':>4} {'Int':>4} {'Rtg':>5}")
        print(f"  {'-'*42}")
        for p in players:
            min_str = str(p['minutes']) if p['minutes'] else '-'
            tkl_str = str(p['tackles']) if p['tackles'] is not None else '-'
            int_str = str(p['interceptions']) if p['interceptions'] is not None else '-'
            rtg_str = f"{p['rating']:.1f}" if p['rating'] else '-'
            marker = ' (GK)' if p['isGoalkeeper'] else ''
            print(f"  {p['name']:<25} {min_str:>4} {tkl_str:>4} {int_str:>4} {rtg_str:>5}{marker}")

    total_home = sum(p.get('tackles') or 0 for p in data['players'].values() if p.get('teamId') == data['homeTeamId'])
    total_away = sum(p.get('tackles') or 0 for p in data['players'].values() if p.get('teamId') == data['awayTeamId'])
    print(f"\n  Total Tackles: {data['homeTeam']} {total_home} - {total_away} {data['awayTeam']}")


async def main():
    parser = argparse.ArgumentParser(description='FotMob per-player tackle scraper')
    parser.add_argument('--match-id', default='4667777', help='FotMob match ID')
    parser.add_argument('--json', action='store_true', help='Output raw JSON')
    args = parser.parse_args()

    data = await get_match_tackles(args.match_id)

    if 'error' in data:
        print(f"Error: {data['error']}")
        return

    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print_tackle_table(data)

    with open('tackle_results.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\nRaw data saved to tackle_results.json")


if __name__ == '__main__':
    asyncio.run(main())
