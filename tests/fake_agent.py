"""Deterministic assistant process for transport tests; makes no model calls."""
import json
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
provider = args[args.index('--fake-provider') + 1] if '--fake-provider' in args else 'custom'
prompt = Path(json.loads(args[-1].split('from this file: ', 1)[1])).read_text() if provider == 'cursor' else sys.stdin.read()
context = json.loads(prompt.split('(JSON):\n', 1)[1])
event = context['event']
identifier = context.get('agentSession')
if provider == 'codex': bound = args[-2] if 'resume' in args else None
elif provider in ('claude', 'cursor'): bound = args[args.index('--resume')+1] if '--resume' in args else None
elif provider == 'copilot': bound = next((arg.split('=',1)[1] for arg in args if arg.startswith('--resume=')), None)
else: bound = identifier
chat_path = Path(context['repo']) / '.navocode/local/fake-chat.json'
chat = json.loads(chat_path.read_text()) if chat_path.exists() else None
if not chat or bound != identifier or chat['id'] != identifier:
    print('Original chat unavailable', file=sys.stderr); sys.exit(2)
folder = Path(context['repo']) / '.navocode/local'
folder.mkdir(parents=True, exist_ok=True)
with (folder / 'fake-invocations.jsonl').open('a') as log:
    log.write(json.dumps(dict(args=args, context=context, pid=os.getpid())) + '\n')
if event['text'] == 'fail once' and not (folder / 'fake-once').exists():
    (folder / 'fake-once').touch(); sys.exit(1)
if event['text'] == 'empty reply': sys.exit(0)
if event['text'] == 'block':
    (folder / 'fake-running').write_text(str(os.getpid()))
    time.sleep(20)
reply = 'Reply: ' + event['text']
if event['text'] == 'Recall original conversation': reply = chat['originalContext']
chat.setdefault('events', []).append(event['id'])
chat_path.write_text(json.dumps(chat))
if context['history'] and event['text'] != 'Recall original conversation': reply += ' | Previous reply: ' + context['history'][-1]['replies'][-1]
if '--output-last-message' in args:
    Path(args[args.index('--output-last-message') + 1]).write_text(reply)
    print(json.dumps(dict(type='thread.started', thread_id=identifier if event['text'] != 'wrong chat' else '00000000-0000-0000-0000-000000000999')))
elif provider == 'claude': print(json.dumps(dict(result=reply, is_error=False, session_id=identifier if event['text'] != 'wrong chat' else '00000000-0000-0000-0000-000000000999')))
else: print(reply)
