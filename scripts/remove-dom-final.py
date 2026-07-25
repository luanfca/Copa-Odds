import os

path = 'src/scraping/betfairAdapter.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

count = 0

# 1. Remove extractDomOdds function
# Find by unique start and end markers
start_marker = 'async function extractDomOdds(): Promise<{ odds: any[]; diag: string[] }> {'
end_marker = "} catch { return { odds: [], diag: ['ERRO extractDomOdds'] }; }"

start = content.find(start_marker)
if start >= 0:
    end = content.find(end_marker, start)
    if end >= 0:
        # Find the closing \n    }\n after the catch
        end_of_func = content.find('\n    }\n', end) + 5  # include the closing
        if end_of_func > start:
            line_start = content.rfind('\n', 0, start)
            if line_start < 0: line_start = 0
            content = content[:line_start] + content[end_of_func:]
            count += 1
            print(f'[1/4] Removed extractDomOdds function')

# 2. Remove logDomDiag function
start_marker2 = 'function logDomDiag(diag: string[], prefix: string): void {'
start2 = content.find(start_marker2)
if start2 >= 0:
    end_of_func2 = content.find('\n    }\n\n    // Extrai', start2) + 5
    if end_of_func2 > 0:
        line_start2 = content.rfind('\n', 0, start2)
        content = content[:line_start2] + content[end_of_func2:]
        count += 1
        print(f'[2/4] Removed logDomDiag function')

# 3. Remove DOM extraction flow section
start_marker3 = '    // Extração única do DOM:'
start3 = content.find(start_marker3)
if start3 >= 0:
    end_marker3 = '    // Extrai dados SSR (Server-Side Rendered)'
    end3 = content.find(end_marker3, start3)
    if end3 > start3:
        line_start3 = content.rfind('\n', 0, start3) + 1
        # Remove everything from this line to just before the SSR section
        content = content[:start3] + content[end3:]
        count += 1
        print(f'[3/4] Removed DOM extraction flow section')

# 4. Remove _domOdds processing from extractMatchesFromApiData
start_marker4 = '    // ── Formato 3: Odds extraídas do DOM renderizado ──'
start4 = content.find(start_marker4)
if start4 >= 0:
    # Find the closing \n    }\n that comes after this section
    end_of_block = content.find('\n    }\n\n  return matches;', start4)
    if end_of_block > start4:
        end_of_block += 5  # include the closing
        content = content[:start4] + content[end_of_block:]
        count += 1
        print(f'[4/4] Removed _domOdds processing section')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\nTotal: {count} sections removed')
print(f'File size: {os.path.getsize(path)} bytes')
