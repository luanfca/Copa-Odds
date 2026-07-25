const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  for (const market of ["finalizacao", "chutes_ao_gol"]) {
    const rows = await p.oddSnapshot.groupBy({
      by: ["house", "line"],
      where: { market },
      _count: true,
    });
    console.log("\n===", market);
    rows.sort(
      (a: { house: string; line: string }, b: { house: string; line: string }) =>
        a.house.localeCompare(b.house) || a.line.localeCompare(b.line),
    );
    for (const r of rows) console.log(r.house, r.line, r._count);
  }
  const kaio = await p.oddSnapshot.findMany({
    where: { player: { displayName: { contains: "Kaio Jorge" } }, market: { in: ["finalizacao","chutes_ao_gol"] } },
    include: { player: true },
  });
  console.log("\nKaio Jorge snaps", kaio.length);
  for (const s of kaio) console.log(s.market, s.house, s.line, s.value);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
