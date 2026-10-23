# Git 작업 흐름

코드 컨벤션 10장 기준: `main` / `develop` / `feature/{이슈번호}-{기능}`.

```
feature/{이슈번호}-{기능}  ──PR(squash)──▶  develop  ──PR(merge commit)──▶  main
```

| 브랜치 | 용도 | 들어오는 방법 |
|---|---|---|
| `main` | 시연·마감 시점의 안정본 | `develop` → `main` PR. **merge commit**으로 머지한다 (squash로 합치면 두 브랜치 기록이 갈라져 다음 반영 때 충돌) |
| `develop` | 개발 통합 브랜치. GitHub 기본 브랜치 | 구현 브랜치 PR. **squash 머지** |
| `feature/{이슈번호}-{기능}` | 기능 하나 (`fix/…`, `docs/…`도 같은 방식) | `develop`에서 만든다 |

- `main`·`develop`에는 직접 push할 수 없고 PR + 승인 1명이 필요하다. 강제 push·삭제도 막혀 있다.
- 커밋 `feat:`·`fix:`·`refactor:`·`docs:`·`chore:` + 한글 요약. PR 설명에 작업 내용·관련 REQ ID·테스트 방법.

## 1. 평소 작업

```bash
git fetch origin
git switch -c feature/12-sales-order-create origin/develop   # develop에서 새 브랜치
# … 작업 · 커밋 …
git fetch origin && git rebase origin/develop                 # PR 올리기 전에 최신 develop 반영
git push -u origin feature/12-sales-order-create              # rebase 뒤 다시 올릴 때는 --force-with-lease
```

PR은 `develop`으로 연다 (기본 브랜치라 자동으로 잡힌다).

## 2. PR이 머지를 기다리는 동안

- **다음 작업이 앞 PR과 상관없으면:** `origin/develop`에서 새 브랜치를 만들어 계속한다. 기다릴 필요 없다.
- **앞 PR(아직 머지 전)의 코드가 필요하면:** 앞 브랜치 위에 이어서 만든다. 앞 PR이 squash 머지된 뒤에 한 번 옮긴다.
  ```bash
  git fetch origin
  git rebase --onto origin/develop feature/12-앞작업
  ```
  옮기지 않으면 이미 머지된 커밋이 다시 충돌로 나온다. 이어지는 작업은 PR을 작게 나눈다.

## 3. 다른 사람의 PR이 머지됐을 때

머지는 다른 사람의 로컬·브랜치를 바꾸지 않는다. `develop`을 받아올 때 바뀐 파일에 따라 할 일이 생긴다.

| 머지된 PR이 바꾼 것 | 생기는 일 | 할 일 |
|---|---|---|
| 다른 모듈 폴더만 (`server/src/modules/<모듈>/`, `docs/backend/<모듈>.md`) | 없음 | 없음 |
| 내가 고친 파일과 같은 파일 | 내 PR에 "충돌" 표시 | `git fetch && git rebase origin/develop`로 풀고 `--force-with-lease`로 push |
| 내가 부르는 다른 모듈의 서비스 함수 | 받아오면 타입 오류 | 바뀐 모양에 맞춘다. 함수 모양을 바꾸는 쪽은 먼저 알린다 |
| 스키마·마이그레이션 | DB가 옛날 상태 | `npm run dev`가 새 마이그레이션을 자동 적용. 꼬이면 `npm run db:reset` |
| `package.json`·`package-lock.json` | 모듈을 못 찾음 | `npm install` |
| 공통 기반(`server/src/common/`)·`shared/` | 모두에게 영향 | 바꾸기 전에 팀에 알린다 |

모듈 15개는 `app.module.ts`에 미리 등록해 두었고, 공통 코드는 정의서에서 생성한 파일이며, 스키마는 담당자만 바꾼다. 그래서 각자 모듈 안에서만 작업하면 머지 순서가 결과에 거의 영향을 주지 않는다.

## 4. 머지하는 사람

1. PR을 하나씩 머지하고, 머지 뒤 `develop`에서 `npm run typecheck`를 돌린다. 각 PR이 혼자서는 통과해도 합치면 깨질 수 있다 (A가 함수 이름을 바꾸고 B는 예전 이름으로 부르는 경우).
2. "머지 전 최신 develop 반영 필수" 설정은 켜지 않는다. 켜면 하나 머지할 때마다 쌓인 PR이 전부 다시 rebase해야 한다.
3. 다른 모듈이 부르는 함수(모듈 경계: `docs/backend/<모듈>.md`)를 담은 PR은 먼저 머지한다. 함수 이름·인자만 담은 PR을 먼저 올려도 된다.

## 5. develop 도입 전 작업을 옮기기

pull 전에: 자기 `CLAUDE.md`를 고쳐 썼다면 따로 복사해 둔다 (git에 올라가지 않는 각자 파일이라 pull 때 지워지고 `npm install`이 초안에서 다시 만든다).

**아직 작업한 게 없다**

```bash
git fetch origin
git switch develop        # 없으면: git switch -c develop origin/develop
git pull
npm install
npm run db:reset          # 예전에 npm run dev로 DB를 띄운 적이 있다면 (데이터 모두 삭제)
```

**작업 중인데 커밋하지 않았다**

```bash
git stash -u
git fetch origin
git switch -c feature/{이슈번호}-{기능} origin/develop
git stash pop
npm install
```

**개인 브랜치에 커밋해 둔 게 있다** (예: `hmj-branch`)

```bash
git fetch origin
git switch -c feature/{이슈번호}-{기능} origin/develop
git cherry-pick <내 커밋 해시> ...      # git log로 확인. 많으면 git rebase --onto origin/develop <작업 시작 직전 커밋>
npm install
```

옮긴 뒤 예전 개인 브랜치는 지워도 된다.

**`main`으로 열어 둔 PR이 있다:** PR 제목 옆 Edit에서 base를 `develop`으로 바꾼다 (`gh pr edit <번호> --base develop`).

**충돌이 날 때**

- 예전 서버 코드(PR #7 이전)를 고치고 있었다면 충돌이 난다. 예전 코드는 살리지 말고 [SERVER-GUIDE.md](SERVER-GUIDE.md)와 자기 모듈의 [docs/backend/](backend/README.md) 안내를 보고 새 구조로 옮긴다.
- 화면(`client/`)만 고쳤다면 대부분 그대로 옮겨진다.
- 막히면 공유한다. `--force`로 남의 기록을 덮어쓰지 않는다.

적용 후 확인: `npm run typecheck`, `npm run dev` (로그인: [backend/seed.md](backend/seed.md)의 사원번호, 비밀번호 `fantasteel`).
