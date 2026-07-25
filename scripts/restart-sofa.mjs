// Força reinício do servidor SofaScore Python
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('=== Reiniciando servidor SofaScore ===\n');

// 1. Mata todos os Pythons
try {
  execSync('taskkill /f /im python.exe 2>nul', { stdio: 'pipe' });
  console.log('✅ Processos Python finalizados');
} catch {}

try {
  execSync('taskkill /f /im python3.exe 2>nul', { stdio: 'pipe' });
} catch {}

// 2. Aguarda
await new Promise(r => setTimeout(r, 3000));

// 3. Verifica se a porta está livre
try {
  execSync('netstat -ano | findstr :54545', { stdio: 'pipe' });
  console.log('⚠️  Porta 54545 ainda ocupada, aguardando...');
  await new Promise(r => setTimeout(r, 3000));
} catch {
  console.log('✅ Porta 54545 livre');
}

// 4. Inicia o servidor
const serverScript = path.join(root, 'scripts', 'sofascore_server.py');
console.log('\n🚀 Iniciando servidor...');
console.log(`   Script: ${serverScript}`);

const proc = spawn('python', [serverScript], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: true,
  cwd: root,
});

await new Promise(r => setTimeout(r, 5000));

// 5. Testa se está rodando
try {
  const res = await fetch('http://127.0.0.1:54545/live');
  if (res.ok) {
    console.log('✅ Servidor rodando!');
    console.log('   http://127.0.0.1:54545');
  } else {
    console.log('⚠️  Servidor respondeu com status', res.status);
  }
} catch (e) {
  console.log('❌ Servidor não respondeu');
}

console.log('\n=== Pronto ===');
