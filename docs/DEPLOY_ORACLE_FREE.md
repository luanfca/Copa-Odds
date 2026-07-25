# Deploy gratuito na Oracle Cloud

Este guia publica o sistema em uma VM Oracle Cloud Always Free, sem depender do
computador local. A configuração usa:

- Oracle Ampere A1 (ARM64);
- Docker Compose;
- Caddy para HTTPS;
- DuckDNS para subdomínio gratuito;
- SQLite e sessões Playwright em volumes persistentes;
- autenticação básica provisória.

> A autenticação básica protege o MVP com um usuário e senha compartilhados.
> Ela não substitui o sistema de contas individuais necessário para vender
> assinaturas.

## 1. Criar a VM

Na região principal da conta Oracle:

1. Crie uma instância **Always Free eligible**.
2. Escolha Ubuntu 22.04 ou 24.04 para ARM64.
3. Use a forma `VM.Standard.A1.Flex`.
4. Aloque 2 OCPUs e 12 GB de memória.
5. Use entre 50 e 100 GB no volume de inicialização.
6. Associe um IPv4 público.
7. Baixe e guarde a chave SSH.

Na lista de segurança da VCN, permita somente:

| Protocolo | Porta | Origem | Uso |
| --- | ---: | --- | --- |
| TCP | 22 | preferencialmente seu IP | SSH |
| TCP | 80 | `0.0.0.0/0` | emissão e redirecionamento HTTPS |
| TCP | 443 | `0.0.0.0/0` | site HTTPS |
| UDP | 443 | `0.0.0.0/0` | HTTP/3, opcional |

Não exponha as portas 3000, 3002 ou 54545. Elas ficam apenas na rede interna
dos containers.

Referência: [recursos Oracle Always Free][oracle-free].

## 2. Criar o endereço gratuito

1. Entre no [DuckDNS][duckdns].
2. Crie um nome, por exemplo `minhasodds`.
3. Aponte o registro para o IPv4 público da VM.
4. O endereço final será `minhasodds.duckdns.org`.

## 3. Instalar o projeto

Conecte-se à VM:

```bash
ssh -i SUA-CHAVE.key ubuntu@IP_DA_VM
```

Clone o repositório e instale o Docker:

```bash
git clone https://github.com/luanfca/Copa-Odds.git
cd Copa-Odds
bash scripts/deploy/bootstrap-oracle.sh
```

Saia do SSH e entre novamente para aplicar o grupo `docker`:

```bash
exit
ssh -i SUA-CHAVE.key ubuntu@IP_DA_VM
cd Copa-Odds
```

## 4. Gerar segredos e senha

Execute:

```bash
bash scripts/deploy/prepare-env.sh
```

O assistente solicita:

- domínio DuckDNS;
- e-mail para o certificado;
- usuário provisório;
- senha provisória.

Ele cria `.env.oracle` com permissão `600`, hash da senha e segredos aleatórios.
Senhas em texto não são gravadas.

Se alguma casa exigir credencial ou proxy, edite o arquivo:

```bash
nano .env.oracle
```

Nunca envie esse arquivo para o Git.

## 5. Publicar

```bash
bash scripts/deploy/deploy.sh
```

Na primeira execução, o download e a compilação das imagens podem demorar.
Depois, confira:

```bash
docker compose --env-file .env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file .env.oracle -f docker-compose.oracle.yml logs -f
```

Abra `https://SEU-NOME.duckdns.org` e informe o usuário e a senha configurados.
O Caddy obtém e renova o certificado HTTPS automaticamente.

## 6. Levar o banco atual (opcional)

O deploy começa com um banco vazio e cria as tabelas automaticamente. Para
preservar o histórico local, envie `prisma/dev.db` para a VM:

```bash
scp -i SUA-CHAVE.key prisma/dev.db ubuntu@IP_DA_VM:/tmp/odds.db
```

Na VM:

```bash
cd Copa-Odds
docker compose --env-file .env.oracle -f docker-compose.oracle.yml stop app
docker compose --env-file .env.oracle -f docker-compose.oracle.yml run \
  --rm --no-deps --user root \
  -v /tmp/odds.db:/tmp/source.db:ro \
  app sh -c 'cp /tmp/source.db /app/data/odds.db && chown node:node /app/data/odds.db'
rm /tmp/odds.db
docker compose --env-file .env.oracle -f docker-compose.oracle.yml up -d
```

## 7. Backups

Backup manual consistente:

```bash
bash scripts/deploy/backup.sh
```

O script mantém os 14 backups comprimidos mais recentes em `backups/`.
Para executar diariamente às 04:00 UTC:

```bash
crontab -e
```

Adicione, ajustando o caminho:

```cron
0 4 * * * cd /home/ubuntu/Copa-Odds && bash scripts/deploy/backup.sh >> backups/backup.log 2>&1
```

Baixe periodicamente uma cópia para outro local. Backup mantido somente dentro
da mesma VM não protege contra perda da conta ou do volume.

## 8. Atualizações e operação

Atualizar:

```bash
git pull --ff-only
bash scripts/deploy/deploy.sh
```

Reiniciar:

```bash
docker compose --env-file .env.oracle -f docker-compose.oracle.yml restart
```

Parar sem apagar os dados:

```bash
docker compose --env-file .env.oracle -f docker-compose.oracle.yml down
```

Não use `down -v`: a opção `-v` apaga banco, sessões e certificados.

## Limitações do plano gratuito

- Pode faltar capacidade A1 na região escolhida.
- A Oracle pode recuperar instâncias consideradas inativas.
- Não há SLA de produção.
- A ARM64 pode revelar incompatibilidades específicas de algum site ou scraper.
- A autenticação compartilhada é adequada apenas para um beta pequeno.

O Playwright oferece suporte a Ubuntu/Debian ARM64, mas cada adapter deve ser
testado na VM com as proteções reais das casas.

[oracle-free]: https://docs.oracle.com/pt-br/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
[duckdns]: https://www.duckdns.org/
