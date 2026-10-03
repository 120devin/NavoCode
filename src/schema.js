// This small schema uses only the JSON Schema keywords implemented by validateShape.
const text = { type: 'string', maxLength: 20000 };
const nonempty = { ...text, minLength: 1 };
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' };
const list = items => ({ type: 'array', items, maxItems: 2000 });
const strings = list(nonempty);
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const choice = values => ({ type: 'string', enum: values });
export const specSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'NavoCode change specification',
  ...object({
    schemaVersion: { const: '1.0' }, changeId: id, title: nonempty, intent: nonempty,
    baseRef: nonempty, sourceDigest: text,
    groups: list(object({ id, title: nonempty, summary: text, componentIds: list(id), decisionIds: list(id), paths: strings })),
    components: list(object({ id, name: nonempty, current: text, intended: text, observed: text })),
    relations: list(object({ id, from: id, to: id, label: nonempty, state: choice(['current', 'intended', 'both']) })),
    decisions: list(object({ id, title: nonempty, choice: text, alternatives: strings, consequences: strings, status: choice(['proposed', 'accepted']), provenance: choice(['agent', 'human']), evidenceIds: list(id) })),
    evidence: list(object({ id, claim: nonempty, kind: choice(['source', 'test', 'inference']), status: choice(['supported', 'unverified', 'failed']), detail: text, paths: strings, sourceDigest: text })),
    acceptanceCriteria: strings, nonGoals: strings, unknowns: strings,
    supportingChanges: list(object({ path: nonempty, reason: nonempty }))
  })
};
export function validateShape(value, schema = specSchema, path = '$', errors = []) {
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: expected ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: invalid option`);
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && type !== schema.type) { errors.push(`${path}: expected ${schema.type}`); return errors; }
  if (type === 'string') {
    if (schema.minLength && value.trim().length < schema.minLength) errors.push(`${path}: must not be empty`);
    if (schema.maxLength && value.length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: invalid identifier`);
  }
  if (type === 'array') {
    if (value.length > schema.maxItems) errors.push(`${path}: too many items`);
    value.forEach((v, i) => validateShape(v, schema.items, `${path}[${i}]`, errors));
  }
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) { if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown field`); }
      else validateShape(v, schema.properties[key], `${path}.${key}`, errors);
    }
  }
  return errors;
}
