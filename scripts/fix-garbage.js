const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Remover o lixo no final do arquivo
// O padrão é: "}\n}broadcastScrapeError(String(error));/ Force Next.js recompile 1"
const garbagePattern = /\}\nbroadcastScrapeError\(String\(error\)\);\/ Force Next\.js recompile 1$/;
c = c.replace(garbagePattern, '');

// Adicionar o fechamento correto
if (!c.endsWith('}\n')) {
    c += '  }\n}\n';
}

fs.writeFileSync(path, c, 'utf8');
console.log('Arquivo corrigido!');
