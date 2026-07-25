const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');
const lines = c.split('\n');

// Encontrar onde começa a segunda cópia (linha 221)
const secondCopyStart = 220; // 0-indexed, então linha 221 é índice 220

// Manter apenas as primeiras 220 linhas
c = lines.slice(0, secondCopyStart).join('\n');

fs.writeFileSync(path, c, 'utf8');
console.log('Arquivo corrigido! Linhas removidas:', lines.length - secondCopyStart);
