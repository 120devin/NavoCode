import { randomUUID } from 'node:crypto';
import { assertSpec, hash, stable } from './core.js';
import { specSchema, validateShape } from './schema.js';
const collections = ['groups', 'components', 'relations', 'decisions', 'evidence'];
const fields = ['title', 'intent', 'acceptanceCriteria', 'nonGoals', 'unknowns', 'supportingChanges'];
export const MARKER = '<!-- navocode:proposal:v1 -->';
export function createProposal(baseline, proposed, context, rationale) {
  assertSpec(baseline); assertSpec(proposed);
  if (baseline.changeId !== proposed.changeId || baseline.baseRef !== proposed.baseRef) throw Error('Cannot change specification identity or comparison base in a proposal');
  if (!rationale?.trim()) throw Error('A proposal needs a rationale');
  const operations = [];
  for (const collection of collections) {
    const old = new Map(baseline[collection].map(x => [x.id, x]));
    const next = new Map(proposed[collection].map(x => [x.id, x]));
    for (const id of new Set([...old.keys(), ...next.keys()])) if (stable(old.get(id) ?? null) !== stable(next.get(id) ?? null)) operations.push({ collection, id, expected: hash(old.get(id) ?? null), value: next.get(id) ?? null });
  }
  for (const field of fields) if (stable(baseline[field]) !== stable(proposed[field])) operations.push({ field, expected: hash(baseline[field]), value: proposed[field] });
  if (!operations.length) throw Error('The proposal contains no architectural changes');
  return { kind: 'navocode-proposal', schemaVersion: '1.0', proposalId: randomUUID(), changeId: baseline.changeId, base: { repository: context.repository || null, number: context.number || null, headSha: context.headSha, sourceDigest: baseline.sourceDigest, specDigest: hash(baseline) }, rationale, operations };
}
export function validateProposal(p) {
  if (!p || p.kind !== 'navocode-proposal' || p.schemaVersion !== '1.0' || typeof p.proposalId !== 'string' || !/^[a-f0-9-]{36}$/.test(p.proposalId) || typeof p.changeId !== 'string' || typeof p.rationale !== 'string' || !p.rationale.trim()) throw Error('Invalid proposal identity');
  if (!p.base || !/^[a-f0-9]{40,64}$/.test(p.base.headSha) || !/^sha256:[a-f0-9]{64}$/.test(p.base.specDigest) || !/^sha256:[a-f0-9]{64}$/.test(p.base.sourceDigest)) throw Error('Invalid proposal binding');
  if (p.base.repository !== null && !/^[\w.-]+\/[\w.-]+$/.test(p.base.repository)) throw Error('Invalid proposal repository');
  if (p.base.number !== null && (!Number.isSafeInteger(p.base.number) || p.base.number < 1)) throw Error('Invalid PR number');
  if (Boolean(p.base.repository) !== Boolean(p.base.number)) throw Error('Incomplete PR identity');
  if (!Array.isArray(p.operations) || p.operations.length < 1 || p.operations.length > 2000) throw Error('Invalid proposal operations');
  const targets = new Set();
  for (const op of p.operations) {
    if (typeof op.expected !== 'string' || !Object.hasOwn(op, 'value')) throw Error('Invalid proposal operation');
    const fieldOp = Object.hasOwn(op, 'field');
    if (fieldOp ? !fields.includes(op.field) || op.collection !== undefined || op.id !== undefined : !collections.includes(op.collection) || typeof op.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(op.id) || (op.value !== null && op.value?.id !== op.id)) throw Error('Unsupported proposal target');
    const valueSchema = fieldOp ? specSchema.properties[op.field] : specSchema.properties[op.collection].items;
    if ((fieldOp || op.value !== null) && validateShape(op.value, valueSchema).length) throw Error('Invalid proposal value');
    const target = fieldOp ? op.field : `${op.collection}/${op.id}`;
    if (targets.has(target)) throw Error('Duplicate proposal target');
    targets.add(target);
  }
  if (Buffer.byteLength(JSON.stringify(p)) > 24576) throw Error('Proposal exceeds 24 KiB; split it into focused proposals');
  return p;
}
export function applyProposal(spec, proposal, headSha) {
  assertSpec(spec); const p = validateProposal(proposal);
  if (p.changeId !== spec.changeId || p.base.specDigest !== hash(spec) || p.base.sourceDigest !== spec.sourceDigest || p.base.headSha !== headSha) throw Error('Stale proposal: PR head or specification changed. Reopen and refresh the proposal.');
  const next = structuredClone(spec);
  for (const op of p.operations) {
    if (op.field) {
      if (hash(next[op.field]) !== op.expected) throw Error(`Conflict: ${op.field}`);
      next[op.field] = op.value;
    } else {
      const index = next[op.collection].findIndex(x => x.id === op.id);
      if (hash(index < 0 ? null : next[op.collection][index]) !== op.expected) throw Error(`Conflict: ${op.id}`);
      if (op.value === null) next[op.collection].splice(index, 1);
      else if (index < 0) next[op.collection].push(op.value);
      else next[op.collection][index] = op.value;
    }
  }
  return assertSpec(next);
}
export function proposalComment(proposal) {
  const p = validateProposal(proposal);
  const rationale = p.rationale.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, '&#96;');
  const readable = p.operations.map(op => {
    const name = op.value?.name || op.value?.title || op.field || op.id;
    const detail = op.value === null ? 'Remove this concept.' : op.value?.intended || op.value?.choice || op.value?.summary || (typeof op.value === 'string' ? op.value : 'Update the specification; details below.');
    return `- **${String(name).replace(/[<>`\r\n]/g, ' ')}:** ${detail.replace(/[<>`]/g, ' ')}`;
  }).join('\n');
  // Escape < to prevent closing the details section; JSON.parse restores the original data.
  const payload = JSON.stringify(p, null, 2).replace(/</g, '\\u003c').replace(/`/g, '\\u0060');
  return `${MARKER}\n## NavoCode architectural proposal\n\n${rationale}\n\n**Based on:** ${p.base.repository || 'local repository'}${p.base.number ? ` PR #${p.base.number}` : ''}, head \`${p.base.headSha}\`.\n\n**Suggested edits:**\n${readable}\n\n**Status:** Proposed; source code has not changed. Ask your assistant to open this comment in NavoCode and apply the changes you accept.\n\n<details><summary>Structured specification proposal</summary>\n\n\`\`\`json\n${payload}\n\`\`\`\n</details>\n`;
}
export function parseComment(body) {
  if (typeof body !== 'string' || body.length > 65536 || !body.startsWith(MARKER)) throw Error('Not a NavoCode proposal comment');
  const match = body.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw Error('Proposal payload missing');
  return validateProposal(JSON.parse(match[1]));
}
