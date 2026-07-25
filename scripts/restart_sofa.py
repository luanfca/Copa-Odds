"""Reinicia o servidor SofaScore."""
import subprocess
import time
import sys
import os

print("=== Reiniciando servidor SofaScore ===")

# 1. Mata todos os processos Python existentes
print("Matando processos Python...")
subprocess.run("taskkill /f /im python.exe 2>nul", shell=True, capture_output=True)
subprocess.run("taskkill /f /im python3.exe 2>nul", shell=True, capture_output=True)
time.sleep(2)

# 2. Verifica se a porta está livre
result = subprocess.run("netstat -ano | findstr :54545", shell=True, capture_output=True, text=True)
if result.returncode == 0:
    print("Porta 54545 ocupada, aguardando...")
    time.sleep(3)
else:
    print("Porta 54545 livre")

# 3. Inicia o servidor
script = os.path.join(os.path.dirname(__file__), "sofascore_server.py")
print(f"Iniciando servidor: {script}")

proc = subprocess.Popen(
    [sys.executable, script],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    cwd=os.path.dirname(__file__)
)

time.sleep(4)

# 4. Testa se está rodando
import urllib.request
try:
    resp = urllib.request.urlopen("http://127.0.0.1:54545/live", timeout=3)
    if resp.status == 200:
        print("✅ Servidor SofaScore rodando!")
    else:
        print(f"⚠️ Servidor respondeu com status {resp.status}")
except Exception as e:
    print(f"❌ Servidor não respondeu: {e}")

print("=== Pronto ===")
