# 💬 채팅 놀이터 (chat-playland)

교실용 실시간 채팅 게임 웹입니다. 단일 정적 페이지(GitHub Pages) + Firebase(Firestore, 익명 인증)로 동작하며, 별도 서버가 필요 없습니다.

## 기능

- **로그인**: 익명 인증 + 닉네임(4자 제한) + 캔버스로 직접 그린 나만의 배경(아바타)
- **방 시스템**: 방 열기(게임 종류 선택) / 참가하기, 방 목록에서 게임 종류·인원수 확인
- **게임 종류**
  - 💬 그냥 채팅 — 자유 채팅
  - 🔤 끝말잇기 — 턴제, 20초 제한시간, 시간 초과 시 탈락, 마지막 1인 우승
  - 🚫 금지어 게임 — 라운드마다 금지어 지정(직접 입력 또는 랜덤), 채팅 중 실수로 말하면 경고(3회 누적 시 탈락)
  - 🕵️ 범인을 찾아라(단어 마피아) — 시민에게만 제시어 공개, 마피아는 눈치로 설명, 투표로 범인 지목
- **데이터 규칙**: 방이 비거나(마지막 인원 퇴장) 방장이 방을 닫으면 해당 방의 채팅/참가자/비밀정보가 모두 삭제됩니다.

## 시작하기 전에: Firebase 프로젝트 만들기

이 프로젝트는 **학민증권시장과 별개의, 새 Firebase 프로젝트**를 사용합니다. 아래 순서대로 진행해주세요.

1. https://console.firebase.google.com 접속 → 구글 계정으로 로그인 → **"프로젝트 추가"**
   - 프로젝트 이름: 예) `chat-playland` (원하는 이름으로 가능)
   - Google Analytics는 꺼도 무방합니다.
2. 왼쪽 메뉴 **빌드 > Authentication** → "시작하기" → **로그인 방법** 탭 → **익명(Anonymous)** 사용 설정
3. 왼쪽 메뉴 **빌드 > Firestore Database** → "데이터베이스 만들기" → 위치는 `asia-northeast3(서울)` 권장 → **테스트 모드**로 우선 시작
4. Firestore가 만들어지면 **규칙(Rules)** 탭으로 이동 → 이 저장소의 `firestore.rules` 파일 내용을 그대로 붙여넣고 **게시(Publish)**
5. 프로젝트 개요(⚙️ 톱니바퀴) → **프로젝트 설정** → 아래로 스크롤 → **"내 앱"**에서 웹 아이콘(`</>`)으로 웹 앱 추가
   - 앱 닉네임: `chat-playland` (아무거나 가능)
   - Firebase Hosting은 체크하지 않아도 됩니다 (GitHub Pages를 사용하므로)
6. 발급된 `firebaseConfig` 값을 복사해서 `app.js` 맨 위의 `firebaseConfig` 객체 자리(`REPLACE_ME` 부분)에 붙여넣기

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

> `apiKey`는 비밀번호가 아니라 클라이언트 식별용 값이라 코드에 그대로 넣어도 괜찮습니다. 실제 보안은 Firestore 규칙(`firestore.rules`)이 담당합니다.

## GitHub Pages로 배포하기

1. 이 저장소의 **Settings > Pages** 메뉴로 이동
2. **Source**를 `Deploy from a branch`로, **Branch**는 `main` / `/(root)`로 설정 후 저장
3. 잠시 후 `https://pet9598-art.github.io/chat-playland/` 에서 접속 가능

## 파일 구조

```
index.html          화면 구조 + 스타일
app.js               공통 로직 (로그인, 아바타, 방 목록/생성/입장/퇴장, 채팅)
game-wordchain.js    끝말잇기 게임 로직
game-forbidden.js    금지어 게임 로직
game-mafia.js        범인을 찾아라(단어 마피아) 게임 로직
firestore.rules      Firestore 보안 규칙
```

## 알아두면 좋은 점

- 브라우저를 그냥 닫으면(뒤로가기 없이) 자동 퇴장 처리가 100% 보장되지 않습니다. 방장이 "방 닫기"를 눌러 정리하거나, 30분 이상 방치된 빈 방은 다음에 로비를 여는 사람의 기기에서 자동으로 정리됩니다.
- 끝말잇기의 시간 초과 판정은 "내 차례인 사람의 브라우저"가 직접 처리합니다. 해당 학생이 탭을 닫아버리면 자동으로 넘어가지 않을 수 있으니, 방장의 "강제 넘기기" 버튼을 이용해주세요.
- 단어 마피아의 제시어/역할은 `secrets` 서브컬렉션에 저장되고, Firestore 규칙으로 "본인 또는 방장"만 읽을 수 있게 막혀 있어 다른 학생 화면에서는 절대 보이지 않습니다.
