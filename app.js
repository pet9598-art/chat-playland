/* ========================================================================
   채팅 놀이터 (chat-playland) - app.js
   단일 정적 페이지 + Firebase(Firestore/Auth) 실시간 채팅 게임 웹
   ======================================================================== */

/* ------------------------------------------------------------------
   0. Firebase 설정 — Firebase 콘솔에서 만든 프로젝트의 config 값으로
      아래 placeholder를 반드시 교체하세요! (README 참고)
   ------------------------------------------------------------------ */
const firebaseConfig = {
  apiKey: "AIzaSyDVh6a7eg4NbdNHbVRrDChJ8gJcDP1Zmjs",
  authDomain: "chatpaly-80f4d.firebaseapp.com",
  projectId: "chatpaly-80f4d",
  storageBucket: "chatpaly-80f4d.firebasestorage.app",
  messagingSenderId: "456899549142",
  appId: "1:456899549142:web:5df94fb959eaff9f65b677"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

/* ------------------------------------------------------------------
   1. 게임 종류 메타데이터
   ------------------------------------------------------------------ */
const GAME_TYPES = {
  chat:      { emoji: "💬", label: "그냥 채팅",     color: "#3dc3ff", desc: "자유롭게 대화만 나눠요" },
  wordchain: { emoji: "🔤", label: "끝말잇기",       color: "#6bd67a", desc: "앞 단어의 끝글자로 시작!" },
  forbidden: { emoji: "🚫", label: "금지어 게임",    color: "#ff8a3d", desc: "정해진 금지어를 말하면 아웃" },
  mafia:     { emoji: "🕵️", label: "범인을 찾아라",  color: "#c88bff", desc: "단어 마피아를 찾아내세요" }
};

const MAFIA_WORDS = [
  "사과","바나나","호랑이","코끼리","축구공","우산","연필","냉장고","피아노","자전거",
  "눈사람","선풍기","도서관","놀이터","무지개","케이크","텔레비전","우주선","공룡","돋보기",
  "젓가락","비행기","스케이트","김치","떡볶이","고양이","강아지","거북이","불꽃놀이","눈썹"
];

const FORBIDDEN_WORD_BANK = [
  "그냥","진짜","완전","대박","아니","근데","약간","좀","엄청","솔직히"
];

/* ------------------------------------------------------------------
   2. 상태
   ------------------------------------------------------------------ */
let me = null;            // firebase auth user
let myNickname = "";
let myAvatar = "";        // dataURL
let currentRoomId = null;
let currentRoom = null;   // room doc 캐시
let players = {};         // uid -> player data 캐시
let unsubRoom = null, unsubPlayers = null, unsubMessages = null, unsubRoomList = null, unsubSecret = null;
let selectedGameType = "chat";
let wcTimerInterval = null;
let mySecret = null; // 단어 마피아: 나의 비밀 역할/단어

/* ------------------------------------------------------------------
   3. 유틸
   ------------------------------------------------------------------ */
function $(sel){ return document.querySelector(sel); }
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $("#"+id).classList.add("active");
}
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove("show"), 1800);
}
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function randomFrom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

/* ------------------------------------------------------------------
   4. 아바타 그리기 (캔버스)
   ------------------------------------------------------------------ */
const COLORS = ["#ff5d5d","#ff8a3d","#ffd23d","#6bd67a","#3dc3ff","#6b7bff","#c88bff","#ff8ac2","#8a6a4a","#33291f","#ffffff"];
let brushColor = COLORS[0];
let brushSize = 6;
let drawing = false;

function initAvatarCanvas(){
  const canvas = $("#avatarCanvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff7e8";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const pal = $("#palette");
  COLORS.forEach((c,i)=>{
    const sw = document.createElement("div");
    sw.className = "swatch" + (i===0 ? " active" : "");
    sw.style.background = c;
    sw.addEventListener("click", ()=>{
      brushColor = c;
      document.querySelectorAll(".swatch").forEach(s=>s.classList.remove("active"));
      sw.classList.add("active");
    });
    pal.appendChild(sw);
  });

  function pos(e){
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (canvas.width/rect.width),
             y: (t.clientY - rect.top) * (canvas.height/rect.height) };
  }
  function start(e){ drawing = true; draw(e); e.preventDefault(); }
  function end(){ drawing = false; ctx.beginPath(); }
  function draw(e){
    if(!drawing) return;
    const p = pos(e);
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.strokeStyle = brushColor;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  }
  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", draw);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, {passive:false});
  canvas.addEventListener("touchmove", draw, {passive:false});
  canvas.addEventListener("touchend", end);

  $("#brushSmall").addEventListener("click", ()=>brushSize=4);
  $("#brushBig").addEventListener("click", ()=>brushSize=12);
  $("#clearCanvas").addEventListener("click", ()=>{
    ctx.fillStyle = "#fff7e8";
    ctx.fillRect(0,0,canvas.width,canvas.height);
  });
}

