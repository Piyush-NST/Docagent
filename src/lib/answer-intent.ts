export type AnswerIntent = 'fact' | 'multi_field' | 'overview' | 'summary' | 'detail' | 'general';

export function classifyAnswerIntent(question: string): AnswerIntent {
  const normalized = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (/^(?:please\s+)?(?:explain|describe|analyze|analyse|break down)\b|\b(explain|describe)\b.*\b(detail|fully|thoroughly)\b|\bdetailed?\s+(explanation|analysis)\b/.test(normalized)) {
    return 'detail';
  }
  const requestedFieldSignals = [
    /\bfees?\b/,
    /\bpayment\b|\bwhere\s+(?:should|do|can)\s+i\s+pay\b/,
    /\b(enrolment|enrollment)\b/,
    /\b(student'?s?\s+)?name\b/,
    /\baddress\b/,
    /\bdate\b/,
    /\bissuer\b|\bwho issued\b/,
    /\bamount\b/,
  ].filter((pattern) => pattern.test(normalized)).length;
  if (/\band\b/.test(normalized) && requestedFieldSignals >= 2) return 'multi_field';
  if (/\b(summarize|summarise|summary|key points|main points|important points|key findings|main findings|key takeaways|main details)\b/.test(normalized)) return 'summary';
  if (/\bwhat (?:should|do) i know\b|\bwhat does (?:this|the) (?:document|letter|file) say\b|\bimportant information\b|\beverything\b|\ball (?:details|information|points)\b/.test(normalized)) {
    return 'summary';
  }
  if (/\bwhat\s+(?:is|s)\s+(?:this|the)\s+(?:document|letter|file)?\s*(?:about|for|purpose)\b|\bpurpose of (?:this|the)\b/.test(normalized)) {
    return 'overview';
  }
  if (/\b(give|show|tell|extract|find|list)\b/.test(normalized) && /\b(and|,|details|fields|information)\b/.test(normalized)) {
    return 'multi_field';
  }
  if (/^(who|what|when|where|which|how many|how much)\b/.test(normalized) || /\b(number|address|email|phone|cgpa|grade|date|amount)\b/.test(normalized)) {
    return 'fact';
  }
  return 'general';
}

export function retrievalQueryForIntent(question: string, intent: AnswerIntent): string {
  if (intent === 'overview') return `${question} document type purpose subject certifies concerns issued`;
  if (intent === 'summary') return `${question} purpose key facts people dates amounts obligations outcome`;
  if (intent === 'detail') return `${question} purpose key facts details people dates amounts obligations sections`;
  if (intent === 'multi_field') return `${question} requested fields amounts names dates payment details`;
  return question;
}

export function topKForIntent(intent: AnswerIntent): number {
  if (intent === 'fact') return 2;
  if (intent === 'multi_field') return 4;
  if (intent === 'overview') return 3;
  if (intent === 'detail') return 6;
  if (intent === 'summary') return 6;
  return 3;
}

export function responseGuidanceForIntent(intent: AnswerIntent): string {
  switch (intent) {
    case 'fact':
      return 'FACT LOOKUP: Return only the requested value and, if useful, one short clarifying sentence. Use answerType "text", put the value in title, and normally use no sections.';
    case 'multi_field':
      return 'MULTI-FIELD LOOKUP: Return only the requested fields as a compact key_value section. Do not include unrequested document content.';
    case 'overview':
      return 'SHORT OVERVIEW: Explain the document type, purpose, and principal subject in 2-4 concise sentences. Omit letterhead contact details and secondary figures unless central to its purpose.';
    case 'summary':
      return 'SUMMARY: Give a 1-2 sentence overview followed by 3-6 concise key points. Include only material facts.';
    case 'detail':
      return 'DETAILED EXPLANATION: Give a clear overview and organized supporting sections. Be thorough but do not reproduce the source text or irrelevant letterhead.';
    default:
      return 'DIRECT ANSWER: Answer the current question first, using the shortest complete response supported by the evidence.';
  }
}
