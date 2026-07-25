const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Encontrar onde começa a segunda cópia (procurar por "}\nimport" que indica início de nova cópia)
const duplicateStart = c.indexOf('}broadcastScrapeError(String(error));/ Force Next.js recompile 1\nimport');
if (duplicateStart > 0) {
    // Manter apenas até antes da duplicata
    c = c.substring(0, duplicateStart + 2); // +2 para incluir "}\n"
    
    fs.writeFileSync(path, c, 'utf8');
    console.log('Arquivo corrigido! Tamanho:', c.length);
} else {
    console.log('Não encontrou padrão de duplicata');
    console.log('Últimos 200 chars:', c.substring(Math.max(0, c.length - 200)));
}
