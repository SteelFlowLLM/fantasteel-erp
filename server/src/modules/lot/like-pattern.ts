/**
 * LIKE 검색어의 % _ \ 를 글자 그대로 찾게 이스케이프한다.
 * Prisma는 contains뿐 아니라 mode: 'insensitive' 의 equals도 ILIKE로 보내며 특수문자를 이스케이프하지 않는다.
 */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);
