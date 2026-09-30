export interface MentionCandidate {
  employeeId: number;
  employeeName: string;
}

/**
 * 내용의 `@이름`을 방 멤버 이름과 맞춘다 (화면이 mentionEmployeeIds를 보내지 않았을 때의 대비책).
 * "@김영업님"처럼 조사가 붙는 말이 흔해 이름 뒤 글자는 따지지 않는다.
 * 대신 긴 이름부터 맞추고 맞은 자리는 지워서 "김영"이 "@김영업"에 걸리지 않게 한다.
 * 같은 이름의 멤버가 둘이면 둘 다 멘션으로 본다 (이름만으로는 가릴 수 없다).
 */
export function parseMentions(content: string, members: MentionCandidate[]): number[] {
  if (!content.includes('@')) return [];
  const names = [...new Set(members.map((m) => m.employeeName))].filter(Boolean).sort((a, b) => b.length - a.length);
  let rest = content;
  const hit = new Set<string>();
  for (const name of names) {
    const token = `@${name}`;
    if (!rest.includes(token)) continue;
    hit.add(name);
    rest = rest.split(token).join(' ');
  }
  return members.filter((m) => hit.has(m.employeeName)).map((m) => m.employeeId);
}
