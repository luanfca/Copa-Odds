#!/usr/bin/env node
/**
 * Watchdog — Inicia e monitora Python (SofaScore) + Next.js com auto-restart.
 *
 * Se qualquer processo cair, o watchdog reinicia APENAS o que caiu,
 * sem derrubar o outro. Após N reinícios consecutivos sem ficar
 * vivo por pelo menos MIN_UPTIME, o watchdog desiste (evita loop infinito).
 *
 * Uso: node scripts/watchdog.mjs
 *      npm run dev:watchdog   (adicione ao package.json)
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────
const MAX_RESTARTS_PER_PROCESS = 50;     // desiste após N reinícios (alto p/ dev, muitas recompilações)
const MIN_UPTIME_MS = 20_000;            // p/ resetar contagem (20s)
const HEALTH_CHECK_INTERVAL_MS = 10_000; // checa a cada 10s (menos agressivo)
const STARTUP_DELAY_MS = 3_000;          // espera entre spawns
const SOFA_PORT = 54545;
const NEXT_PORT = 3000;

// Tempo extra para Python inicializar (Flask + proxy handshake)
const SOFA_STARTUP_WAIT_MS = 15_000; // 15s para o Python subir
const SOFA_LIFTOFF_CHECK_MS = 1_000;  // checa a cada 1s se a porta abriu

// ── Cores ───────────────────────────────────────────────────────────
const C = {
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  dim:    '\x1b[2m',
  reset:  '\x1b[0m',
};

function tag(emoji, name) {
  return `${C.dim}${emoji}${C.reset} ${C.yellow}${name}${C.reset}`;
}

function log(emoji, name, msg, color = C.reset) {
  const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  console.log(`${C.dim}[${ts}]${C.reset} ${tag(emoji, name)} ${color}${msg}${C.reset}`);
}

// ── Gerenciador de processo com auto-restart ───────────────────────
class ManagedProcess {
  constructor({ emoji, name, color, spawnFn, healthCheckFn }) {
    this.emoji = emoji;
    this.name = name;
    this.color = color;
    this.spawnFn = spawnFn;
    this.healthCheckFn = healthCheckFn ?? (() => Promise.resolve(true));
    this.proc = null;
    this.restartCount = 0;
    this.lastStartTime = 0;
    this.stopping = false;
    this._healthInterval = null;
  }

  /** Inicia o processo e começa o health check */
  start() {
    if (this.stopping) return;
    this.proc = this.spawnFn();

    // Segurança: se spawnFn retornou null (ex: arquivo não encontrado),
    // não tenta chamar .on() em null.
    if (!this.proc) {
      log(this.emoji, this.name, 'Falha ao criar processo (spawn retornou null).', C.red);
      if (this.restartCount < MAX_RESTARTS_PER_PROCESS) {
        this.restartCount++;
        setTimeout(() => this.start(), 5_000);
      }
      return;
    }

    this.lastStartTime = Date.now();

    this.proc.on('close', (code) => {
      if (this.stopping) return; // shutdown intencional
      log(this.emoji, this.name, `Processo encerrou (código ${code}).`, C.red);

      // Se morreu rápido demais, incrementa contagem
      const uptime = Date.now() - this.lastStartTime;
      if (uptime < MIN_UPTIME_MS) {
        this.restartCount++;
        log(this.emoji, this.name,
          `Viveu só ${(uptime / 1000).toFixed(0)}s — reinício ${this.restartCount}/${MAX_RESTARTS_PER_PROCESS}.`,
          C.yellow);
      } else {
        // Viveu tempo suficiente: reseta contagem
        this.restartCount = 0;
        log(this.emoji, this.name,
          `Viveu ${(uptime / 1000).toFixed(0)}s (ok). Resetando contagem.`, C.green);
      }

      if (this.restartCount >= MAX_RESTARTS_PER_PROCESS) {
        log(this.emoji, this.name,
          `Máximo de reinícios atingido (${MAX_RESTARTS_PER_PROCESS}). Desistindo!`, C.red);
        return;
      }

      // Espera 2s e reinicia
      setTimeout(() => this.start(), 2_000);
    });

    this.proc.on('error', (err) => {
      log(this.emoji, this.name, `Erro ao iniciar: ${err.message}`, C.red);
    });
  }

  /** Para o processo e o health check */
  stop() {
    this.stopping = true;
    if (this._healthInterval) clearInterval(this._healthInterval);
    if (this.proc && !this.proc.killed) {
      log(this.emoji, this.name, 'Encerrando...', C.dim);
      if (process.platform === 'win32') {
        // No Windows, mata a árvore de processos
        spawn('taskkill', ['/F', '/T', '/PID', String(this.proc.pid)], {
          stdio: 'ignore', shell: true,
        });
      } else {
        this.proc.kill('SIGTERM');
      }
    }
  }

  /** Verifica se o processo ainda está vivo */
  isAlive() {
    return this.proc !== null && !this.proc.killed && this.proc.exitCode === null;
  }
}

