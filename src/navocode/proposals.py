"""Revision-bound, typed architectural edits; no code execution."""
import copy
import html
import re
import uuid
from .core import assert_spec, digest, stable, shape, SCHEMA, COLLECTIONS
FIELDS = ('title', 'intent', 'acceptanceCriteria', 'nonGoals', 'unknowns', 'supportingChanges')
MARKER = '<!-- navocode:proposal:v1 -->'

def create(baseline, proposed, context, rationale):
    assert_spec(baseline); assert_spec(proposed)
    if any(baseline[k] != proposed[k] for k in ('changeId', 'baseRef')): raise ValueError('Cannot change specification identity or comparison base')
    operations = []
    for key in COLLECTIONS:
        old = {x['id']: x for x in baseline.get(key, [])}; new = {x['id']: x for x in proposed.get(key, [])}
        for identifier in sorted(old.keys() | new.keys()):
            if old.get(identifier) != new.get(identifier): operations.append(dict(collection=key, id=identifier, expected=digest(old.get(identifier)), value=new.get(identifier)))
    for field in FIELDS:
        if baseline[field] != proposed[field]: operations.append(dict(field=field, expected=digest(baseline[field]), value=proposed[field]))
    if not operations: raise ValueError('The proposal contains no architectural changes')
    return validate(dict(kind='navocode-proposal', schemaVersion='1.0', proposalId=str(uuid.uuid4()), changeId=baseline['changeId'], base=dict(repository=context.get('repository'), number=context.get('number'), headSha=context['headSha'], sourceDigest=baseline['sourceDigest'], specDigest=digest(baseline)), rationale=rationale, operations=operations))

def validate(p):
    if not isinstance(p, dict) or p.get('kind') != 'navocode-proposal' or p.get('schemaVersion') != '1.0' or not re.fullmatch(r'[a-f0-9-]{36}', str(p.get('proposalId', ''))) or not isinstance(p.get('rationale'), str) or not p['rationale'].strip(): raise ValueError('Invalid proposal identity')
    base = p.get('base', {})
    if not re.fullmatch(r'[a-f0-9]{40,64}', str(base.get('headSha', ''))) or any(not re.fullmatch(r'sha256:[a-f0-9]{64}', str(base.get(k, ''))) for k in ('specDigest', 'sourceDigest')): raise ValueError('Invalid proposal binding')
    if base.get('repository') and not re.fullmatch(r'[\w.-]+/[\w.-]+', base['repository']): raise ValueError('Invalid repository')
    if bool(base.get('repository')) != bool(base.get('number')) or (base.get('number') is not None and (type(base['number']) is not int or base['number'] < 1)): raise ValueError('Invalid PR identity')
    if not isinstance(p.get('operations'), list) or not 1 <= len(p['operations']) <= 2000: raise ValueError('Invalid proposal operations')
    targets = set()
    for op in p['operations']:
        if not isinstance(op, dict) or 'value' not in op or not isinstance(op.get('expected'), str): raise ValueError('Invalid operation')
        if 'field' in op:
            if op['field'] not in FIELDS or 'collection' in op or 'id' in op: raise ValueError('Unsupported proposal target')
            target, schema = op['field'], SCHEMA['properties'][op['field']]
        else:
            if op.get('collection') not in COLLECTIONS or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', str(op.get('id', ''))): raise ValueError('Unsupported proposal target')
            target, schema = op['collection'] + '/' + op['id'], SCHEMA['properties'][op['collection']]['items']
            if op['value'] is not None and (not isinstance(op['value'], dict) or op['value'].get('id') != op['id']): raise ValueError('Invalid proposal value')
        if ('field' in op or op['value'] is not None) and shape(op['value'], schema): raise ValueError('Invalid proposal value')
        if target in targets: raise ValueError('Duplicate proposal target')
        targets.add(target)
    if len(stable(p).encode()) > 24576: raise ValueError('Proposal exceeds 24 KiB; split it into focused proposals')
    return p

def apply(spec, proposal, head):
    assert_spec(spec); p = validate(proposal)
    if p.get('changeId') != spec['changeId'] or p['base']['specDigest'] != digest(spec) or p['base']['sourceDigest'] != spec['sourceDigest'] or p['base']['headSha'] != head: raise ValueError('Stale proposal: head or spec changed. Refresh it.')
    next_spec = copy.deepcopy(spec)
    for op in p['operations']:
        if 'field' in op:
            if digest(next_spec[op['field']]) != op['expected']: raise ValueError('Conflict: ' + op['field'])
            next_spec[op['field']] = op['value']
        else:
            items = next_spec.setdefault(op['collection'], []); old = next((x for x in items if x['id'] == op['id']), None)
            if digest(old) != op['expected']: raise ValueError('Conflict: ' + op['id'])
            if old is not None:
                index = items.index(old)
                if op['value'] is None: items.pop(index)
                else: items[index] = op['value']
            elif op['value'] is not None: items.append(op['value'])
    return assert_spec(next_spec)

def comment(proposal):
    p = validate(proposal)
    safe = lambda s: html.escape(str(s)).replace('`', '&#96;')
    edits = []
    for op in p['operations']:
        value = op['value']; obj = value if isinstance(value, dict) else {}
        name = obj.get('name') or obj.get('title') or op.get('field') or op.get('id')
        detail = 'Remove this concept.' if value is None else obj.get('intended') or obj.get('choice') or obj.get('summary') or (value if isinstance(value, str) else 'Update the specification; details below.')
        edits.append(f'- **{safe(name)}:** {safe(detail)}')
    payload = __import__('json').dumps(p, ensure_ascii=False, indent=2).replace('<', '\\u003c').replace('`', '\\u0060')
    return f'{MARKER}\n## NavoCode architectural proposal\n\n{safe(p["rationale"])}\n\n**Based on:** {p["base"].get("repository") or "local repository"}, PR {p["base"].get("number") or "local"}, head `{p["base"]["headSha"]}`.\n\n**Suggested edits:**\n' + '\n'.join(edits) + '\n\n**Status:** Proposed; source is unchanged. Ask your assistant to open this comment and apply the changes you accept.\n\n<details><summary>Structured specification proposal</summary>\n\n```json\n' + payload + '\n```\n</details>\n'

def parse(body):
    if not isinstance(body, str) or len(body) > 65536 or not body.startswith(MARKER): raise ValueError('Not a NavoCode proposal comment')
    match = re.search(r'```json\n([\s\S]*?)\n```', body)
    if not match: raise ValueError('Proposal payload missing')
    return validate(__import__('json').loads(match[1]))
