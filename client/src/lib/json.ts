// jsonb 값 (작업 로그 변경 전·후, 밀시트 스냅샷). 서버는 jsonb를 그대로 보낸다.
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
