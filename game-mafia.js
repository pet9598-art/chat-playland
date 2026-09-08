/* ========================================================================
   범인을 찾아라 (단어 마피아) 게임 로직
   room.state = { phase: waiting|describe|vote|result, mafiaCount, votes:{uid:targetUid},
                  resultText, revealTopic, revealMafia }
   각자의 비밀 단어/역할은 rooms/{roomId}/secrets/{uid} 문서에 저장되며
   Firestore 보안규칙에 의해 "본인" 또는 "방장"만 읽을 수 있습니다.
   ======================================================================== */

function renderMafiaBar(bar){
  const st = (currentRoom && currentRoom.state) || {};
  const isHost = currentRoom && currentRoom.hostUid === me.uid;
  const phase = st.phase || "waiting";

  let secretHtml = "";
  if(phase === "describe" || phase === "vote"){
    if(mySecret){
      secretHtml = mySecret.role === "mafia"
        ? `<div style="margin-top:4px;">🤫 나는 <b>마피아</b>! 눈치껏 둘러대며 설명하세요.</div>`
        : `<div style="margin-top:4px;">🔑 내 제시어: <b>${escapeHtml(mySecret.word||"")}</b></div>`;
    }
  }

  if(phase === "waiting"){
    let html = "🕵️ 단어 마피아 대기 중이에요.";
    if(st.resultText){
      html = `${escapeHtml(st.resultText)}`;
      if(st.revealTopic) html += `<br><span style="color:var(--sub);">제시어: ${escapeHtml(st.revealTopic)} · 마피아: ${escapeHtml(st.revealMafia||"")}</span>`;
    }
    if(isHost){
      html += ` <button class="btn small" id="mfStartBtn" style="margin-left:6px;">게임 시작</button>`;
    } else if(!st.resultText){
      html += " 방장이 시작하길 기다려요.";
    }
    bar.innerHTML = html;
    const b = document.getElementById("mfStartBtn");
    if(b) b.addEventListener("click", startMafiaGame);
    return;
  }

  if(phase === "describe"){
    bar.innerHTML = `🗣️ 설명 시간! 제시어를 직접 말하지 않고 힌트로 설명해보세요.${secretHtml}
      ${isHost ? '<button class="btn small secondary" id="mfVoteStartBtn" style="margin-top:6px;">투표 시작</button>' : ""}`;
    const b = document.getElementById("mfVoteStartBtn");
    if(b) b.addEventListener("click", startMafiaVote);
    return;
  }

  if(phase === "vote"){
    const votes = st.votes || {};
    const votedCount = Object.keys(votes).length;
    const totalAlive = Object.values(players).filter(p=>p.alive!==false).length;
    bar.innerHTML = `🗳️ 투표 시간! 아래 참가자 목록에서 범인이라고 생각하는 사람을 눌러 투표하세요.
      (${votedCount}/${totalAlive}명 투표){secretHtml}
      ${isHost ? '<button class="btn small secondary" id="mfRevealBtn" style="margin-top:6px;">결과 보기</button>' : ""}`
      .replace("{secretHtml}", secretHtml);
    const b = document.getElementById("mfRevealBtn");
    if(b) b.addEventListener("click", revealMafiaResult);
    return;
  }

  if(phase === "result"){
    let html = escapeHtml(st.resultText||"");
    html += `<br><span style="color:var(--sub);">제시어: ${escapeHtml(st.revealTopic||"")} · 마피아: ${escapeHtml(st.revealMafia||"")}</span>`;
    if(isHost) html += ` <button class="btn small" id="mfAgainBtn" style="margin-top:6px;">새 게임</button>`;
    bar.innerHTML = html;
    const b = document.getElementById("mfAgainBtn");
    if(b) b.addEventListener("click", startMafiaGame);
    return;
  }
}

async function handleMafiaChatSubmit(text){
  await postPlainMessage(text, false);
}