function getAvatarDataUrl(){
  // 축소본으로 저장 (Firestore 문서 크기 절약)
  const src = $("#avatarCanvas");
  const small = document.createElement("canvas");
  small.width = 48; small.height = 48;
  small.getContext("2d").drawImage(src, 0, 0, 48, 48);
  return small.toDataURL("image/png");
}

/* ------------------------------------------------------------------
   5. 로그인 / 닉네임 / 입장
   ------------------------------------------------------------------ */
function initLogin(){
  initAvatarCanvas();

  // 이전에 저장된 닉네임/아바타 불러오기
  try{
    const savedNick = localStorage.getItem("cp_nickname");
    const savedAvatar = localStorage.getItem("cp_avatar");
    if(savedNick) $("#nicknameInput").value = savedNick;
    if(savedAvatar){
      const img = new Image();
      img.onload = ()=>{
        const ctx = $("#avatarCanvas").getContext("2d");
        ctx.clearRect(0,0,140,140);
        ctx.drawImage(img,0,0,140,140);
      };
      img.src = savedAvatar;
    }
  }catch(e){}

  $("#enterBtn").addEventListener("click", onEnter);

  $("#loginStatus").textContent = "로그인 중...";
  auth.signInAnonymously().catch(err=>{
    $("#loginStatus").textContent = "로그인 실패: " + err.message;
  });

  auth.onAuthStateChanged(user=>{
    if(user){
      me = user;
      $("#loginStatus").textContent = "";
    }
  });
}

function onEnter(){
  const nick = $("#nicknameInput").value.trim();
  if(!nick){ toast("닉네임을 입력해주세요"); return; }
  if(nick.length > 4){ toast("닉네임은 4자 이내로 적어주세요"); return; }
  if(!me){ toast("로그인 중입니다. 잠시 후 다시 시도해주세요"); return; }

  myNickname = nick;
  myAvatar = getAvatarDataUrl();
  try{
    localStorage.setItem("cp_nickname", myNickname);
    localStorage.setItem("cp_avatar", myAvatar);
  }catch(e){}

  $("#myNameTag").textContent = "👋 " + myNickname;
  showView("view-lobby");
  subscribeRoomList();
}

/* ------------------------------------------------------------------
   6. 로비 / 방 목록
   ------------------------------------------------------------------ */
function subscribeRoomList(){
  if(unsubRoomList) unsubRoomList();
  unsubRoomList = db.collection("rooms")
    .orderBy("createdAt","desc")
    .limit(50)
    .onSnapshot(snap=>{
      const list = $("#roomList");
      list.innerHTML = "";
      let count = 0;
      const staleCandidates = [];
      snap.forEach(doc=>{
        const r = doc.data();
        if(r.status === "closed") return;
        count++;
        const gt = GAME_TYPES[r.gameType] || GAME_TYPES.chat;
        const card = document.createElement("div");
        card.className = "roomcard";
        card.innerHTML = `
          <span class="tag" style="background:${gt.color}">${gt.emoji} ${gt.label}</span>
          <div class="meta">
            <div class="name">${escapeHtml(r.name||"이름없음")}</div>
            <div class="count">👥 ${r.playerCount||0} / ${r.maxPlayers||8}명</div>
          </div>
        `;
        card.addEventListener("click", ()=>joinRoom(doc.id));
        list.appendChild(card);

        // 오래 방치된 빈 방은 정리 후보로 표시
        const created = r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : Date.now();
        if((r.playerCount||0) <= 0 && Date.now()-created > 1000*60*30){
          staleCandidates.push(doc.id);
        }
      });
      $("#roomEmpty").classList.toggle("hidden", count>0);

      // lazy cleanup (best-effort)
      staleCandidates.slice(0,3).forEach(id=>deleteRoomCascade(id).catch(()=>{}));
    }, err=>{
      console.error(err);
      toast("방 목록을 불러오지 못했어요");
    });
}

