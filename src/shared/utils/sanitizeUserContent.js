import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'span', 'a', 'code', 'pre'];
const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'img', 'svg', 'math'];
const FORBID_ATTR = ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter', 'onmouseleave', 'style'];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

const domPurify = createDOMPurify(window);

function sanitizeValue(value) {
  if (typeof value !== 'string') return value;
  const preStripped = value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '');

  return domPurify.sanitize(preStripped, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
  });
}

export function sanitizeUserContent(value) {
  return sanitizeValue(value);
}

export function sanitizeQuestionPayload(question) {
  if (!question || typeof question !== 'object') return question;
  return {
    ...question,
    label: sanitizeValue(question.label || ''),
    helpText: sanitizeValue(question.helpText || ''),
    fmcsaReference: sanitizeValue(question.fmcsaReference || ''),
    options: Array.isArray(question.options) ? question.options.map((opt) => sanitizeValue(opt || '')) : question.options,
  };
}

