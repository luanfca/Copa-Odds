/**
 * Inicia o servidor Python do SofaScore + Next.js dev em um único comando.
 *
 * Uso: npm run dev:sofa
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Cores ──────────────────────────────────────────────────────────
const C = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function log(tag, color, msg) {
  console.log(`${color}[${tag}]${C.reset} ${msg}`);
}

// ── Verifica dependências Python ───────────────────────────────────
async function checkPythonDeps() {
  return new Promise((resolve) => {
    const check = spawn('python', ['-c', 'import curl_cffi, flask'], {
      stdio: 'ignore',
      shell: true,
    });
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });
}

// ── Inicia servidor Python ─────────────────────────────────────────
function startPythonServer() {
  const scriptPath = path.join(ROOT, 'scripts', 'sofascore_server.py');

  if (!existsSync(scriptPath)) {
    log('SOFA', C.red, 'scripts/sofascore_server.py não encontrado');
    return null;
  }

  log('SOFA', C.yellow, 'Iniciando servidor Python (curl_cffi)...');

  const proc = spawn('python', [`"${scriptPath}"`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    cwd: ROOT,
  });

  proc.stdout?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) log('SOFA', C.green, line);
  });

  proc.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    if (line && !line.includes('WARNING')) log('SOFA', C.red, line);
  });

  proc.on('close', (code) => {
    if (code !== null && code !== 0) {
      log('SOFA', C.red, `Servidor Python encerrou com código ${code}`);
    }
  });

  return proc;
}

// ── Inicia Next.js ─────────────────────────────────────────────────
function startNextDev() {
  log('NEXT', C.cyan, 'Iniciando Next.js dev...');

  const proc = spawn('npx', ['next', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    cwd: ROOT,
  });

  proc.stdout?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) log('NEXT', C.cyan, line);
  });

  proc.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) log('NEXT', C.dim, line);
  });

  return proc;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.green}  Copa Odds — dev com SofaScore${C.reset}`);
  console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log('');

  // Verifica Python deps
  const depsOk = await checkPythonDeps();
  if (!depsOk) {
    log('SETUP', C.yellow, 'Instalando dependências Python...');
    const install = spawn('pip', ['install', 'curl_cffi', 'flask'], {
      stdio: 'inherit',
      shell: true,
    });
    await new Promise((resolve) => install.on('close', resolve));
  }

  // Inicia Python server
  const pythonProc = startPythonServer();

  // Espera o Python subir (5s para dar tempo do Flask iniciar sem erros)
  await new Promise((r) => setTimeout(r, 5000));

  // Inicia Next.js
  const nextProc = startNextDev();

  // Cleanup ao Ctrl+C
  const cleanup = () => {
    log('EXIT', C.yellow, 'Encerrando...');
    pythonProc?.kill();
    nextProc?.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Mostra URLs quando pronto
  setTimeout(() => {
    console.log('');
    console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log(`  ${C.cyan}http://localhost:3000${C.reset}  → App`);
    console.log(`  ${C.green}http://localhost:54545${C.reset} → SofaScore API`);
    console.log(`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log('');
  }, 4000);
}

main();
