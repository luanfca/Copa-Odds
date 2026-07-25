const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Encontrar a posição onde começa a segunda cópia (após o primeiro "}")
const firstEndBrace = c.lastIndexOf('}\n');
if (firstEndBrace > 0) {
    // Manter apenas até o primeiro "}"
    c = c.substring(0, firstEndBrace + 2); // +2 para incluir }\n
    
    fs.writeFileSync(path, c, 'utf8');
    console.log('Arquivo corrigido! Tamanho:', c.length);
} else {
    console.log('Não encontrou padrão de duplicata');
}
