/**
 * A small, strict JSON Schema validator for AI output.
 *
 * Why hand-rolled rather than a library: the schemas here are written by
 * SafeHaul, not by users, so we only need the subset we actually emit, and a
 * validator with no remote-ref loading, no coercion and no `$ref` resolution
 * has a much smaller surface than a general-purpose one. Every unsupported
 * keyword is ignored rather than silently treated as a pass — the supported
 * set below is the contract.
 *
 * Supported: type (object/array/string/number/integer/boolean/null),
 * properties, required, additionalProperties (false only), enum, items,
 * minItems, maxItems, minLength, maxLength, minimum, maximum, pattern.
 *
 * The validator is deliberately strict about `additionalProperties: false`
 * because that is what stops a vendor smuggling extra keys into a structure
 * the rest of the application then trusts.
 */

const MAX_DEPTH = 12;

function typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function matchesType(value, expected) {
    if (expected === 'integer') return Number.isInteger(value);
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeOf(value) === expected;
}

/**
 * @param {unknown} value parsed JSON from a provider
 * @param {object} schema JSON Schema subset
 * @param {string} [path] JSON pointer-ish path used in error text
 * @param {number} [depth]
 * @returns {string[]} list of human-readable violations; empty means valid
 */
function collectViolations(value, schema, path = '$', depth = 0) {
    if (depth > MAX_DEPTH) return [`${path}: schema nested too deeply`];
    if (!schema || typeof schema !== 'object') return [];

    const errors = [];

    if (schema.type) {
        const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!expected.some((candidate) => matchesType(value, candidate))) {
            errors.push(`${path}: expected ${expected.join(' or ')}, received ${typeOf(value)}`);
            // Type is wrong, so every keyword below would produce noise.
            return errors;
        }
    }

    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        errors.push(`${path}: value is not one of the permitted options`);
    }

    if (typeof value === 'string') {
        if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
            errors.push(`${path}: shorter than ${schema.minLength} characters`);
        }
        if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
            errors.push(`${path}: longer than ${schema.maxLength} characters`);
        }
        if (typeof schema.pattern === 'string') {
            let re = null;
            try {
                re = new RegExp(schema.pattern);
            } catch {
                errors.push(`${path}: schema pattern is not a valid expression`);
            }
            if (re && !re.test(value)) errors.push(`${path}: does not match the required format`);
        }
    }

    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            errors.push(`${path}: below minimum ${schema.minimum}`);
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            errors.push(`${path}: above maximum ${schema.maximum}`);
        }
    }

    if (Array.isArray(value)) {
        if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
            errors.push(`${path}: fewer than ${schema.minItems} items`);
        }
        if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
            errors.push(`${path}: more than ${schema.maxItems} items`);
        }
        if (schema.items) {
            value.forEach((entry, index) => {
                errors.push(...collectViolations(entry, schema.items, `${path}[${index}]`, depth + 1));
            });
        }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const properties = schema.properties || {};
        const required = Array.isArray(schema.required) ? schema.required : [];

        for (const key of required) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                errors.push(`${path}.${key}: required property is missing`);
            }
        }

        if (schema.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!Object.prototype.hasOwnProperty.call(properties, key)) {
                    errors.push(`${path}.${key}: unexpected property`);
                }
            }
        }

        for (const [key, childSchema] of Object.entries(properties)) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            errors.push(...collectViolations(value[key], childSchema, `${path}.${key}`, depth + 1));
        }
    }

    return errors;
}

/**
 * @param {unknown} value
 * @param {object} schema
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAgainstSchema(value, schema) {
    const errors = collectViolations(value, schema);
    return { valid: errors.length === 0, errors };
}

/**
 * Pulls a JSON object out of model text.
 *
 * Providers wrap JSON in prose, in fenced code blocks, or in nothing at all
 * depending on the vendor and the day. Every one of those shapes is handled
 * here rather than in nine adapters.
 *
 * @param {string} text
 * @returns {object|null} parsed object, or null when there isn't one
 */
function extractJsonObject(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const candidates = [trimmed];

    // Fenced block, with or without a language tag.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) candidates.push(fenced[1].trim());

    // Outermost brace pair, for prose-wrapped output.
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            // Try the next shape.
        }
    }
    return null;
}

module.exports = { validateAgainstSchema, extractJsonObject, collectViolations };
