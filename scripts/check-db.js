const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const m = await p.match.count();
  const pl = await p.player.count();
  const s = await p.oddSnapshot.count();
  console.log('Matches:', m, 'Players:', pl, 'Snapshots:', s);

  const recent = await p.match.findMany({
    select: { homeTeam: true, awayTeam: true, dateTime: true, competition: true },
    orderBy: { dateTime: 'desc' },
    take: 20
  });
  console.log('\nRecent 20 matches:');
  recent.forEach(m => console.log(' ', m.homeTeam, 'vs', m.awayTeam, '|', m.dateTime, '|', m.competition));

  const palHome = await p.match.findMany({ where: { homeTeam: { contains: 'Palmeiras' } }, select: { homeTeam: true, awayTeam: true, dateTime: true, competition: true } });
  const palAway = await p.match.findMany({ where: { awayTeam: { contains: 'Palmeiras' } }, select: { homeTeam: true, awayTeam: true, dateTime: true, competition: true } });
  console.log('\nPalmeiras matches (home):', palHome.length);
  console.log('Palmeiras matches (away):', palAway.length);
  [...palHome, ...palAway].forEach(m => console.log(' ', m.homeTeam, 'vs', m.awayTeam, '|', m.dateTime, '|', m.competition));

  const logs = await p.scrapeLog.findMany({ orderBy: { startedAt: 'desc' }, take: 5, select: { status: true, startedAt: true, finishedAt: true } });
  console.log('\nLast 5 scrape logs:');
  logs.forEach(l => console.log(' ', l.status, '|', l.startedAt, '-', l.finishedAt));

  // Check snapshots per match for Palmeiras
  const palMatches = await p.match.findMany({
    where: { OR: [{ homeTeam: { contains: 'Palmeiras' } }, { awayTeam: { contains: 'Palmeiras' } }] },
    select: { id: true, homeTeam: true, awayTeam: true, dateTime: true, players: { select: { id: true, name: true, _count: { select: { snapshots: true } } } } }
  });
  console.log('\nPalmeiras matches with snapshot counts:');
  palMatches.forEach(m => {
    const totalSnaps = m.players.reduce((acc, pl) => acc + pl._count.snapshots, 0);
    console.log(' ', m.homeTeam, 'vs', m.awayTeam, '|', m.dateTime, '|', m.players.length, 'players,', totalSnaps, 'total snapshots');
    m.players.filter(pl => pl._count.snapshots > 0).slice(0, 5).forEach(pl => console.log('    ', pl.name, ':', pl._count.snapshots, 'snapshots'));
  });

  await p.$disconnect();
})();