async function startMafiaGame(){
  if(!currentRoomId) return;
  const uids = Object.keys(players);
  if(uids.length < 3){
    toast("3명 이상 모여야 시작할 수 있어요");
    return;
  }

  const topicInput = prompt("제시어를 직접 입력하세요 (비워두면 랜덤으로 뽑아요)");
  const topicWord = (topicInput && topicInput.trim()) ? topicInput.trim() : randomFrom(MAFIA_WORDS);

  const suggested = uids.length >= 6 ? 2 : 1;
  const cntInput = prompt("마피아 인원 수를 입력하세요", String(suggested));
  let mafiaCount = parseInt(cntInput, 10);
  if(!mafiaCount || mafiaCount < 1) mafiaCount = suggested;
  if(mafiaCount >= uids.length) mafiaCount = uids.length - 1;

  const shuffled = [...uids].sort(()=>Math.random()-0.5);
  const mafiaUids = new Set(shuffled.slice(0, mafiaCount));

  const roomRef = db.collection("rooms").doc(currentRoomId);
  const batch = db.batch();
  uids.forEach(uid=>{
    const isMafia = mafiaUids.has(uid);
    batch.set(roomRef.collection("secrets").doc(uid), {
      role: isMafia ? "mafia" : "citizen",
      word: isMafia ? null : topicWord
    });
    batch.update(roomRef.collection("players").doc(uid), { alive: true });
  });
  await batch.commit();

  await roomRef.update({
    status: "playing",
    "state.phase": "describe",
    "state.mafiaCount": mafiaCount,
    "state.votes": {},
    "state.resultText": "",
    "state.revealTopic": "",
    "state.revealMafia": "",
    lastActivityAt: FieldValue.serverTimestamp()
  });
  await postSystemMessage(roomRef, "🕵️ 단어 마피아가 시작됐어요! 각자 화면에서 자신의 역할을 확인하세요.");
}

async function startMafiaVote(){
  const roomRef = db.collection("rooms").doc(currentRoomId);
  await roomRef.update({ "state.phase": "vote", "state.votes": {} });
  await postSystemMessage(roomRef, "🗳️ 투표가 시작됐어요! 범인이라고 생각하는 사람을 눌러 투표하세요.");
}

async function castMafiaVote(targetUid){
  if(!currentRoom || !currentRoom.state || currentRoom.state.phase !== "vote") return;
  if(targetUid === me.uid){ toast("자기 자신에게는 투표할 수 없어요"); return; }
  const roomRef = db.collection("rooms").doc(currentRoomId);
  await roomRef.update({ [`state.votes.${me.uid}`]: targetUid });
  toast("투표했어요!");
}

async function revealMafiaResult(){
  const st = currentRoom && currentRoom.state;
  if(!st) return;
  const votes = st.votes || {};
  const tally = {};
  Object.values(votes).forEach(v=>{ tally[v] = (tally[v]||0) + 1; });
  let topUid = null, topCount = -1;
  Object.entries(tally).forEach(([uid,c])=>{ if(c > topCount){ topCount = c; topUid = uid; } });

  const roomRef = db.collection("rooms").doc(currentRoomId);
  const secretsSnap = await roomRef.collection("secrets").get();
  const secretsMap = {};
  secretsSnap.forEach(d=> secretsMap[d.id] = d.data());

  const mafiaUids = Object.keys(secretsMap).filter(uid=> secretsMap[uid].role === "mafia");
  const topicEntry = Object.values(secretsMap).find(s=>s.role==="citizen");
  const topicWord = topicEntry ? topicEntry.word : "";
  const mafiaNames = mafiaUids.map(u=> (players[u] ? players[u].nickname : "?")).join(", ");

  let resultText;
  if(!topUid){
    resultText = "🤷 아무도 투표하지 않았어요. 무승부!";
  } else if(mafiaUids.includes(topUid)){
    resultText = `🎉 시민 승리! ${players[topUid] ? players[topUid].nickname : "?"}님이 범인(마피아)이었어요!`;
  } else {
    resultText = `😈 마피아 승리! ${players[topUid] ? players[topUid].nickname : "?"}님은 시민이었어요...`;
  }

  await roomRef.update({
    "state.phase": "result",
    "state.resultText": resultText,
    "state.revealTopic": topicWord,
    "state.revealMafia": mafiaNames,
    status: "waiting"
  });
  await postSystemMessage(roomRef, `${resultText} (제시어: ${topicWord} / 마피아: ${mafiaNames})`);
}
