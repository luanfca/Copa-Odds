import re
import os

path = 'src/scraping/betfairAdapter.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

count = 0

# 1. Remove extractDomOdds function
start = content.find('async function extractDomOdds(): Promise<{ odds: any[]; diag: string[] }> {')
if start >= 0:
    idx = start
    brace_count = 0
    found_fn = False
    while idx < len(content):
        if content[idx] == '{':
            brace_count += 1
            found_fn = True
        elif content[idx] == '}':
            brace_count -= 1
            if found_fn and brace_count == 0:
                end_of_fn = idx + 1
                break
        idx += 1
    else:
        end_of_fn = len(content)
    # Remove until before the function
    # Go back to start of line containing 'async function'
    line_start = content.rfind('\n', 0, start) + 1
    removed = content[line_start:end_of_fn]
    content = content[:line_start] + content[end_of_fn:]
    count += 1
    print(f'Removed extractDomOdds ({len(removed)} chars)')
    with open(path + '.bak', 'w', encoding='utf-8') as f2:
        f2.write(content)

# 2. Remove logDomDiag function (reload from modified content)
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('function logDomDiag(diag: string[], prefix: string): void {')
if start >= 0:
    line_start = content.rfind('\n', 0, start) + 1
    end_of_fn = content.find('\n    }\n', start) + 5  # +5 for \n    }\n
    if end_of_fn > line_start:
        removed = content[line_start:end_of_fn]
        content = content[:line_start] + content[end_of_fn:]
        count += 1
        print(f'Removed logDomDiag ({len(removed)} chars)')
        with open(path + '.bak', 'w', encoding='utf-8') as f2:
            f2.write(content)

# 3. Remove DOM extraction flow section
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('    // Extração única do DOM:')
if start >= 0:
    end = content.find('    // Extrai dados SSR (Server-Side Rendered)', start)
    if end > start:
        line_start = content.rfind('\n', 0, start) + 1
        content = content[:line_start] + content[end:]
        count += 1
        print(f'Removed DOM extraction flow section')
        with open(path + '.bak', 'w', encoding='utf-8') as f2:
            f2.write(content)

# 4. Remove _domOdds processing from extractMatchesFromApiData
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('    // ── Formato 3: Odds extraídas do DOM renderizado ──')
if start >= 0:
    # Find the closing brace of this if block
    idx = content.find('    }\n\n    // ──', start)
    if idx < 0:
        idx = content.find('    }\n\n  return matches;', start)
    if idx > start:
        line_start = content.rfind('\n', 0, start) + 1
        end_of_block = content.find('\n    }\n', idx) + 5 if idx > start else content.find('  }\n\n  return matches;', start)
        content = content[:line_start] + content[end_of_block:]
        count += 1
        print(f'Removed _domOdds processing section')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Total removals: {count}')
