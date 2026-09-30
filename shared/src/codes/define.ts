/** 코드 그룹의 값 타입: `CodeOf<typeof RESERVATION_STATUS>` */
export type CodeOf<T extends Record<string, string>> = T[keyof T];
