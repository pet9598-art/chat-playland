/* ========================================================================
   금지어 게임 로직
   room.state = { active, forbiddenWords:[string], roundNum, strikes:{uid:count} }
   금지어는 모두에게 공개되며, 채팅 중 실수로 말하면 경고가 쌓입니다 (3회=탈락).
   ======================================================================== */

function renderForbiddenBar(bar){
  const st = (currentRoom && currentRoom.state) || {};
  const isHost = currentRoom && currentRoom.hostUid === me.uid;

  if(!st.active){
    let html = "금지어 게임 대기 중이에요.";
    if(isHost){
      html += ` <button class="btn small" id="fbStartCustom">직접 입력</button>
                <button class="btn small secondary" id="fbStartRandom">랜덤 시작</button>`;
    } else {
      html += " 방장이 라운드를 시작하길 기다려요.";
    }
    bar.innerHTML = html;
    const c1 = document.getElementById("fbStartCustom");
    const c2 = document.getElementById("fbStartRandom");
    if(c1) c1.addEventListener("click", startForbiddenRoundCustom);
    if(c2) c2.addEventListener("click", startForbiddenRoundRandom);
    return;
  }

  const strikesTxt = Object.entries(st.strikes||{})
    .map(([uid,n])=>{ const p = players[uid]; return `${p?escapeHtml(p.nickname):"?"}(${n}/3)`; })
    .join(", ");

  bar.innerHTML = `
    🚫 이번 라운드 금지어: <b>${(st.forbiddenWords||[]).map(escapeHtml).join(", ")}</b><br>
    ${strikesTxt ? "경고: " + strikesTxt : "아직 경고 없음"}
    ${isHost ? '<button class="btn small secondary" id="fbEndBtn" style="margin-left:6px;">라운드 종료</button>' : ""}
  `;
  const endBtn = document.getElementById("fbEndBtn");
  if(endBtn) endBtn.addEventListener("click", endForbiddenRound);
}

async function startForbiddenRoundCustom(){
  const input = prompt("이번 라운드 금지어를 쉼표(,)로 구분해서 입력하세요 (최대 5개)\n예: 그냥,진짜,완전");
  if(!input) return;
  const words = input.split(",").map(w=>w.trim()).filter(Boolean).slice(0,5);
  if(words.length === 0) return;
  await beginForbiddenRound(words);
}

async function startForbiddenRoundRandom(){
  const pool = [...FORBIDDEN_WORD_BANK];
  const words = [];
  for(let i=0; i<3 && pool.length; i++){
    const idx = Math.floor(Math.random()*pool.length);
    words.push(pool.splice(idx,1)[0]);
  }
  await beginForbiddenRound(words);
}

async function beginForbiddenRound(words){
  const roomRef = db.collection("rooms").doc(currentRoomId);
  const batch = db.batch();
  Object.keys(players).forEach(uid=>{
    batch.update(roomRef.collection("players").doc(uid), { alive: true });
  });
  await batch.commit();
  await roomRef.update({
    status: "playing",
    "state.active": true,
    "state.forbiddenWords": words,
    "state.roundNum": FieldValue.increment(1),
    "state.strikes": {},
    lastActivityAt: FieldValue.serverTimestamp()
  });
  await postSystemMessage(roomRef, `🚫 금지어 라운드 시작! 금지어: ${words.join(", ")} — 실수로 말하지 않게 조심하세요!`);
}

async function endForbiddenRound(){
  const roomRef = db.collection("rooms").doc(currentRoomId);
  await roomRef.update({ "state.active": false, status:"waiting" });
  await postSystemMessage(roomRef, "🏁 금지어 라운드가 끝났어요.");
}

async function handleForbiddenSubmit(text){
  const st = currentRoom && currentRoom.state;
  if(!st || !st.active){
    await postPlainMessage(text, false);
    return;
  }
  const normalized = text.replace(/\s+/g, "");
  const hit = (st.forbiddenWords||[]).find(w => normalized.includes(w.replace(/\s+/g, "")));

  if(!hit){
    await postPlainMessage(text, false);
    return;
  }

  await postPlainMessage(text, true);
  toast(`앗! 금지어 '${hit}'!`);

  const roomRef = db.collection("rooms").doc(currentRoomId);
  let newCount = 0;
  await db.runTransaction(async tx=>{
    const snap = await tx.get(roomRef);
    const data = snap.data();
    const strikes = Object.assign({}, (data.state && data.state.strikes) || {});
    newCount = (strikes[me.uid]||0) + 1;
    strikes[me.uid] = newCount;
    tx.update(roomRef, { "state.strikes": strikes, lastActivityAt: FieldValue.serverTimestamp() });
  });

  if(newCount >= 3){
    await roomRef.collection("players").doc(me.uid).update({ alive: false });
    await postSystemMessage(roomRef, `🚫 ${myNickname}님이 금지어 '${hit}'를 3번 말해서 탈락했어요!`);
  } else {
    await postSystemMessage(roomRef, `⚠️ ${myNickname}님이 금지어 '${hit}'를 말했어요! (경고 ${newCount}/3)`);
  }
}
