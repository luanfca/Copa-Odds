const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Encontrar a segunda ocorrência do catch problemático e corrigir
const catchPattern = /} catch \(error\) \{\s*broadcastOddsUpdate\(\s*type: 'scrape:error',[^}]+\}\);\s*return NextResponse\.json\([^}]+\}\);\s*\}\s*\}/g;

let matches = c.match(catchPattern);
if (matches && matches.length > 1) {
    // Corrigir apenas a segunda ocorrência
    const lastIndex = c.lastIndexOf('} catch (error) {');
    const secondLastIndex = c.lastIndexOf('} catch (error) {', lastIndex - 1);
    
    if (secondLastIndex >= 0) {
        // Encontrar o final do segundo catch
        let braceCount = 0;
        let endIdx = secondLastIndex;
        let foundStart = false;
        
        for (let i = secondLastIndex; i < c.length; i++) {
            if (c[i] === '{') {
                braceCount++;
                foundStart = true;
            } else if (c[i] === '}') {
                braceCount--;
                if (foundStart && braceCount === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }
        
        // Substituir pelo código corrigido
        const replacement = '} catch (error) {\n    broadcastScrapeError(String(error))\n\n    return NextResponse.json(\n      { error: \'Erro ao buscar odds do jogo\', detail: String(error) },\n      { status: 500 }\n    );\n  }\n}';
        c = c.substring(0, secondLastIndex) + replacement + c.substring(endIdx);
        
        fs.writeFileSync(path, c, 'utf8');
        console.log('Arquivo corrigido!');
    } else {
        console.log('Não encontrou segunda ocorrência do catch');
    }
} else {
    console.log('Não encontrou duplicata ou apenas uma ocorrência');
}
