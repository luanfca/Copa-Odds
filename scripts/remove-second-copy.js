const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Encontrar onde começa a segunda cópia (procurar por "}\nimport" após o primeiro fechamento)
// O padrão é: "}\nimport { NextRequest..."
const pattern = /\}\nimport \{ NextRequest, NextResponse \} from 'next\/server';/;
const match = c.match(pattern);

if (match && match.index > 0) {
    // Manter apenas até antes da segunda cópia
    c = c.substring(0, match.index + 1); // +1 para incluir o "}"
    
    fs.writeFileSync(path, c, 'utf8');
    console.log('Arquivo corrigido! Tamanho:', c.length);
} else {
    console.log('Não encontrou padrão de duplicata');
}