function initCreateModal(){
  const grid = $("#gameTypeGrid");
  Object.keys(GAME_TYPES).forEach(key=>{
    const gt = GAME_TYPES[key];
    const card = document.createElement("div");
    card.className = "gt-card" + (key===selectedGameType ? " sel" : "");
    card.innerHTML = `<div class="emoji">${gt.emoji}</div><div class="lbl">${gt.label}</div>`;
    card.addEventListener("click", ()=>{
      selectedGameType = key;
      document.querySelectorAll(".gt-card").forEach(c=>c.classList.remove("sel"));
      card.classList.add("sel");
    });
    grid.appendChild(card);
  });

  $("#openCreateModal").addEventListener("click", ()=>{
    $("#roomNameInput").value = myNickname + "의 방";
    $("#createModalBg").classList.add("active");
  });
  $("#cancelCreate").addEventListener("click", ()=>$("#createModalBg").classList.remove("active"));
  $("#confirmCreate").addEventListener("click", createRoom);
}

async function createRoom(){
  const name = $("#roomNameInput").value.trim() || (myNickname + "의 방");
  let maxPlayers = parseInt($("#maxPlayersInput").value, 10);
  if(!maxPlayers || maxPlayers < 2) maxPlayers = 8;
  if(maxPlayers > 30) maxPlayers = 30;

  const initState = initialStateFor(selectedGameType);

  try{
    const ref = await db.collection("rooms").add({
      name,
      gameType: selectedGameType,
      hostUid: me.uid,
      hostNickname: myNickname,
      createdAt: FieldValue.serverTimestamp(),
      lastActivityAt: FieldValue.serverTimestamp(),
      status: "waiting",
      playerCount: 0,
      maxPlayers,
      state: initState
    });
    $("#createModalBg").classList.remove("active");
    await joinRoom(ref.id);
  }catch(err){
    console.error(err);
    toast("방 생성 실패: " + err.message);
  }
}

function initialStateFor(gameType){
  if(gameType === "wordchain"){
    return { started:false, turnOrder:[], turnIndex:0, currentWord:"", usedWords:[], turnDeadline:0, winnerUid:null };
  }
  if(gameType === "forbidden"){
    return { active:false, forbiddenWords:[], roundNum:0, strikes:{} };
  }
  if(gameType === "mafia"){
    return { phase:"waiting", topicWord:"", mafiaCount:1, votes:{}, resultText:"" };
  }
  return {};
}

/* ------------------------------------------------------------------
   7. 방 입장 / 퇴장 / 삭제(cascade)
   ------------------------------------------------------------------ */
async function joinRoom(roomId){
  try{
    const roomRef = db.collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    if(!roomSnap.exists){ toast("이미 사라진 방이에요"); return; }
    const room = roomSnap.data();
    if((room.playerCount||0) >= (room.maxPlayers||8)){
      toast("방이 가득 찼어요");
      return;
    }

    const playerRef = roomRef.collection("players").doc(me.uid);
    const already = await playerRef.get();

    await db.runTransaction(async tx=>{
      const fresh = await tx.get(roomRef);
      if(!fresh.exists) throw new Error("방이 이미 삭제되었어요");
      const data = fresh.data();
      if(!already.exists){
        tx.update(roomRef, { playerCount: (data.playerCount||0) + 1, lastActivityAt: FieldValue.serverTimestamp() });
      }
      tx.set(playerRef, {
        nickname: myNickname,
        avatar: myAvatar,
        isHost: room.hostUid === me.uid,
        alive: true,
        score: 0,
        joinedAt: already.exists ? (already.data().joinedAt||FieldValue.serverTimestamp()) : FieldValue.serverTimestamp()
      }, { merge:true });
    });

    currentRoomId = roomId;
    enterRoomView(roomId);
  }catch(err){
    console.error(err);
    toast("입장 실패: " + err.message);
  }
}

function enterRoomView(roomId){
  showView("view-room");
  $("#messages").innerHTML = "";
  players = {};

  if(unsubRoom) unsubRoom();
  if(unsubPlayers) unsubPlayers();
  if(unsubMessages) unsubMessages();
  if(unsubSecret) unsubSecret();

  const roomRef = db.collection("rooms").doc(roomId);

  mySecret = null;
  unsubSecret = roomRef.collection("secrets").doc(me.uid).onSnapshot(snap=>{
    mySecret = snap.exists ? snap.data() : null;
    renderStateBar();
  }, ()=>{ /* 권한 없음(마피아 아닌 방 등) - 무시 */ });

  unsubRoom = roomRef.onSnapshot(snap=>{
    if(!snap.exists){
      toast("방이 종료되었어요");
      exitToLobby();
      return;
    }
    currentRoom = snap.data();
    renderRoomBar();
    renderStateBar();
    renderRoster();
  });

  unsubPlayers = roomRef.collection("players").onSnapshot(snap=>{
    players = {};
    snap.forEach(d=> players[d.id] = d.data());
    renderRoster();
    renderStateBar();
  });

  unsubMessages = roomRef.collection("messages")
    .orderBy("createdAt","asc")
    .limitToLast(200)
    .onSnapshot(snap=>{
      const box = $("#messages");
      box.innerHTML = "";
      snap.forEach(d=> appendMessage(d.data()));
      box.scrollTop = box.scrollHeight;
    });
}

