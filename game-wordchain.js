/* ========================================================================
   끝말잇기 (Word Chain) 게임 로직
   room.state = { started, turnOrder:[uid], turnIndex, currentWord, usedWords:[],
                  turnDeadline(ms), winnerUid }
   ======================================================================== */
const WC_TURN_SECONDS = 20;

function wcAlivePlayerUidsInOrder(){
  if(!currentRoom || !currentRoom.state) return [];
  const order = currentRoom.state.turnOrder || [];
  return order.filter(uid => players[uid] && players[uid].alive !== false);
}

function renderWordChainBar(bar){
  const st = (currentRoom && currentRoom.state) || {};
  const isHost = currentRoom && currentRoom.hostUid === me.uid;

  if(!st.started){
    let html = `끝말잇기 준비 중이에요. `;
    if(st.winnerUid){
      const w = players[st.winnerUid];
      html = `🏆 <b>${escapeHtml(w ? w.nickname : "???")}</b>님 승리! `;
    }
    if(isHost){
      html += `<button class="btn small" id="wcStartBtn" style="margin-left:6px;">게임 시작</button>`;
    } else {
      html += `방장이 시작하길 기다려요.`;
    }
    bar.innerHTML = html;
    const btn = document.getElementById("wcStartBtn");
    if(btn) btn.addEventListener("click", startWordChainGame);
    return;
  }

  const turnUid = st.turnOrder[st.turnIndex];
  const turnPlayer = players[turnUid];
  const remain = Math.max(0, Math.ceil(((st.turnDeadline||0) - Date.now())/1000));
  bar.innerHTML = `
    현재 단어: <b>${st.currentWord ? escapeHtml(st.currentWord) : "(자유롭게 시작!)"}</b><br>
    차례: <b>${turnPlayer ? escapeHtml(turnPlayer.nickname) : "?"}</b>
    ${turnUid===me.uid ? " (내 차례!)" : ""}
    · <span id="wcTimer">${remain}초</span>
    ${isHost ? '<button class="btn small secondary" id="wcSkipBtn" style="margin-left:6px;">강제 넘기기</button>' : ""}
  `;
  const skipBtn = document.getElementById("wcSkipBtn");
  if(skipBtn) skipBtn.addEventListener("click", ()=>wordChainEliminate(turnUid, true));
}

function tickWordChain(){
  if(!currentRoom || currentRoom.gameType !== "wordchain" || !currentRoom.state) return;
  const st = currentRoom.state;
  if(!st.started) return;
  const timerEl = document.getElementById("wcTimer");
  const remain = Math.max(0, Math.ceil(((st.turnDeadline||0) - Date.now())/1000));
  if(timerEl) timerEl.textContent = remain + "초";
  if(remain <= 0){
    const turnUid = st.turnOrder[st.turnIndex];
    if(turnUid === me.uid){
      wordChainEliminate(turnUid, false);
    }
  }
}

async function startWordChainGame(){
  if(!currentRoomId || !currentRoom) return;
  const roomRef = db.collection("rooms").doc(currentRoomId);
  const order = Object.keys(players).sort((a,b)=>{
    const ta = players[a].joinedAt ? players[a].joinedAt.toMillis() : 0;
    const tb = players[b].joinedAt ? players[b].joinedAt.toMillis() : 0;
    return ta - tb;
  });
  if(order.length < 2){
    toast("2명 이상 모여야 시작할 수 있어요");
    return;
  }
  const batch = db.batch();
  order.forEach(uid=>{
    batch.update(roomRef.collection("players").doc(uid), { alive: true });
  });
  await batch.commit();
  await roomRef.update({
    status: "playing",
    "state.started": true,
    "state.turnOrder": order,
    "state.turnIndex": 0,
    "state.currentWord": "",
    "state.usedWords": [],
    "state.turnDeadline": Date.now() + WC_TURN_SECONDS*1000,
    "state.winnerUid": null,
    lastActivityAt: FieldValue.serverTimestamp()
  });
  await postSystemMessage(roomRef, "🔤 끝말잇기가 시작됐어요! 자유롭게 첫 단어를 입력해보세요.");
}

async function handleWordChainSubmit(text){
  const st = currentRoom && currentRoom.state;
  if(!st || !st.started){
    toast("아직 게임이 시작되지 않았어요");
    return;
  }
  const turnUid = st.turnOrder[st.turnIndex];
  if(turnUid !== me.uid){
    toast("아직 내 차례가 아니에요");
    return;
  }
  const word = text.trim();
  let reason = "";
  if(word.length < 2){
    reason = "두 글자 이상 입력해주세요";
  } else if((st.usedWords||[]).includes(word)){
    reason = "이미 나온 단어예요";
  } else if(st.currentWord && word[0] !== st.currentWord[st.currentWord.length-1]){
    reason = `'${st.currentWord[st.currentWord.length-1]}'로 시작해야 해요`;
  }

  if(reason){
    toast(reason);
    await postPlainMessage(text, true);
    return;
  }

  await postPlainMessage(text, false);

  const roomRef = db.collection("rooms").doc(currentRoomId);
  const aliveOrder = wcAlivePlayerUidsInOrder();
  const curPos = aliveOrder.indexOf(turnUid);
  const nextUid = aliveOrder[(curPos + 1) % aliveOrder.length];
  const nextIndex = st.turnOrder.indexOf(nextUid);

  await roomRef.update({
    "state.currentWord": word,
    "state.usedWords": FieldValue.arrayUnion(word),
    "state.turnIndex": nextIndex,
    "state.turnDeadline": Date.now() + WC_TURN_SECONDS*1000,
    lastActivityAt: FieldValue.serverTimestamp()
  });
}

async function wordChainEliminate(uid, forcedByHost){
  const st = currentRoom && currentRoom.state;
  if(!st || !st.started) return;
  const roomRef = db.collection("rooms").doc(currentRoomId);
  const p = players[uid];

  await roomRef.collection("players").doc(uid).update({ alive: false }).catch(()=>{});
  await postSystemMessage(roomRef, `⏰ ${p ? p.nickname : "누군가"}님이 ${forcedByHost ? "방장에 의해" : "시간 초과로"} 탈락했어요!`);

  const remaining = wcAlivePlayerUidsInOrder().filter(u=>u!==uid);
  if(remaining.length <= 1){
    await roomRef.update({
      "state.started": false,
      "state.winnerUid": remaining[0] || null,
      status: "waiting"
    });
    if(remaining[0]){
      const w = players[remaining[0]];
      await postSystemMessage(roomRef, `🏆 ${w ? w.nickname : "???"}님이 우승했어요!`);
    }
    return;
  }

  const nextUid = remaining[0];
  const nextIndex = st.turnOrder.indexOf(nextUid);
  await roomRef.update({
    "state.turnIndex": nextIndex,
    "state.turnDeadline": Date.now() + WC_TURN_SECONDS*1000
  });
}
