export type AnswerType = 'profile' | 'summary' | 'list' | 'key_value' | 'comparison' | 'table' | 'text';

export interface AnswerItem {
  text: string;
  citationIds?: number[];
}

export interface KeyValueItem {
  label: string;
  value: string;
  citationIds?: number[];
}

export type AnswerSection =
  | { title?: string; type: 'text'; body: string; citationIds?: number[] }
  | { title?: string; type: 'bullets'; items: AnswerItem[] }
  | { title?: string; type: 'key_value'; items: KeyValueItem[] }
  | { title?: string; type: 'table'; columns: string[]; rows: string[][]; citationIds?: number[] };

export interface StructuredAnswer {
  version: 1;
  answerType: AnswerType;
  title?: string;
  subtitle?: string;
  summary?: string;
  citationIds?: number[];
  sections: AnswerSection[];
}

export type ModelAnswerType = 'fact' | 'overview' | 'summary' | 'detail' | 'synthesis';

export interface ModelAnswerItem {
  label: string;
  value: string;
  citationIds?: number[];
}

export interface ModelStructuredAnswer {
  answer: string;
  answerType: ModelAnswerType;
  citationIds?: number[];
  items: ModelAnswerItem[];
}

export type ModelAnswerParseFailure = 'malformed_json' | 'schema_mismatch';

export interface ModelAnswerParseResult {
  answer?: ModelStructuredAnswer;
  failureReason?: ModelAnswerParseFailure;
  normalizationApplied: string[];
}

const answerTypes = new Set<AnswerType>(['profile', 'summary', 'list', 'key_value', 'comparison', 'table', 'text']);
const sectionTypes = new Set(['text', 'bullets', 'key_value', 'table']);
const MAX_TEXT = 1200;
const MAX_SECTIONS = 8;
const MAX_ITEMS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Expected text');
  const text = value.trim();
  if (!text || text.length > MAX_TEXT) throw new Error('Invalid text length');
  return text;
}

function requiredText(value: unknown): string {
  const text = optionalText(value);
  if (!text) throw new Error('Missing text');
  return text;
}

function citationIds(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new Error('Invalid citations');
  const ids = Array.from(new Set(value));
  if (!ids.every((id) => Number.isInteger(id) && id > 0 && id <= 100)) throw new Error('Invalid citation ID');
  return ids as number[];
}

function parseSection(value: unknown): AnswerSection {
  if (!isRecord(value) || !sectionTypes.has(String(value.type))) throw new Error('Invalid section');
  const title = optionalText(value.title);
  const titled = title ? { title } : {};

  if (value.type === 'text') {
    const ids = citationIds(value.citationIds);
    return { type: 'text', ...titled, body: requiredText(value.body), ...(ids ? { citationIds: ids } : {}) };
  }

  if (value.type === 'bullets') {
    if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
      throw new Error('Invalid bullet items');
    }
    const items = value.items.map((item) => {
      if (typeof item === 'string') return { text: requiredText(item) };
      if (!isRecord(item)) throw new Error('Invalid bullet item');
      const ids = citationIds(item.citationIds);
      return { text: requiredText(item.text), ...(ids ? { citationIds: ids } : {}) };
    });
    return { type: 'bullets', ...titled, items };
  }

  if (value.type === 'key_value') {
    if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
      throw new Error('Invalid key-value items');
    }
    return {
      type: 'key_value',
      ...titled,
      items: value.items.map((item) => {
        if (!isRecord(item)) throw new Error('Invalid key-value item');
        const ids = citationIds(item.citationIds);
        return {
          label: requiredText(item.label),
          value: requiredText(item.value),
          ...(ids ? { citationIds: ids } : {}),
        };
      }),
    };
  }

  if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.length > 8) {
    throw new Error('Invalid table columns');
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 30) {
    throw new Error('Invalid table rows');
  }
  const columns = value.columns.map(requiredText);
  const rows = value.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error('Invalid table row');
    return row.map(requiredText);
  });
  const ids = citationIds(value.citationIds);
  return { type: 'table', ...titled, columns, rows, ...(ids ? { citationIds: ids } : {}) };
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  return first >= 0 && last > first ? raw.slice(first, last + 1) : raw.trim();
}

