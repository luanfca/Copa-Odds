# Scripts do projeto

Os scripts permanecem na raiz desta pasta para preservar os comandos e caminhos
usados durante o desenvolvimento. Os prefixos indicam a finalidade de cada um:

| Categoria | Prefixos principais | Finalidade |
| --- | --- | --- |
| Runtime | `start-*`, `run-*`, `watchdog` | Inicialização dos serviços e coleta |
| Banco/manutenção | `setup-*`, `merge-*`, `clear-*`, `rebuild-*`, `update-*` | Operações deliberadas sobre dados |
| Diagnóstico | `check-*`, `debug-*`, `diagnostico`, `trace-*`, `find-*`, `verify-*` | Inspeção pontual e investigação |
| Experimentos | `test-*`, `_*` | Reproduções manuais e artefatos temporários |

## Comandos suportados

Prefira os comandos do `package.json` para os fluxos recorrentes:

```bash
npm run dev
npm run dev:ws
npm run dev:sofa
npm run scrape
npm run check
```

Os arquivos `*.test.ts` de `__tests__/` são a suíte Jest. Scripts com prefixo
`test-` nesta pasta são verificações manuais e podem depender de banco, navegador,
sessão autenticada ou serviços locais.

## Arquivos gerados

Saídas de diagnóstico (`_*.txt`, `_*.json`, `_*.png`), `tmp-bf/`, sessões do
Playwright e caches Python não fazem parte do código-fonte e são ignorados pelo
Git. Não grave credenciais, cookies ou respostas autenticadas em arquivos
rastreados.
