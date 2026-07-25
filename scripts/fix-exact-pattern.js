const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Encontrar onde começa a segunda cópia (procurar por "}\nimport" após o primeiro fechamento)
// O padrão exato é: "}\nimport { NextRequest, NextResponse } from 'next/server';"
const lines = c.split('\n');
let secondCopyStart = -1;

for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === '}' && lines[i+1] === "import { NextRequest, NextResponse } from 'next/server';") {
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
    console.log('Procurando por padrões...');
    // Tentar encontrar o padrão exato
    for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim() === '}' && lines[i+1].trim().startsWith('import')) {
            console.log(`Encontrado em linha ${i+1}: "${lines[i]}"`);
            console.log(`Seguinte: "${lines[i+1]}"`);
        }
    }
}
