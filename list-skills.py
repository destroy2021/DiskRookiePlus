import subprocess, json

result = subprocess.run(['openclaw.cmd', 'skills', 'list', '--json'], capture_output=True, text=True, shell=True)
try:
    data = json.loads(result.stdout)
except:
    data = json.loads(result.stderr.split('\n')[-1] if result.stderr else '[]')

print("=== Eligible Skills ===")
for s in data:
    if s.get('eligible'):
        print(f"  {s['name']:35s} source={s.get('source',''):25s}")

print(f"\nTotal eligible: {sum(1 for s in data if s.get('eligible'))}")
