import type { AiActionCard } from '@fantasteel/shared';

/** 키를 붙이기 전의 카드 (종류마다 따로 Omit해야 kind별 칸이 남는다) */
export type ProposedAnyCard = AiActionCard extends infer T ? (T extends unknown ? Omit<T, 'key'> : never) : never;
