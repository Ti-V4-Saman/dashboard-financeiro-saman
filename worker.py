import time
import subprocess
import sys
from datetime import datetime

def run_sync():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Iniciando sincronização programada...")
    try:
        # Executa o etl.main sem a flag --full para buscar apenas dados recentes (incremental)
        result = subprocess.run(
            [sys.executable, "-m", "etl.main"], 
            capture_output=True, 
            text=True, 
            encoding='utf-8', 
            errors='replace'
        )
        
        if result.returncode == 0:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Sincronização concluída com sucesso.")
            # Opcional: print(result.stdout) se quiser ver o resumo no terminal
        else:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Erro na sincronização:")
            print(result.stderr)
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Erro ao tentar rodar o subprocesso: {e}")

if __name__ == "__main__":
    INTERVALO_MINUTOS = 15
    print(f"=== Worker de Sincronização Automática Ativado ===")
    print(f"Intervalo: {INTERVALO_MINUTOS} minutos")
    print(f"Pressione Ctrl+C para parar.")
    
    # Roda a primeira vez imediatamente
    run_sync()
    
    while True:
        try:
            time.sleep(INTERVALO_MINUTOS * 60)
            run_sync()
        except KeyboardInterrupt:
            print("\nWorker parado pelo usuário.")
            break
