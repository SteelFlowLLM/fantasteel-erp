'use client';

// 화면 도우미 펫(철강맨). public/pet/의 엔진·캐릭터·설명을 순서대로 불러 셸 위에 붙인다. 화면에는 아무것도 그리지 않는다.
// 엔진은 data-pet-target·data-pet-perch·data-pet-climb 속성만 보고 움직이므로, 화면마다 할 일은 속성을 다는 것뿐이다.
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { aiAssistantApi } from '@/api/aiAssistant';
import { sourceText } from '@/features/shell/AiPanel';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { SCREEN, screenOfPath, SCREEN_KEY_BY_HREF } from '@/features/shell/screens';
import { useMe } from '@/hooks/useMe';
import { errorMessageOf } from '@/stores/useToastStore';

const CHARACTERS = ['steelman', 'steelman_old', 'harin_office', 'gocheol', 'poseokho', 'coil'];
/** 영역별 화면 설명. 파일 하나가 window.FANTA_PET_GUIDE_PARTS에 한 묶음을 넣고, guide-merge.js가 기본 설명에 합친다. */
const GUIDE_PARTS = ['terms', 'common', 'dashboard', 'sales', 'purchasing', 'production', 'logistics-admin'];
const PET_FILES = [
  ...CHARACTERS.map((id) => `/pet/characters/${id}.js`),
  '/pet/guide-content.js',
  ...GUIDE_PARTS.map((id) => `/pet/guide/${id}.js`),
  '/pet/guide-merge.js',
  '/pet/props/ladder.js',
  '/pet/pet-engine.js',
];

// StrictMode에서 effect가 두 번 돌아도 같은 로딩을 기다리게 모듈에 둔다
const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const hit = loading.get(src);
  if (hit) return hit;
  const promise = new Promise<void>((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false; // 넣은 순서대로 실행
    el.onload = () => resolve();
    el.onerror = () => resolve(); // 없는 파일은 건너뛰고 나머지로 돈다
    document.head.appendChild(el);
  });
  loading.set(src, promise);
  return promise;
}

/** SCREEN 키 → 주소. 다른 화면의 카드를 물으면 펫이 그 화면으로 데려갈 때 쓴다 */
const SCREEN_HREFS: Record<string, string> = Object.fromEntries(Object.entries(SCREEN).map(([key, def]) => [key, def.href]));

function screenKeyOf(pathname: string): string | null {
  const screen = screenOfPath(pathname);
  return screen ? (SCREEN_KEY_BY_HREF.get(screen.href) ?? null) : null;
}

/** 펫 대화 창의 AI 연결(ON): AI 어시스턴트 패널과 같은 API에 지금 화면을 함께 보낸다 (REQ-AST-007). 대화 기록은 펫 창 것만 쓴다 */
const askAi: NonNullable<FantaPetMountOptions['askAi']> = async (question, history) => {
  const { pathname, search } = window.location;
  try {
    const reply = await aiAssistantApi.ask({
      question,
      screen: { path: `${pathname}${search}`, title: routeTitleOf(pathname).title || '대시보드', label: null },
      history,
    });
    return { text: reply.answer, sources: reply.sources.map(sourceText) };
  } catch (error) {
    throw new Error(errorMessageOf(error));
  }
};

export function PetMount() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  routerRef.current = router;
  const screenRef = useRef<string | null>(null);
  screenRef.current = screenKeyOf(pathname);

  useEffect(() => {
    let alive = true;
    void Promise.all(PET_FILES.map(loadScript)).then(() => {
      if (!alive || !window.FantaPet) return;
      window.FantaPet.mount({
        defaultCharacter: 'steelman',
        storageKey: `fantapet:${me.employeeId}`,
        zIndex: 50,
        user: { name: me.employeeName, gradeName: me.jobGradeName, departmentName: me.departmentName, roleCode: me.roleCode },
        screen: screenRef.current,
        screenHrefs: SCREEN_HREFS,
        navigate: (href: string) => routerRef.current.push(href),
        askAi,
      });
    });
    return () => {
      alive = false;
      window.FantaPet?.destroy();
    };
  }, [me.employeeId, me.employeeName, me.jobGradeName, me.departmentName, me.roleCode]);

  const screenKey = screenKeyOf(pathname);
  useEffect(() => {
    window.FantaPet?.setScreen?.(screenKey);
  }, [screenKey]);

  return null;
}
