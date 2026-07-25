f=r'C:\Users\LuanADM\Desktop\Projetos\Odds ao vivo\src\app\api\value-odds\route.ts'
lines=open(f, encoding='utf-8').readlines()

# Encontrar e substituir as linhas problemáticas
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Verificar se é a chamada incorreta de broadcast
    if 'import { broadcast }' in line:
        new_lines.append("import { broadcastScrapeError } from '@/lib/ws-server';\n")
        i += 1
        continue
        
    # Verificar se é a chamada incorreta de odds:update
    if 'broadcast(' in line and i+1 < len(lines) and "type: 'odds:update'" in lines[i+1]:
        # Substituir por comentário
        new_lines.append('    // broadcast odds:update removido\n')
        # Pular todas as linhas até encontrar '});'
        i += 1
        while i < len(lines) and '});' not in lines[i]:
            i += 1
        i += 1  # Pular a linha com '});'
        continue
        
    # Verificar se é a chamada correta no catch
    elif 'broadcast(' in line and i+1 < len(lines) and "type: 'scrape:error'" in lines[i+1]:
        # Substituir por chamada correta
        new_lines.append('    broadcastScrapeError(String(error))\n')
        # Pular todas as linhas até encontrar '});'
        i += 1
        while i < len(lines) and '});' not in lines[i]:
            i += 1
        i += 1  # Pular a linha com '});'
        continue
        
    else:
        new_lines.append(line)
        i += 1

open(f, 'w', encoding='utf-8').writelines(new_lines)
print('Correções aplicadas com sucesso')