function normalizeModelJson(raw: string): { json: string; applied: string[] } {
  const applied: string[] = [];
  let json = raw.trim();
  const fenced = json.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    json = fenced[1].trim();
    applied.push('removed_code_fence');
  } else {
    const first = json.indexOf('{');
    if (first > 0) {
      json = json.slice(first);
      applied.push('trimmed_prefix');
    }
    const last = json.lastIndexOf('}');
    if (last >= 0 && last < json.length - 1) {
      json = json.slice(0, last + 1);
      applied.push('trimmed_suffix');
    }
  }

  const smartQuotes = json.replace(/[“”]/g, '"');
  if (smartQuotes !== json) {
    json = smartQuotes;
    applied.push('normalized_smart_quotes');
  }

  const quotedMarkdown = json.replace(/"\*\*([^*"\r\n]+?)\*\*"/g, (_match, value: string) => JSON.stringify(value.trim()));
  if (quotedMarkdown !== json) {
    json = quotedMarkdown;
    applied.push('removed_markdown_emphasis');
  }

  const bareMarkdown = json.replace(
    /:\s*\*\*([^*"\r\n]+?)\*\*(?=\s*[,}\]])/g,
    (_match, value: string) => `: ${JSON.stringify(value.trim())}`,
  );
  if (bareMarkdown !== json) {
    json = bareMarkdown;
    applied.push('quoted_markdown_value');
  }

  const withoutTrailingCommas = json.replace(/,\s*(?=[}\]])/g, '');
  if (withoutTrailingCommas !== json) {
    json = withoutTrailingCommas;
    applied.push('removed_trailing_commas');
  }

  return { json, applied };
}

