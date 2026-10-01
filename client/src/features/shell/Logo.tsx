// FantaSteel 로고 (옛 셸·로그인 화면의 SVG 그대로)
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="block">
      <rect width="24" height="24" rx="4" fill="#FFFFFF" />
      <rect x="6" y="5" width="3" height="14" fill="#173A5E" />
      <rect x="15" y="5" width="3" height="14" fill="#173A5E" />
      <rect x="3" y="10.5" width="18" height="3" fill="#E0762E" />
    </svg>
  );
}
