f=r'C:\Users\LuanADM\Desktop\Projetos\Odds ao vivo\src\app\api\desarmes\route.ts'
lines=open(f, encoding='utf-8').readlines()

# Encontrar e substituir as linhas problemáticas
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Verificar se é a chamada incorreta de odds:update
    if 'broadcastScrapeError(' in line and i+1 < len(lines) and "type: 'odds:update'" in lines[i+1]:
        # Substituir por comentário
        new_lines.append('    // broadcastScrapeError odds:update removido\n')
        # Pular todas as linhas até encontrar '});'
        i += 1
        while i < len(lines) and '});' not in lines[i]:
            i += 1
        i += 1  # Pular a linha com '});'
        
    # Verificar se é a chamada correta no catch
    elif 'broadcastScrapeError(' in line and i+1 < len(lines) and "type: 'scrape:error'" in lines[i+1]:
        # Substituir por chamada correta
        new_lines.append('    broadcastScrapeError(String(error))\n')
        # Pular todas as linhas até encontrar '});'
        i += 1
        while i < len(lines) and '});' not in lines[i]:
            i += 1
        i += 1  # Pular a linha com '});'
        
    else:
        new_lines.append(line)
        i += 1

open(f, 'w', encoding='utf-8').writelines(new_lines)
print('Correções aplicadas com sucesso')