function parseModelJson(raw: string): unknown {
  const extracted = extractJson(raw);
  try {
    return JSON.parse(extracted);
  } catch (error) {
    // Some models occasionally wrap a bare JSON string value in Markdown emphasis.
    const normalized = extracted.replace(
      /:\s*\*\*([^*"\r\n]+?)\*\*(?=\s*[,}\]])/g,
      (_match, value: string) => `: ${JSON.stringify(value.trim())}`,
    );
    if (normalized === extracted) throw error;
    return JSON.parse(normalized);
  }
}

const modelAnswerTypes = new Set<ModelAnswerType>(['fact', 'overview', 'summary', 'detail', 'synthesis']);

export function parseModelStructuredAnswer(raw: string): ModelAnswerParseResult {
  const normalized = normalizeModelJson(raw);
  let value: unknown;
  try {
    value = JSON.parse(normalized.json);
  } catch {
    return { failureReason: 'malformed_json', normalizationApplied: normalized.applied };
  }

  try {
    if (!isRecord(value) || !modelAnswerTypes.has(value.answerType as ModelAnswerType)) throw new Error('Invalid answer type');
    const answer = requiredText(value.answer);
    if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) throw new Error('Invalid items');
    const ids = citationIds(value.citationIds);
    const items = value.items.map((item) => {
      if (!isRecord(item)) throw new Error('Invalid item');
      const itemIds = citationIds(item.citationIds);
      return {
        label: requiredText(item.label),
        value: requiredText(item.value),
        ...(itemIds ? { citationIds: itemIds } : {}),
      };
    });
    return {
      answer: {
        answer,
        answerType: value.answerType as ModelAnswerType,
        ...(ids ? { citationIds: ids } : {}),
        items,
      },
      normalizationApplied: normalized.applied,
    };
  } catch {
    return { failureReason: 'schema_mismatch', normalizationApplied: normalized.applied };
  }
}

export function modelAnswerToStructuredAnswer(model: ModelStructuredAnswer): StructuredAnswer {
  const missing = /^i couldn't find that information in this document\.?$/i.test(model.answer) || /^not found\.?$/i.test(model.answer);
  const sections: AnswerSection[] = model.items.length > 0
    ? [{ type: 'key_value', title: model.answerType === 'fact' ? undefined : 'Key details', items: model.items }]
    : [];

  if (model.answerType === 'fact') {
    return {
      version: 1,
      answerType: sections.length > 0 ? 'key_value' : 'text',
      title: missing ? 'Not found' : model.answer,
      ...(missing ? { summary: model.answer } : {}),
      ...(model.citationIds ? { citationIds: model.citationIds } : {}),
      sections,
    };
  }

  return {
    version: 1,
    answerType: model.answerType === 'overview' ? 'text' : 'summary',
    ...(missing ? { title: 'Not found' } : {}),
    summary: model.answer,
    ...(model.citationIds ? { citationIds: model.citationIds } : {}),
    sections,
  };
}

export function parseStructuredAnswer(raw: string | unknown): StructuredAnswer | null {
  try {
    const value = typeof raw === 'string' ? parseModelJson(raw) : raw;
    if (!isRecord(value) || value.version !== 1 || !answerTypes.has(value.answerType as AnswerType)) return null;
    if (!Array.isArray(value.sections) || value.sections.length > MAX_SECTIONS) return null;

    const title = optionalText(value.title);
    const subtitle = optionalText(value.subtitle);
    const summary = optionalText(value.summary);
    const ids = citationIds(value.citationIds);
    const answer: StructuredAnswer = {
      version: 1,
      answerType: value.answerType as AnswerType,
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(summary ? { summary } : {}),
      ...(ids ? { citationIds: ids } : {}),
      sections: value.sections.map(parseSection),
    };

    const hasContent = answer.title || answer.subtitle || answer.summary || answer.sections.length > 0;
    return hasContent ? answer : null;
  } catch {
    return null;
  }
}

export function structuredAnswerToMarkdown(answer: StructuredAnswer): string {
  const output: string[] = [];
  if (answer.title) output.push(`# ${answer.title}`);
  if (answer.subtitle) output.push(answer.subtitle);
  if (answer.summary) output.push(answer.summary);

  for (const section of answer.sections) {
    if (section.title) output.push(`## ${section.title}`);
    if (section.type === 'text') output.push(section.body);
    if (section.type === 'bullets') output.push(section.items.map((item) => `- ${item.text}`).join('\n'));
    if (section.type === 'key_value') output.push(section.items.map((item) => `${item.label}: ${item.value}`).join('\n'));
    if (section.type === 'table') {
      output.push(`| ${section.columns.join(' | ')} |\n| ${section.columns.map(() => '---').join(' | ')} |\n${section.rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}`);
    }
  }
  return output.filter(Boolean).join('\n\n');
}

export function collectStructuredCitationIds(answer: StructuredAnswer): number[] {
  const ids = new Set(answer.citationIds || []);
  for (const section of answer.sections) {
    if ('citationIds' in section) section.citationIds?.forEach((id) => ids.add(id));
    if (section.type === 'bullets' || section.type === 'key_value') {
      section.items.forEach((item) => item.citationIds?.forEach((id) => ids.add(id)));
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export function friendlyDocumentName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[a-z0-9]{1,6}$/i, '').trim();
  const withoutCopies = withoutExtension.replace(/(?:\s*\(\d+\))+\s*$/g, '').trim();
  const normalized = withoutCopies.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Document';

  const resume = normalized.match(/^resume[-\s]+(.+)$/i);
  if (resume?.[1]) {
    const person = resume[1]
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return `Resume — ${person}`;
  }

  return normalized.length > 34 ? `${normalized.slice(0, 33).trim()}…` : normalized;
}
