# Comparador de Odds ao Vivo — Brasileirão

Aplicação web que coleta, normaliza e compara, em tempo quase real, odds de
mercados por jogador do Brasileirão. O sistema reúne seis casas, destaca a
melhor odd, detecta desajustes e arbitragem e mantém o histórico de variação.

> Projeto de estudo focado em **engenharia de dados**, **web scraping de fontes protegidas** e **integracao de multiplas APIs**. O objetivo foi tecnico: aprender a coletar, padronizar e cruzar dados de fontes heterogeneas e instaveis.

---

## Sobre o projeto

Cada casa de apostas publica os mesmos mercados de formas diferentes: nomes de jogadores escritos de jeitos distintos, APIs internas variadas e protecoes anti-bot. Este projeto resolve esse problema reunindo tudo em uma unica tabela comparativa, onde da pra ver lado a lado a odd de cada casa para o mesmo jogador e mercado.

## Funcionalidades

- Tabela comparativa lado a lado por jogador e por jogo
- Destaque automatico da melhor odd disponivel
- Deteccao de oportunidades de arbitragem
- Historico de variacao das odds em grafico
- Rankings por mercado e estatísticas históricas de jogadores
- Favoritos, filtros por jogo/time e acompanhamento do status da coleta
- Cache persistente e snapshots das APIs para carregamento rápido
- Interface responsiva instalável como PWA
- Coleta automatica diaria (agendada para 08:00 BRT)
- Modo mock com dados ficticios, para rodar sem depender das casas

## Mercados suportados

Desarmes, faltas cometidas, faltas sofridas, finalizações e chutes ao gol.

## Fontes de dados

| Casa | Tipo de acesso | Estrategia | Status |
| --- | --- | --- | --- |
| BetMGM | API REST direta | Endpoint publico, sem browser | Funcionando |
| Superbet | API REST direta | CDN + BetBuilder API, sem browser | Funcionando |
| Betfair | Browser (Playwright) | Intercepta requisicoes da SPA (protecao Akamai) | Funcionando |
| Pitaco | Browser + gRPC | Intercepta respostas gRPC e decodifica protobuf | Funcionando |
| Betsson | API REST + fallback | Tenta REST primeiro, usa browser se falhar | Em desenvolvimento |
| Bet365 | Browser (Playwright) | Navega a SPA e faz parsing dos dados | Em desenvolvimento |

Todas as integracoes foram descobertas via analise de trafego de rede real.

## Arquitetura

```mermaid
flowchart LR
    A["Casas de apostas (4 ativas + 2 em desenvolvimento)"] --> B["Coletores (REST / Playwright / gRPC)"]
    B --> C["Normalizacao de nomes (Levenshtein + slugify)"]
    C --> D["Banco SQLite (Prisma)"]
    D --> E["Cache persistente + snapshots"]
    E --> F["API (Next.js Route Handlers)"]
    F --> G["Interface web (tabelas, rankings e gráficos)"]
```

## Tecnologias

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Radix UI, Recharts
- **Scraping:** Playwright (Chromium headless), com sessoes persistidas, User-Agent real e delays aleatorios
- **Backend:** Next.js Route Handlers e agendador interno de coleta
- **Banco de dados:** SQLite via Prisma ORM
- **Bibliotecas de apoio:** fast-levenshtein (comparacao de nomes), protobufjs (decode gRPC), winston (logging)
- **Tempo real e interface:** WebSocket, PWA, Radix UI e Recharts

## Como rodar

Pre-requisitos: Node.js 18+ instalado.

```bash
# 1. Clonar o repositorio
git clone https://github.com/SEU-USUARIO/comparador-odds.git
cd comparador-odds

# 2. Instalar as dependencias
npm install

# 3. Configurar as variaveis de ambiente
cp .env.example .env

# 4. Configurar o banco e o Playwright
npm run db:push
npx playwright install chromium

# 5. Subir o servidor de desenvolvimento
npm run dev
```

A aplicacao fica disponivel em http://localhost:3000

Comandos uteis:

```bash
npm run scrape      # roda a coleta manualmente
npm run db:studio   # abre o visualizador do banco de dados
npm run check       # typecheck + testes unitários
```

Modos de execucao por variavel de ambiente:

- USE_MOCK=true roda com dados ficticios, sem acessar as casas
- SCRAPE_ON_START=true faz a coleta logo ao iniciar; caso contrario, roda todo dia as 08:00 BRT

## Desafios tecnicos

**1. Normalizacao de nomes de jogadores entre casas.**
Uma casa escreve "Vinicius Jr.", outra "Vinicius Junior", outra "V. Junior". Sem tratamento, o mesmo jogador aparecia duplicado na tabela. A solucao combina distancia de Levenshtein relativa, normalizacao de sufixos (Jr / Junior) e slugify sem acentos para reconhecer que sao a mesma pessoa.

**2. Descoberta e mapeamento das APIs internas.**
As casas sao SPAs com protecao anti-bot. Foi preciso analisar o trafego de rede real para encontrar e entender os endpoints de cada uma.

**3. Decodificacao de gRPC com protobuf (Pitaco).**
O Pitaco trafega os dados em formato binario via gRPC. Foi necessario interceptar as respostas e decodificar o protobuf manualmente para extrair as odds.

## Estrutura principal

```text
src/app/          páginas e rotas de API
src/components/   componentes da interface
src/lib/          domínio, cache, banco, estatísticas e infraestrutura
src/scraping/     orquestração e adapters das casas
prisma/           modelo do banco de dados
__tests__/        testes unitários automatizados
scripts/          runtime, manutenção e diagnósticos
```

Veja também [`scripts/README.md`](scripts/README.md) para a classificação dos
scripts auxiliares.

## Deploy gratuito

O projeto inclui containers ARM64, HTTPS automático, persistência e scripts
para uma VM Oracle Cloud Always Free. Consulte o
[`guia de deploy na Oracle`](docs/DEPLOY_ORACLE_FREE.md).

## Status e próximos passos

- Em funcionamento: Betfair, BetMGM, Superbet e Pitaco.
- Em desenvolvimento: Betsson e Bet365 (coleta das odds ainda em ajuste).
- Ampliar a cobertura automatizada dos adapters e dos fluxos de consolidação.

## Aprendizados

- Integracao de fontes heterogeneas e instaveis em um modelo de dados unico
- Tecnicas de web scraping resiliente em sites com protecao anti-bot
- Resolucao de entidades (entity resolution) com correspondencia aproximada de texto
- Modelagem e persistencia de dados com ORM
- Construcao de uma interface de dados de ponta a ponta

## Aviso

Projeto desenvolvido para fins de estudo e demonstracao tecnica. O uso respeita os termos de cada servico e nao incentiva apostas. Aposte com responsabilidade.

## Licenca

MIT
