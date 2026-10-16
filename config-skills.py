import json

config_path = r'C:\Users\Administrator\.openclaw\openclaw.json'

with open(config_path, 'r', encoding='utf-8') as f:
    config = json.load(f)

for agent in config['agents']['list']:
    aid = agent['id']
    if aid == 'coordinator':
        agent['skills'] = ['tauri-v2']
    elif aid == 'architect':
        agent['skills'] = [
            'rust-best-practices',
            'tauri-v2',
            'typescript-advanced-types',
            'vercel-react-best-practices'
        ]
    elif aid == 'coder':
        agent['skills'] = [
            'rust-async-patterns',
            'rust-best-practices',
            'tauri-v2',
            'typescript-advanced-types',
            'vercel-react-best-practices',
            'vite',
            'tailwind-design-system'
        ]
    elif aid == 'tester':
        agent['skills'] = [
            'tauri-v2',
            'vite',
            'typescript-advanced-types',
            'vercel-react-best-practices'
        ]

with open(config_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print("Skills configured for each agent:")
for agent in config['agents']['list']:
    print(f"  {agent['id']}: {agent.get('skills', [])}")
