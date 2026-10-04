"""Advisory sentence-length checks, not an ASD-STE100 compliance checker."""
import re


def check_writing(spec):
    warnings = []

    def check(path, text, limit=25):
        for sentence in re.split(r'(?<=[.!?])\s+', text.strip()):
            count = len(sentence.split())
            if count > limit:
                warnings.append(dict(field=path, words=count, limit=limit, message=f'Split this sentence: {count} words (target {limit}).'))

    for field in ('title', 'intent'):
        check(field, spec[field])
    fields = {'groups': ('summary',), 'components': ('current', 'intended', 'observed', 'risk'), 'relations': ('label', 'failure'), 'decisions': ('choice',), 'evidence': ('claim', 'detail')}
    for collection, names in fields.items():
        for item in spec.get(collection, []):
            for field in names:
                check(f'{collection}/{item["id"]}/{field}', item.get(field, ''))
    for scenario in spec.get('scenarios', []):
        for field in ('trigger', 'outcome'):
            check(f'scenarios/{scenario["id"]}/{field}', scenario[field])
        for version in ('current', 'intended'):
            for step in scenario[version]:
                check(f'scenarios/{scenario["id"]}/{version}/{step["id"]}', step.get('description', ''), 20)
    for field in ('acceptanceCriteria', 'nonGoals', 'unknowns'):
        for index, text in enumerate(spec[field]):
            check(f'{field}/{index}', text)
    return warnings
