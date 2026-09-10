/* ========================================================================
   진짜를 찾아라 (학생들 사이에 숨은 선생님 찾기) 게임 로직
   room.state = { phase: waiting|playing|result,
                  numberMap:{uid:number}, votes:{uid:targetUid},
                  round, roundEndAt(ms), resultText, revealText }
   게임이 시작되면 참가자를 랜덤으로 섞어 1번부터 번호를 매기고, 그 순간부터
   모든 화면(로스터·채팅)에는 실제 닉네임 대신 번호만 표시됩니다.
   각자의 번호/역할(선생님 여부)은 rooms/{roomId}/secrets/{uid} 문서에 저장되며
   Firestore 보안규칙에 의해 "본인" 또는 "방장"만 읽을 수 있습니다.
   30초마다(방장 화면이 기준 시계 역할) 그 순간 최다 득표자가 자동으로 강퇴되며,
   선생님이 걸리면 학생 승리, 2명만 남을 때까지 선생님이 들키지 않으면 선생님 승리입니다.
   ======================================================================== */

const REALONE_ROUND_SECONDS = 30;
let realoneResolving = false;

function realoneAlivePlayerUids(){
  return Object.keys(players).filter(uid => players[uid] && players[uid].alive !== false);
}

function renderRealOneBar(bar){
  const st = (currentRoom && currentRoom.state) || {};
  const isHost = currentRoom && currentRoom.hostUid === me.uid;
  const phase = st.phase || "waiting";

  let secretHtml = "";
  if(phase === "playing" && mySecret && mySecret.number != null){
    secretHtml = mySecret.isTeacher
      ? `<div style="margin-top:4px;">🤫 내 번호는 <b>${mySecret.number}번</b>! 당신이 바로 숨어있는 <b>선생님</b>이에요. 들키지 않게 학생인 척 연기하세요.</div>`
      : `<div style="margin-top:4px;">🙋 내 번호는 <b>${mySecret.number}번</b>! 당신은 평범한 학생이에요. 채팅으로 눈치를 살펴 선생님을 찾아내세요.</div>`;
  }

  if(phase === "waiting"){
    let html = "🧑‍🏫 진짜를 찾아라 대기 중이에요.";
    if(st.resultText){
      html = escapeHtml(st.resultText);
      if(st.revealText) html += `<br><span style="color:var(--sub);">${escapeHtml(st.revealText)}</span>`;
    }
    if(isHost){
      html += ` <button class="btn small" id="roStartBtn" style="margin-left:6px;">게임 시작</button>`;
    } else if(!st.resultText){
      html += " 방장이 시작하길 기다려요.";
    }
    bar.innerHTML = html;
    const b = document.getElementById("roStartBtn");
    if(b) b.addEventListener("click", startRealOneGame);
    return;
  }

  if(phase === "playing"){
    const votes = st.votes || {};
    const votedCount = Object.keys(votes).length;
    const totalAlive = realoneAlivePlayerUids().length;
    const remain = Math.max(0, Math.ceil(((st.roundEndAt||0) - Date.now())/1000));
    bar.innerHTML = `
      🗳️ ${st.round||1}라운드! 선생님이라고 생각하는 번호를 눌러 투표하세요.
      (${votedCount}/${totalAlive}명 투표) · <span id="roTimer">${remain}초</span> 후 최다 득표자 자동 강퇴${secretHtml}
    `;
    return;
  }

  if(phase === "result"){
    let html = escapeHtml(st.resultText||"");
    if(st.revealText) html += `<br><span style="color:var(--sub);">${escapeHtml(st.revealText)}</span>`;
    if(isHost) html += ` <button class="btn small" id="roAgainBtn" style="margin-top:6px;">새 게임</button>`;
    bar.innerHTML = html;
    const b = document.getElementById("roAgainBtn");
    if(b) b.addEventListener("click", startRealOneGame);
    return;
  }
}

function tickRealOne(){
  if(!currentRoom || currentRoom.gameType !== "realone" || !currentRoom.state) return;
  const st = currentRoom.state;
  if(st.phase !== "playing") return;
  const timerEl = document.getElementById("roTimer");
  const remain = Math.max(0, Math.ceil(((st.roundEndAt||0) - Date.now())/1000));
  if(timerEl) timerEl.textContent = remain + "초";

  // 라운드 정산은 방장 화면이 기준 시계 역할을 합니다 (본인 또는 방장만 참가자 alive 수정 가능).
  const isHost = currentRoom.hostUid === me.uid;
  if(isHost && remain <= 0 && !realoneResolving){
    resolveRealOneRound();
  }
}

async function handleRealOneChatSubmit(text){
  await postPlainMessage(text, false);
}