// ── Criação dos processos gerenciados ──────────────────────────────

function createPythonProcess() {
  const scriptPath = path.join(ROOT, 'scripts', 'sofascore_server.py');
  if (!existsSync(scriptPath)) {
    log('🐍', 'Python', 'scripts/sofascore_server.py não encontrado!', C.red);
    return null;
  }

  // IMPORTANTE: com shell: true no Windows, o path precisa de aspas
  // porque o diretório tem espaços ("Odds ao vivo").
  // Usamos comando como string única para evitar o warning DEP0190
  // ("args com shell=true pode ser inseguro").
  const proc = spawn(`python "${scriptPath}"`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    cwd: ROOT,
  });

  proc.stdout.on('data', (data) => {
    for (const line of data.toString().trim().split('\n').filter(Boolean)) {
      log('🐍', 'SofaScore', line, C.green);
    }
  });

  proc.stderr.on('data', (data) => {
    for (const line of data.toString().trim().split('\n').filter(Boolean)) {
      if (line.includes('WARNING') || line.includes('DEBUG')) return;
      log('🐍', 'SofaScore', line, C.red);
    }
  });

  return proc;
}

function createNextProcess() {
  const proc = spawn('npx', ['next', 'dev', '-p', String(NEXT_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    cwd: ROOT,
  });

  proc.stdout.on('data', (data) => {
    for (const line of data.toString().trim().split('\n').filter(Boolean)) {
      // Filtra linhas muito ruidosas
      // Filtra ruído de compilações frequentes
      if (line.includes('compiled') && (line.includes('server') || line.includes('client'))) {
        // Loga compilações em modo dim (discreto)
        log('⚡', 'Next.js', line, C.dim);
      } else if (line.includes('ready') || line.includes('started') || line.includes('localhost')) {
        log('⚡', 'Next.js', line, C.green);
      } else {
        log('⚡', 'Next.js', line, C.cyan);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    for (const line of data.toString().trim().split('\n').filter(Boolean)) {
      log('⚡', 'Next.js', line, C.dim);
    }
  });

  return proc;
}

// ── Health check via HTTP ──────────────────────────────────────────

async function httpHealthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: 3_000 }, (res) => {
      resolve(res.statusCode < 500); // qualquer código < 500 = servidor vivo
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.green}  Copa Odds — Watchdog (auto-restart ativo)${C.reset}`);
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log('');
  log('🔁', 'Watchdog',
    `Auto-restart ativo (max ${MAX_RESTARTS_PER_PROCESS} reinícios, mínimo ${(MIN_UPTIME_MS/1000).toFixed(0)}s p/ considerar estável)`,
    C.yellow);
  console.log('');

  // ── Mata processos Python antigos ─────────────────────────────────
  log('🔧', 'Setup', 'Limpando processos Python antigos...', C.dim);
  await new Promise((resolve) => {
    const kill = spawn('taskkill', ['/F', '/IM', 'python.exe'], {
      stdio: 'ignore', shell: true,
    });
    kill.on('close', resolve);
  });
  await new Promise((r) => setTimeout(r, 2_000)); // espera o SO liberar a porta
  log('🔧', 'Setup', 'Python antigos limpos.', C.green);

  // ── Verifica deps Python ──────────────────────────────────────────
  log('🔧', 'Setup', 'Verificando dependências Python...', C.dim);
  const depsOk = await new Promise((resolve) => {
    const check = spawn('python', ['-c', 'import curl_cffi, flask'], {
      stdio: 'ignore', shell: true,
    });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });

  if (!depsOk) {
    log('🔧', 'Setup', 'Instalando curl_cffi e flask...', C.yellow);
    await new Promise((resolve) => {
      const install = spawn('pip', ['install', 'curl_cffi', 'flask'], {
        stdio: 'inherit', shell: true,
      });
      install.on('close', resolve);
    });
  } else {
    log('🔧', 'Setup', 'Dependências Python OK.', C.green);
  }

  // ── Cria processos gerenciados ────────────────────────────────────
  const pythonProc = new ManagedProcess({
    emoji: '🐍',
    name: 'SofaScore',
    color: C.green,
    spawnFn: createPythonProcess,
  });

  const nextProc = new ManagedProcess({
    emoji: '⚡',
    name: 'Next.js',
    color: C.cyan,
    spawnFn: createNextProcess,
  });

  // Inicia Python primeiro, espera ativamente a porta abrir, depois Next
  pythonProc.start();
  
  // Aguarda o servidor Python ficar pronto (porta 54545)
  log('🐍', 'Watchdog', `Aguardando SofaScore na porta ${SOFA_PORT}...`, C.yellow);
  const deadline = Date.now() + SOFA_STARTUP_WAIT_MS;
  let pythonReady = false;
  while (Date.now() < deadline) {
    const ok = await httpHealthCheck(SOFA_PORT);
    if (ok) {
      pythonReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, SOFA_LIFTOFF_CHECK_MS));
  }
  
  if (pythonReady) {
    log('🐍', 'Watchdog', 'SofaScore pronto!', C.green);
  } else {
    log('🐍', 'Watchdog', 'SofaScore não respondeu após 15s — continuando mesmo assim.', C.yellow);
  }

  // Pequena pausa antes do Next
  await new Promise((r) => setTimeout(r, 2_000));
  nextProc.start();

  // ── Health check periódico ────────────────────────────────────────
  let healthPasses = new Map(); // name -> consecutive fails

  const healthInterval = setInterval(async () => {
    const checks = [
      { proc: pythonProc, port: SOFA_PORT, label: 'SofaScore' },
      { proc: nextProc, port: NEXT_PORT, label: 'Next.js' },
    ];

    for (const { proc, port, label } of checks) {
      if (proc.stopping || !proc.isAlive()) continue;

      const ok = await httpHealthCheck(port, label);
      if (ok) {
        healthPasses.set(label, 0); // reset fail count
      } else {
        const fails = (healthPasses.get(label) || 0) + 1;
        healthPasses.set(label, fails);
        if (fails >= 5) {
          log('💀', label,
            `Sem resposta HTTP após ${fails} tentativas (${(fails * HEALTH_CHECK_INTERVAL_MS / 1000).toFixed(0)}s). Reiniciando...`, C.red);
          proc.stop();
          healthPasses.set(label, 0);
          // O auto-restart no 'close' handler vai religar
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  // ── Cleanup ───────────────────────────────────────────────────────
  const shutdown = () => {
    log('👋', 'Watchdog', 'Encerrando todos os processos...', C.yellow);
    clearInterval(healthInterval);
    pythonProc.stop();
    nextProc.stop();
    // Força saída após 3s se algo travar
    setTimeout(() => process.exit(0), 3_000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ── URLs ──────────────────────────────────────────────────────────
  setTimeout(() => {
    console.log('');
    console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log(`  ${C.cyan}http://localhost:${NEXT_PORT}${C.reset}      → App Next.js`);
    console.log(`  ${C.green}http://localhost:${SOFA_PORT}${C.reset}      → SofaScore API`);
    console.log(`  ${C.yellow}Ctrl+C${C.reset} para encerrar tudo`);
    console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log('');
  }, 6_000);

  // Handler de exceções não-capturadas: loga mas não derruba o watchdog
  process.on('uncaughtExceptionMonitor', (err) => {
    log('💥', 'Watchdog', `Exceção não capturada: ${err.message}`, C.red);
  });

  // Mantém o processo vivo
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Erro fatal no watchdog:', err);
  process.exit(1);
});
