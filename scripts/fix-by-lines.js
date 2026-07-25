const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Procurar por "}\nimport" que indica início de segunda cópia
const lines = c.split('\n');
let secondCopyStart = -1;

for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === '}' && lines[i+1].startsWith('import { NextRequest')) {
        secondCopyStart = i;
        break;
    }
}

if (secondCopyStart >= 0) {
    // Manter apenas até a linha do "}"
    c = lines.slice(0, secondCopyStart + 1).join('\n');
    
    fs.writeFileSync(path, c, 'utf8');
    console.log('Arquivo corrigido! Linhas removidas:', lines.length - (secondCopyStart + 1));
} else {
    console.log('Não encontrou padrão de duplicata');
    console.log('Últimas 5 linhas:');
    console.log(lines.slice(-5).join('\n'));
}
