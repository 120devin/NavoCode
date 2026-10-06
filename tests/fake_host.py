"""Simulated owning host MCP service; never starts a model or another chat writer."""
import json
from pathlib import Path
import sys

root = Path.cwd()/'.navocode/local'
chat_path = root/'fake-chat.json'
def result(payload): return dict(content=[dict(type='text',text=json.dumps(payload))])
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request: continue
    method = request['method']; params = request.get('params',{})
    try:
        if method == 'initialize': response = dict(protocolVersion='2024-11-05',capabilities=dict(tools={}),serverInfo=dict(name='test-host',version='1'))
        elif method == 'tools/list': response = dict(tools=[dict(name=name) for name in ['read_thread','send_message_to_thread']])
        elif method == 'tools/call':
            name = params['name']; args = params['arguments']; chat = json.loads(chat_path.read_text())
            if args['threadId'] != chat['id']: raise ValueError('Original session not found')
            if params['_meta']['openai/threadId'] != chat['id']: raise ValueError('Wrong caller session')
            if name == 'read_thread':
                turns = chat.get('turns', [])
                busy = chat.get('busyReads',0)>0
                if busy: chat['busyReads']-=1
                chat['reads']=chat.get('reads',0)+1;chat_path.write_text(json.dumps(chat))
                response = result(dict(thread=dict(id='different-chat' if chat.get('wrongThread') else chat['id'],status=dict(type='active' if busy else 'idle')),turns=list(reversed(turns))))
            elif name == 'send_message_to_thread':
                prompt = args['prompt']; context = json.loads(prompt.split('(JSON):\n',1)[1]); text = context['event']['text']
                if text == 'reject': response = dict(isError=True,content=[dict(type='text',text='Permission denied by host')])
                else:
                    reply = chat['originalContext'] if text == 'Recall original conversation' else 'Host reply: '+text
                    chat.setdefault('turns',[]).append(dict(id='turn-'+str(len(chat.get('turns',[]))),status='completed',items=[
                        dict(type='userMessage',content=[dict(type='text',text=prompt)]),
                        dict(type='agentMessage',phase='commentary',text='Working'),
                        dict(type='agentMessage',phase='final_answer',text=reply)]))
                    chat['submissions'] = chat.get('submissions',0)+1
                    chat_path.write_text(json.dumps(chat))
                    if text == 'disconnect once' and chat['submissions']==1: sys.exit(0)
                    response = result(dict(threadId=chat['id']))
            else: raise ValueError('Unsupported host tool')
        else: raise ValueError('Unsupported method')
        print(json.dumps(dict(jsonrpc='2.0',id=request['id'],result=response)),flush=True)
    except Exception as error:
        print(json.dumps(dict(jsonrpc='2.0',id=request['id'],error=dict(code=-32602,message=str(error)))),flush=True)
