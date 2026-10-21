// 철강맨AI 패널(AiPanel)은 크고 모든 화면이 쓰지 않아 처음 화면에는 싣지 않고 여는 순간 불러온다.
// 상단 바 단추 위에 마우스를 올리거나 포커스하면 미리 불러 눌렀을 때 바로 열린다.
export const loadAiPanel = () => import('@/features/shell/AiPanel').then((module) => module.AiPanel);