async function startRealOneGame(){
  if(!currentRoomId) return;
  const uids = Object.keys(players);
  if(uids.length < 3){
    toast("3명 이상 모여야 시작할 수 있어요");
    return;
  }

  // 참가자를 랜덤으로 섞어서 1번부터 번호를 매깁니다. "선생님" 역할은 별도로 뽑지 않고
  // 방장(=게임을 진행하는 실제 선생님)이 학생들 사이에 번호로 숨어 참여합니다.
  const shuffled = [...uids].sort(()=>Math.random()-0.5);
  const numberMap = {};
  shuffled.forEach((uid, idx)=>{ numberMap[uid] = idx + 1; });
  const teacherUid = currentRoom.hostUid;

  const roomRef = db.collection("rooms").doc(currentRoomId);
  const batch = db.batch();
  uids.forEach(uid=>{
    batch.set(roomRef.collection("secrets").doc(uid), {
      number: numberMap[uid],
      isTeacher: uid === teacherUid
    });
    batch.update(roomRef.collection("players").doc(uid), { alive: true });
  });
  await batch.commit();

  await roomRef.update({
    status: "playing",
    "state.phase": "playing",
    "state.numberMap": numberMap,
    "state.votes": {},
    "state.round": 1,
    "state.roundEndAt": Date.now() + REALONE_ROUND_SECONDS*1000,
    "state.resultText": "",
    "state.revealText": "",
    lastActivityAt: FieldValue.serverTimestamp()
  });
  await postSystemMessage(roomRef, `🧑‍🏫 진짜를 찾아라가 시작됐어요! 지금부터 모두 번호로만 표시돼요. ${REALONE_ROUND_SECONDS}초마다 그 순간 최다 득표자가 자동으로 강퇴됩니다. 학생들 사이에 숨은 선생님을 찾아내세요!`);
}

async function castRealOneVote(targetUid){
  const st = currentRoom && currentRoom.state;
  if(!st || st.phase !== "playing") return;
  if(players[me.uid] && players[me.uid].alive === false){ toast("이미 탈락해서 투표할 수 없어요"); return; }
  if(targetUid === me.uid){ toast("자기 자신에게는 투표할 수 없어요"); return; }
  if(players[targetUid] && players[targetUid].alive === false) return;
  const roomRef = db.collection("rooms").doc(currentRoomId);
  await roomRef.update({ [`state.votes.${me.uid}`]: targetUid });
  toast("투표했어요!");
}

async function resolveRealOneRound(){
  if(realoneResolving) return;
  realoneResolving = true;
  try{
    const roomRef = db.collection("rooms").doc(currentRoomId);
    const fresh = await roomRef.get();
    if(!fresh.exists) return;
    const data = fresh.data();
    const st = data.state || {};
    if(st.phase !== "playing") return; // 이미 다른 화면에서 처리됨

    const votes = st.votes || {};
    const tally = {};
    Object.entries(votes).forEach(([voterUid, targetUid])=>{
      if(players[voterUid] && players[voterUid].alive === false) return; // 탈락자 표는 무효
      tally[targetUid] = (tally[targetUid]||0) + 1;
    });

    const entries = Object.entries(tally);
    if(entries.length === 0){
      await roomRef.update({
        "state.votes": {},
        "state.round": (st.round||1) + 1,
        "state.roundEndAt": Date.now() + REALONE_ROUND_SECONDS*1000
      });
      await postSystemMessage(roomRef, "🤷 아무도 투표하지 않아 이번 라운드는 아무도 탈락하지 않았어요.");
      return;
    }

    let topCount = -1;
    entries.forEach(([,c])=>{ if(c > topCount) topCount = c; });
    const topUids = entries.filter(([,c])=>c===topCount).map(([uid])=>uid);
    const targetUid = randomFrom(topUids);

    const secretsSnap = await roomRef.collection("secrets").get();
    const secretsMap = {};
    secretsSnap.forEach(d=> secretsMap[d.id] = d.data());
    const targetSecret = secretsMap[targetUid] || {};
    const targetNumber = targetSecret.number != null ? targetSecret.number : "?";
    const wasTeacher = !!targetSecret.isTeacher;
    const targetName = players[targetUid] ? players[targetUid].nickname : "?";

    await roomRef.collection("players").doc(targetUid).update({ alive: false });

    const remainingAlive = realoneAlivePlayerUids().filter(u=>u!==targetUid);

    function buildRevealText(){
      return "실제 정체: " + Object.entries(secretsMap)
        .sort((a,b)=> (a[1].number||0) - (b[1].number||0))
        .map(([uid,s])=> `${s.number}번=${players[uid]?players[uid].nickname:"?"}${s.isTeacher?"(선생님)":""}`)
        .join(", ");
    }

    if(wasTeacher){
      await roomRef.update({
        "state.phase": "result",
        "state.resultText": `🎉 학생들 승리! ${targetNumber}번이 바로 숨어있던 선생님이었어요!`,
        "state.revealText": buildRevealText(),
        status: "waiting"
      });
      await postSystemMessage(roomRef, `🎉 ${targetNumber}번(${targetName})이 탈락했어요. 정체는... 선생님이었어요! 학생들의 승리입니다!`);
    } else if(remainingAlive.length <= 2){
      const teacherUid = Object.keys(secretsMap).find(uid=>secretsMap[uid].isTeacher);
      const teacherNumber = teacherUid && secretsMap[teacherUid] ? secretsMap[teacherUid].number : "?";
      await roomRef.update({
        "state.phase": "result",
        "state.resultText": `😈 선생님 승리! ${teacherNumber}번은 끝까지 정체를 들키지 않았어요...`,
        "state.revealText": buildRevealText(),
        status: "waiting"
      });
      await postSystemMessage(roomRef, `😈 ${targetNumber}번(${targetName})이 탈락했어요. 학생이었네요! 이제 ${remainingAlive.length}명만 남아 선생님이 승리했어요.`);
    } else {
      await roomRef.update({
        "state.votes": {},
        "state.round": (st.round||1) + 1,
        "state.roundEndAt": Date.now() + REALONE_ROUND_SECONDS*1000
      });
      await postSystemMessage(roomRef, `⏰ ${targetNumber}번(${targetName})이 탈락했어요. 학생이었어요! 다음 라운드가 시작돼요.`);
    }
  } finally {
    realoneResolving = false;
  }
}
