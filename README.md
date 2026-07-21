# AquaCycle

Windows와 macOS를 대상으로 한 2D 수중 생태계 시뮬레이션 프로토타입입니다. 현재 구현 범위에는 빛·조류·첫 소비자와 미생물 물질 순환을 다루는 도전 과제 5개, 자유 실험실, 구조물 물리 배치, 광량·수온·수질 측정, 표면 단위 조류 성장, 체리새우의 섭식·번식·사망과 분해균·질산화균 필름이 포함됩니다.

현재 실행본은 V1에서 확인한 문제를 다시 설계한 V2 프로토타입입니다. 한 번 클릭해 집고 다시 클릭해 놓는 배치 방식, 실제 스프라이트 비율과 일치하는 충돌 형상, 구조물 전면의 미세 조류·균 필름, 숫자형 탐침과 위치별 관찰 오버레이를 구현했습니다. 미션 1~4에서는 수질 효과를 꺼 기존 학습 범위를 유지하고, 미션 5와 실험실에서는 유기물·독성 노폐물·영양염·용존산소의 공간 순환과 유한한 무기탄소·닫힌 공기층을 활성화합니다. 조류·새우·균·사체·물의 질소와 탄소는 하나의 보존 장부로 연결됩니다. 세부 기준은 [`docs/V2_REDESIGN.md`](./docs/V2_REDESIGN.md)에 정리되어 있습니다.

## 실행

```bash
npm install
npm start
```

## 검증과 패키징

```bash
npm run typecheck
npm test
npm run package
```

macOS 패키지는 `out/AquaCycle-darwin-*`에 생성됩니다. Windows에서는 같은 프로젝트에서 Squirrel 패키지를 만들도록 Electron Forge가 설정되어 있습니다.

## 구현 구조

- Electron: 데스크톱 창과 배포
- React: 메뉴, 미션, 실험실 UI
- PixiJS: 수조, 조류, 광량 필드 렌더링
- Matter.js: 돌의 중력, 충돌, 회전과 안착
- Web Worker: 물리·광량·성장 시뮬레이션
- 고해상도 두들 스프라이트 + 절차적 조류 표현

장기 기획은 `docs/CORE_GAMEPLAY.md`, 기존 기술 구조는 `docs/MVP_TECHNICAL_ARCHITECTURE.md`, 현재 재구현 기준은 `docs/V2_REDESIGN.md`를 참고하세요.

포함된 글꼴의 출처와 이용 안내는 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)를 참고하세요.
