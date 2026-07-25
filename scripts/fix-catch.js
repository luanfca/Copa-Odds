const fs = require('fs');
const path = 'C:/Users/LuanADM/Desktop/Projetos/Odds ao vivo/src/app/api/matches/[id]/route.ts';

let c = fs.readFileSync(path, 'utf8');

// Remover todo o conteúdo a partir de "broadcastScrapeError" no final
const garbageStart = c.indexOf('broadcastScrapeError(String(error));/ Force Next.js recompile');
if (garbageStart >= 0) {
    // Voltar para encontrar o início do catch problemático
    const catchStart = c.lastIndexOf('} catch (error) {', garbageStart);
    if (catchStart >= 0) {
        // Substituir pelo catch correto
        const correctCatch = `  } catch (error) {
    broadcastScrapeError(String(error))

    return NextResponse.json(
      { error: 'Erro ao buscar odds do jogo', detail: String(error) },
      { status: 500 }
    );
  }
}`;
        
        c = c.substring(0, catchStart) + correctCatch;
        fs.writeFileSync(path, c, 'utf8');
        console.log('Arquivo corrigido!');
    } else {
        console.log('Catch não encontrado');
    }
} else {
    console.log('Garbage não encontrado');
}