async function exitToLobby(){
  if(wcTimerInterval){ clearInterval(wcTimerInterval); wcTimerInterval = null; }
  if(unsubRoom){ unsubRoom(); unsubRoom=null; }
  if(unsubPlayers){ unsubPlayers(); unsubPlayers=null; }
  if(unsubMessages){ unsubMessages(); unsubMessages=null; }
  if(unsubSecret){ unsubSecret(); unsubSecret=null; }
  currentRoomId = null;
  currentRoom = null;
  mySecret = null;
  showView("view-lobby");
}

async function leaveRoom(){
  if(!currentRoomId) return;
  const roomId = currentRoomId;
  const roomRef = db.collection("rooms").doc(roomId);
  try{
    await roomRef.collection("players").doc(me.uid).delete();
    let shouldDelete = false;
    await db.runTransaction(async tx=>{
      const fresh = await tx.get(roomRef);
      if(!fresh.exists) return;
      const newCount = Math.max(0, (fresh.data().playerCount||1) - 1);
      tx.update(roomRef, { playerCount: newCount, lastActivityAt: FieldValue.serverTimestamp() });
      if(newCount <= 0) shouldDelete = true;
    });
    exitToLobby();
    if(shouldDelete) deleteRoomCascade(roomId).catch(()=>{});
  }catch(err){
    console.error(err);
    exitToLobby();
  }
}

async function closeRoomAsHost(){
  if(!currentRoomId) return;
  if(!confirm("방을 닫으면 채팅 내용이 모두 사라져요. 닫을까요?")) return;
  const roomId = currentRoomId;
  exitToLobby();
  deleteRoomCascade(roomId).catch(()=>{});
}

async function deleteRoomCascade(roomId){
  const roomRef = db.collection("rooms").doc(roomId);
  const subcols = ["players","messages","secrets"];
  for(const col of subcols){
    const snap = await roomRef.collection(col).get();
    const batchSize = 400;
    let batch = db.batch();
    let n = 0;
    for(const doc of snap.docs){
      batch.delete(doc.ref);
      n++;
      if(n >= batchSize){ await batch.commit(); batch = db.batch(); n = 0; }
    }
    if(n>0) await batch.commit();
  }
  await roomRef.delete().catch(()=>{});
}

// 참고: 브라우저를 그냥 닫으면 자동 퇴장이 100% 보장되지 않습니다.
// (Firestore 쓰기는 비동기라 unload 시점에 완료를 보장할 수 없음)
// 방장이 "방 닫기" 버튼으로 정리하거나, 로비의 방치된 빈 방 자동 정리 로직이 뒤처리합니다.

/* ------------------------------------------------------------------
   8. 방 화면 렌더링 (공통)
   ------------------------------------------------------------------ */
function renderRoomBar(){
  if(!currentRoom) return;
  const gt = GAME_TYPES[currentRoom.gameType] || GAME_TYPES.chat;
  $("#roomNameLbl").textContent = currentRoom.name;
  $("#roomTypeLbl").textContent = gt.emoji + " " + gt.label;

  const isHost = currentRoom.hostUid === me.uid;
  const hostBtn = $("#hostActionBtn");
  if(isHost){
    hostBtn.style.display = "inline-block";
    hostBtn.textContent = "방 닫기";
    hostBtn.className = "btn small danger";
    hostBtn.onclick = closeRoomAsHost;
  } else {
    hostBtn.style.display = "none";
  }
}

