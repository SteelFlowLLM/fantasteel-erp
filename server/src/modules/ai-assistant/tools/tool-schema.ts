// 쓰기 도구 인자의 JSON 스키마 검사 (철강맨AI 승인 카드, 이슈 #362).
// 모델에 알리는 스키마(OpenAI tools parameters)를 그대로 써서, 카드를 보이기 전에 모양이 맞는지 본다.
// 쓰기 도구가 쓰는 만큼(객체 하나, 글·숫자·참거짓 칸)만 본다. 검사 라이브러리를 새로 들이지 않으려고 직접 둔다.

export type ToolPropertySchema =
  | { type: 'string'; description?: string; minLength?: number; maxLength?: number; pattern?: string; enum?: readonly string[] }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; exclusiveMinimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string };

export type ToolParameterSchema = {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required: readonly string[];
  additionalProperties: false;
};

export type ParsedToolArguments = { ok: true; args: Record<string, unknown> } | { ok: false; errors: string[] };

/**
 * 모델이 넘긴 인자 글(JSON)을 읽어 스키마로 확인한다. 틀린 곳을 모두 한글로 돌려줘 모델이 한 번에 고치게 한다.
 * null인 칸은 보내지 않은 것으로 본다(작은 모델이 빈 칸을 null로 채운다).
 */
export function parseToolArguments(raw: string, schema: ToolParameterSchema): ParsedToolArguments {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim() || '{}');
  } catch {
    return { ok: false, errors: ['인자가 JSON이 아니에요'] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, errors: ['인자는 객체여야 해요'] };

  const args = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
  const errors: string[] = [];
  const unknown = Object.keys(args).filter((key) => !Object.hasOwn(schema.properties, key));
  if (unknown.length) errors.push(`없는 인자예요: ${unknown.join(', ')}`);
  for (const key of schema.required) {
    if (args[key] === undefined || args[key] === '') errors.push(`${key}가 필요해요`);
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    const v = args[key];
    if (v === undefined || (v === '' && schema.required.includes(key))) continue;
    const error = propertyError(key, v, property);
    if (error) errors.push(error);
  }
  return errors.length ? { ok: false, errors } : { ok: true, args };
}

function propertyError(key: string, value: unknown, property: ToolPropertySchema): string | null {
  switch (property.type) {
    case 'string': {
      if (typeof value !== 'string') return `${key}는 글이어야 해요`;
      if (property.minLength !== undefined && value.trim().length < property.minLength) return `${key}는 ${property.minLength}자 이상이에요`;
      if (property.maxLength !== undefined && value.length > property.maxLength) return `${key}는 ${property.maxLength}자까지예요`;
      if (property.enum && !property.enum.includes(value)) return `${key}는 ${property.enum.join(', ')} 중 하나예요`;
      if (property.pattern && !new RegExp(property.pattern).test(value)) return `${key}의 형식이 틀렸어요${property.description ? ` (${property.description})` : ''}`;
      return null;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${key}는 숫자여야 해요 (따옴표 없이)`;
      if (property.type === 'integer' && !Number.isInteger(value)) return `${key}는 정수여야 해요`;
      if (property.exclusiveMinimum !== undefined && value <= property.exclusiveMinimum) return `${key}는 ${property.exclusiveMinimum}보다 커야 해요`;
      if (property.minimum !== undefined && value < property.minimum) return `${key}는 ${property.minimum} 이상이에요`;
      if (property.maximum !== undefined && value > property.maximum) return `${key}는 ${property.maximum} 이하예요`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${key}는 true 또는 false여야 해요`;
  }
}