function renderRoster(){
  const roster = $("#roster");
  roster.innerHTML = "";
  const entries = Object.entries(players).sort((a,b)=> (a[1].joinedAt&&b[1].joinedAt) ? (a[1].joinedAt.toMillis()-b[1].joinedAt.toMillis()) : 0);
  const turnUid = currentRoom && currentRoom.gameType==="wordchain" && currentRoom.state
    ? currentRoom.state.turnOrder[currentRoom.state.turnIndex] : null;

  const mafiaVotePhase = currentRoom && currentRoom.gameType==="mafia" && currentRoom.state && currentRoom.state.phase==="vote";
  const myVote = mafiaVotePhase && currentRoom.state.votes ? currentRoom.state.votes[me.uid] : null;

  for(const [uid, p] of entries){
    const chip = document.createElement("div");
    chip.className = "pchip" + (p.alive===false ? " dead" : "") + (uid===turnUid ? " turn" : "");
    chip.innerHTML = `
      <img class="avatar" src="${p.avatar||''}">
      <div class="nm">${escapeHtml(p.nickname)}${p.isHost?'<span class="badge">방장</span>':''}</div>
      ${mafiaVotePhase && uid!==me.uid ? `<button class="btn small voteBtn ${myVote===uid?'':'secondary'}" data-vote-uid="${uid}">${myVote===uid?'투표함':'지목'}</button>` : ""}
    `;
    roster.appendChild(chip);
  }

  if(mafiaVotePhase){
    roster.querySelectorAll("[data-vote-uid]").forEach(btn=>{
      btn.addEventListener("click", ()=>castMafiaVote(btn.getAttribute("data-vote-uid")));
    });
  }
}

function appendMessage(m){
  const box = $("#messages");
  const div = document.createElement("div");
  const mine = m.uid === (me && me.uid);
  div.className = "msg" + (m.system ? " sys" : (mine ? " me" : "")) + (m.bad ? " bad" : "");
  if(m.system){
    div.innerHTML = `<div class="bubble">${escapeHtml(m.text)}</div>`;
  } else {
    div.innerHTML = `
      <img class="avatar" src="${m.avatar||''}">
      <div>
        <div class="nm">${escapeHtml(m.nickname)}</div>
        <div class="bubble">${escapeHtml(m.text)}</div>
      </div>`;
  }
  box.appendChild(div);
}

async function postSystemMessage(roomRef, text){
  await roomRef.collection("messages").add({
    system:true, text, createdAt: FieldValue.serverTimestamp()
  });
}

/* ------------------------------------------------------------------
   9. 채팅 입력 전송 (게임별 분기)
   ------------------------------------------------------------------ */
function initChatBar(){
  $("#sendBtn").addEventListener("click", onSend);
  $("#chatInput").addEventListener("keydown", e=>{
    if(e.key==="Enter") onSend();
  });
  $("#leaveBtn").addEventListener("click", leaveRoom);
}

async function onSend(){
  const input = $("#chatInput");
  const text = input.value.trim();
  if(!text || !currentRoomId) return;
  input.value = "";

  const gameType = currentRoom ? currentRoom.gameType : "chat";
  if(gameType === "wordchain"){
    await handleWordChainSubmit(text);
  } else if(gameType === "forbidden"){
    await handleForbiddenSubmit(text);
  } else if(gameType === "mafia"){
    await handleMafiaChatSubmit(text);
  } else {
    await postPlainMessage(text, false);
  }
}

async function postPlainMessage(text, bad){
  const roomRef = db.collection("rooms").doc(currentRoomId);
  await roomRef.collection("messages").add({
    uid: me.uid, nickname: myNickname, avatar: myAvatar, text,
    bad: !!bad, createdAt: FieldValue.serverTimestamp()
  });
  await roomRef.update({ lastActivityAt: FieldValue.serverTimestamp() });
}

/* ------------------------------------------------------------------
   10. 상태바 렌더링 (게임별 분기 - 각 게임 파일에서 구현)
   ------------------------------------------------------------------ */
function renderStateBar(){
  if(!currentRoom) return;
  const bar = $("#stateBar");
  const gt = currentRoom.gameType;
  if(gt === "chat"){
    bar.innerHTML = "자유롭게 채팅해보세요 😊";
  } else if(gt === "wordchain"){
    renderWordChainBar(bar);
  } else if(gt === "forbidden"){
    renderForbiddenBar(bar);
  } else if(gt === "mafia"){
    renderMafiaBar(bar);
  }
}

/* ------------------------------------------------------------------
   11. 초기화
   ------------------------------------------------------------------ */
window.addEventListener("DOMContentLoaded", ()=>{
  initLogin();
  initCreateModal();
  initChatBar();
  setInterval(()=>{
    if(currentRoom && currentRoom.gameType==="wordchain") tickWordChain();
  }, 500);
});
