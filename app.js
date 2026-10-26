const STORAGE_KEY = "maic-event-manager-students";
const GROUP_SHUFFLE_ANIMATION_DURATION = 1800;
const STUDENTS_FILE = "students.json";
const storedStudents = loadStudents();
const state = {
  participants: [],
  referenceParticipants: { cancelled: [], pendingAttendance: [] },
  studentNames: storedStudents.names,
  hasSavedStudents: storedStudents.hasSavedStudents,
  studentLoadError: storedStudents.error,
  groups: null,
  timer: { duration: 300, remaining: 300, intervalId: null, isRunning: false, warned: false, muted: false }
};

const $ = (selector) => document.querySelector(selector);
const els = {
  tabs: document.querySelectorAll(".tab-button"),
  panels: document.querySelectorAll(".tab-panel"),
  timerDisplay: $("#timer-display"),
  timerStatus: $("#timer-status"),
  timerMessage: $("#timer-message"),
  startPause: $("#start-pause-button"),
  resetTimer: $("#reset-timer-button"),
  fullscreenTimer: $("#fullscreen-timer"),
  timerNotice: $("#timer-notice"),
  mute: $("#mute-button"),
  customMinutes: $("#custom-minutes"),
  customSeconds: $("#custom-seconds"),
  dropZone: $("#drop-zone"),
  csvFile: $("#csv-file"),
  importStatus: $("#import-status"),
  students: $("#student-list"),
  studentStatus: $("#student-status"),
  studentFile: $("#student-file"),
  participantList: $("#participant-list"),
  participantSummary: $("#participant-summary"),
  referenceParticipantSummary: $("#reference-participant-summary"),
  cancelledParticipantList: $("#cancelled-participant-list"),
  pendingAttendanceList: $("#pending-attendance-list"),
  groupCount: $("#group-count"),
  groupNotice: $("#group-notice"),
  groupResults: $("#group-results"),
  reshuffle: $("#reshuffle-groups"),
  replay: $("#replay-groups"),
  fullscreenGroups: $("#fullscreen-groups"),
  showStudentBadges: $("#show-student-badges"),
  manualForm: $("#manual-participant-form"),
  manualName: $("#manual-name"),
  manualUsername: $("#manual-username"),
  manualStudent: $("#manual-student"),
  manualExcluded: $("#manual-excluded")
};

function normalise(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function loadStudents() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { names: [], hasSavedStudents: false, error: null };
    const names = JSON.parse(saved);
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
      throw new Error("保存済みの学生リストの形式が正しくありません。");
    }
    return { names, hasSavedStudents: true, error: null };
  } catch (error) {
    console.error("保存済みの学生リストを読み込めませんでした。", error);
    return { names: [], hasSavedStudents: false, error };
  }
}

async function loadDefaultStudents() {
  if (state.hasSavedStudents) return;
  try {
    const response = await fetch(STUDENTS_FILE);
    if (!response.ok) throw new Error(`${STUDENTS_FILE} を読み込めませんでした（${response.status}）。`);
    const names = await response.json();
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
      throw new Error(`${STUDENTS_FILE} はユーザー名の配列にしてください。`);
    }
    if (state.hasSavedStudents) return;
    state.studentNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    els.students.value = state.studentNames.join("\n");
    renderParticipants();
  } catch (error) {
    console.error("初期学生リストを読み込めませんでした。", error);
    els.studentStatus.textContent = location.protocol === "file:"
      ? `ファイルを直接開いているため${STUDENTS_FILE}を自動読み込みできません。「students.jsonを読み込む」から選択するか、ローカルWebサーバーで開いてください。`
      : `初期学生リストを読み込めませんでした。${STUDENTS_FILE}を用意するか、画面で入力して保存してください。`;
  }
}

async function importStudentsFile(file) {
  if (!file) return;
  try {
    const names = JSON.parse(await file.text());
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) {
      throw new Error("ユーザー名のJSON配列を指定してください。");
    }
    els.students.value = [...new Set(names.map((name) => name.trim()).filter(Boolean))].join("\n");
    saveStudents();
    els.studentStatus.textContent = `${state.studentNames.length}名の学生リストを読み込み、ブラウザに保存しました。`;
  } catch (error) {
    console.error("学生リストファイルを読み込めませんでした。", error);
    els.studentStatus.textContent = `学生リストファイルを読み込めませんでした：${error.message}`;
  } finally {
    els.studentFile.value = "";
  }
}

function getStudentSet() {
  return new Set(state.studentNames.map(normalise).filter(Boolean));
}

function isStudent(username) {
  return getStudentSet().has(normalise(username));
}

function switchTab(tabId) {
  els.tabs.forEach((button) => button.classList.toggle("is-active", button.dataset.tab === tabId));
  els.panels.forEach((panel) => {
    const active = panel.id === tabId;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function renderTimer() {
  const { remaining, isRunning } = state.timer;
  els.timerDisplay.textContent = formatTime(remaining);
  els.startPause.textContent = isRunning ? "一時停止" : remaining === 0 ? "再スタート" : "スタート";
  document.body.classList.toggle("timer-warning", remaining > 0 && remaining <= 60);
  document.body.classList.toggle("timer-timeup", remaining === 0 && state.timer.duration > 0);
  if (remaining === 0 && state.timer.duration > 0) {
    els.timerStatus.textContent = "TIME UP";
    els.timerMessage.textContent = "拍手！";
  } else if (remaining <= 60 && state.timer.duration > 60) {
    els.timerStatus.textContent = "LAST MINUTE";
    els.timerMessage.textContent = "残り1分です";
  } else {
    els.timerStatus.textContent = isRunning ? "COUNTDOWN" : "READY";
    els.timerMessage.textContent = isRunning ? "進行中" : "開始を待っています";
  }
}

function playTone(frequency, duration, delay = 0) {
  if (state.timer.muted) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.12, context.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + delay + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(context.currentTime + delay);
  oscillator.stop(context.currentTime + delay + duration);
}

function setTimer(seconds) {
  pauseTimer();
  state.timer.duration = seconds;
  state.timer.remaining = seconds;
  state.timer.warned = false;
  document.querySelectorAll("[data-seconds]").forEach((button) => {
    button.classList.toggle("is-selected", Number(button.dataset.seconds) === seconds);
  });
  renderTimer();
}

function pauseTimer() {
  if (state.timer.intervalId) clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.isRunning = false;
}

function startTimer() {
  if (state.timer.remaining === 0) {
    state.timer.remaining = state.timer.duration;
    state.timer.warned = false;
  }
  if (state.timer.remaining <= 0) return;
  state.timer.isRunning = true;
  const endAt = Date.now() + state.timer.remaining * 1000;
  state.timer.intervalId = setInterval(() => {
    state.timer.remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (state.timer.remaining === 60 && !state.timer.warned) {
      state.timer.warned = true;
      playTone(880, 0.35);
    }
    if (state.timer.remaining === 0) {
      pauseTimer();
      playTone(660, 0.18);
      playTone(880, 0.18, 0.28);
      playTone(1040, 0.35, 0.56);
    }
    renderTimer();
  }, 200);
  renderTimer();
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("CSVにヘッダーと参加者データが必要です。");
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

async function decodeCsv(file) {
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const shiftJis = new TextDecoder("shift_jis", { fatal: false }).decode(bytes);
  return (utf8.includes("ユーザー名") || !shiftJis.includes("ユーザー名")) ? utf8 : shiftJis;
}

async function importCsv(file) {
  if (!file) return;
  try {
    const records = parseCsv(await decodeCsv(file));
    if (!records[0] || !("ユーザー名" in records[0]) || !("出欠ステータス" in records[0])) {
      throw new Error("connpassの参加者管理CSVではありません。「ユーザー名」と「出欠ステータス」列を確認してください。");
    }
    const cancelledRecords = records.filter((record) => record["参加ステータス"]?.includes("キャンセル"));
    const pendingAttendanceRecords = records.filter((record) => !record["参加ステータス"]?.includes("キャンセル") && !record["出欠ステータス"].trim());
    state.referenceParticipants = {
      cancelled: cancelledRecords,
      pendingAttendance: pendingAttendanceRecords
    };
    state.participants = records
      .filter((record) => !record["参加ステータス"]?.includes("キャンセル") && record["出欠ステータス"].trim() === "出席")
      .map((record, index) => ({
        id: `csv-${index}-${record["ユーザー名"]}`,
        username: record["ユーザー名"],
        displayName: record["表示名"] || record["ユーザー名"],
        isExcluded: false,
        studentOverride: null
      }));
    els.importStatus.textContent = `${state.participants.length}名を読み込みました（キャンセル${cancelledRecords.length}名、出欠未登録${pendingAttendanceRecords.length}名を参考一覧へ）。`;
    renderParticipants();
    renderReferenceParticipants();
    resetGroups();
  } catch (error) {
    els.importStatus.textContent = `読み込みに失敗しました：${error.message}`;
  }
}

function renderReferenceParticipants() {
  const { cancelled, pendingAttendance } = state.referenceParticipants;
  const renderList = (container, participants, emptyMessage) => {
    container.replaceChildren(...(participants.length
      ? participants.map((participant) => {
        const item = document.createElement("p");
        item.className = "reference-participant";
        item.innerHTML = `${escapeHtml(participant["表示名"] || participant["ユーザー名"])} <span>@${escapeHtml(participant["ユーザー名"] || "ユーザー名なし")}</span>`;
        return item;
      })
      : [Object.assign(document.createElement("p"), { className: "empty-state", textContent: emptyMessage })]));
  };
  els.referenceParticipantSummary.textContent = state.participants.length || cancelled.length || pendingAttendance.length
    ? `キャンセル ${cancelled.length} 名 / 出欠未登録 ${pendingAttendance.length} 名`
    : "CSVを読み込んでください";
  renderList(els.cancelledParticipantList, cancelled, "キャンセル者はいません。");
  renderList(els.pendingAttendanceList, pendingAttendance, "出欠未登録者はいません。");
}

function getActiveParticipants() {
  return state.participants.filter((participant) => !participant.isExcluded).map((participant) => ({
    ...participant,
    isStudent: participant.studentOverride ?? isStudent(participant.username)
  }));
}

function renderParticipants() {
  const activeCount = getActiveParticipants().length;
  const excludedCount = state.participants.filter((participant) => participant.isExcluded).length;
  els.participantSummary.textContent = state.participants.length
    ? `対象 ${activeCount} / ${state.participants.length} 名${excludedCount ? `（除外 ${excludedCount} 名）` : ""}`
    : "CSVを読み込んでください";
  if (!state.participants.length) {
    els.participantList.innerHTML = '<p class="empty-state">CSVを読み込むと参加者がここに表示されます。</p>';
    return;
  }
  const studentSet = getStudentSet();
  els.participantList.replaceChildren(...state.participants.map((participant) => {
    const row = document.createElement("div");
    row.className = `participant-row${participant.isExcluded ? " is-excluded" : ""}`;
    const excludedChecked = participant.isExcluded ? "checked" : "";
    const student = participant.studentOverride ?? studentSet.has(normalise(participant.username));
    const studentChecked = student ? "checked" : "";
    row.innerHTML = `<label class="exclusion-toggle"><input data-participant-action="excluded" type="checkbox" ${excludedChecked} aria-label="${escapeHtml(participant.displayName)}を除外する"> 除外</label>
      <span class="participant-details"><span class="participant-name">${escapeHtml(participant.displayName)}${student ? '<span class="badge">学生</span>' : ""}</span>
      <br><span class="participant-username">@${escapeHtml(participant.username || "飛び入り")}</span></span>
      <label class="student-toggle"><input data-participant-action="student" type="checkbox" ${studentChecked}> 学生</label>`;
    row.querySelector('[data-participant-action="excluded"]').addEventListener("change", (event) => {
      participant.isExcluded = event.target.checked;
      renderParticipants();
      resetGroups();
    });
    row.querySelector('[data-participant-action="student"]').addEventListener("change", (event) => {
      participant.studentOverride = event.target.checked;
      renderParticipants();
      resetGroups();
    });
    return row;
  }));
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function calculateGroupCount(participantCount) {
  if (participantCount <= 5) return 1;
  const minGroups = Math.ceil(participantCount / 5);
  const maxGroups = Math.floor(participantCount / 4);
  if (minGroups > maxGroups) return minGroups;
  return Math.min(maxGroups, Math.max(minGroups, Math.round(participantCount / 4.5)));
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function createGroups(participants, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  const students = shuffle(participants.filter((participant) => participant.isStudent));
  const others = shuffle(participants.filter((participant) => !participant.isStudent));
  students.forEach((participant, index) => groups[index % groupCount].push(participant));
  others.forEach((participant) => {
    const smallestSize = Math.min(...groups.map((group) => group.length));
    const candidates = groups.map((group, index) => ({ group, index })).filter(({ group }) => group.length === smallestSize);
    candidates[Math.floor(Math.random() * candidates.length)].group.push(participant);
  });
  return groups;
}

function getPairKey(firstId, secondId) {
  return JSON.stringify([firstId, secondId].sort());
}

function getGroupPairSet(groups) {
  const pairs = new Set();
  groups.forEach((group) => {
    for (let first = 0; first < group.length; first += 1) {
      for (let second = first + 1; second < group.length; second += 1) {
        pairs.add(getPairKey(group[first].id, group[second].id));
      }
    }
  });
  return pairs;
}

function countRepeatedPairs(groups, previousPairs) {
  return [...getGroupPairSet(groups)].filter((pair) => previousPairs.has(pair)).length;
}

function reduceRepeatedPairs(groups, previousPairs) {
  let repeatedPairCount = countRepeatedPairs(groups, previousPairs);
  while (repeatedPairCount > 0) {
    let bestSwap = null;
    let bestRepeatedPairCount = repeatedPairCount;
    for (let firstGroupIndex = 0; firstGroupIndex < groups.length; firstGroupIndex += 1) {
      for (let secondGroupIndex = firstGroupIndex + 1; secondGroupIndex < groups.length; secondGroupIndex += 1) {
        for (let firstIndex = 0; firstIndex < groups[firstGroupIndex].length; firstIndex += 1) {
          for (let secondIndex = 0; secondIndex < groups[secondGroupIndex].length; secondIndex += 1) {
            const firstParticipant = groups[firstGroupIndex][firstIndex];
            const secondParticipant = groups[secondGroupIndex][secondIndex];
            if (firstParticipant.isStudent !== secondParticipant.isStudent) continue;
            [groups[firstGroupIndex][firstIndex], groups[secondGroupIndex][secondIndex]] = [secondParticipant, firstParticipant];
            const candidateRepeatedPairCount = countRepeatedPairs(groups, previousPairs);
            [groups[firstGroupIndex][firstIndex], groups[secondGroupIndex][secondIndex]] = [firstParticipant, secondParticipant];
            if (candidateRepeatedPairCount < bestRepeatedPairCount) {
              bestRepeatedPairCount = candidateRepeatedPairCount;
              bestSwap = { firstGroupIndex, secondGroupIndex, firstIndex, secondIndex };
            }
          }
        }
      }
    }
    if (!bestSwap) break;
    const { firstGroupIndex, secondGroupIndex, firstIndex, secondIndex } = bestSwap;
    [groups[firstGroupIndex][firstIndex], groups[secondGroupIndex][secondIndex]] = [groups[secondGroupIndex][secondIndex], groups[firstGroupIndex][firstIndex]];
    repeatedPairCount = bestRepeatedPairCount;
  }
  return repeatedPairCount;
}

function generateGroups() {
  const participants = getActiveParticipants();
  if (!participants.length) {
    els.groupNotice.textContent = "グループ分けをする参加者がいません。CSVを読み込むか、参加者を追加してください。";
    return;
  }
  const requestedCount = Number(els.groupCount.value);
  const groupCount = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : calculateGroupCount(participants.length);
  els.groupCount.value = groupCount;
  const previousPairs = state.groups ? getGroupPairSet(state.groups) : null;
  let groups = createGroups(participants, groupCount);
  let repeatedPairCount = previousPairs ? reduceRepeatedPairs(groups, previousPairs) : null;
  for (let attempt = 1; previousPairs && repeatedPairCount > 0 && attempt < 30; attempt += 1) {
    const candidateGroups = createGroups(participants, groupCount);
    const candidateRepeatedPairCount = reduceRepeatedPairs(candidateGroups, previousPairs);
    if (candidateRepeatedPairCount < repeatedPairCount) {
      groups = candidateGroups;
      repeatedPairCount = candidateRepeatedPairCount;
    }
  }
  state.prevGroups = state.groups;
  state.groups = groups;
  renderGroups(groups);
  els.replay.disabled = !state.prevGroups;
  const sizes = groups.map((group) => group.length);
  const invalidSize = sizes.some((size) => size < 4 || size > 5);
  const groupMessage = invalidSize
    ? `${participants.length}名では、${groupCount}グループを4〜5名だけで構成できません（${sizes.join(" / ")}名）。グループ数を調整してください。`
    : `${groupCount}グループ（各${sizes.join(" / ")}名）を作成しました。`;
  const repeatMessage = repeatedPairCount === null
    ? ""
    : repeatedPairCount === 0
      ? " 前回と同じ組み合わせを避けました。"
      : ` 前回と同じ組み合わせが${repeatedPairCount}組あります。`;
  els.groupNotice.textContent = `${groupMessage}${repeatMessage}`;
  els.reshuffle.disabled = false;
  els.fullscreenGroups.disabled = false;
}

function renderGroups(groups, animate = true) {
  const firstItems = new Map([...els.groupResults.querySelectorAll("li[data-id]")].map((li) => [
    li.dataset.id,
    {
      rect: li.getBoundingClientRect(),
      groupLabel: li.closest(".group-card")?.dataset.groupLabel
    }
  ]));
  const columns = groups.length <= 2 ? groups.length : groups.length <= 4 ? 2 : 3;
  els.groupResults.style.setProperty("--group-columns", columns);
  els.groupResults.replaceChildren(...groups.map((group, index) => {
    const card = document.createElement("article");
    card.className = "group-card";
    const tableNumber = index + 1;
    const groupLabel = `グループ ${String.fromCharCode(65 + index)}`;
    card.dataset.groupLabel = groupLabel;
    card.innerHTML = `<h3>${groupLabel} <small>（テーブル${tableNumber}）</small></h3>
      <ol>${group.map((participant) => {
        const previousItem = firstItems.get(String(participant.id));
        const originLabel = previousItem?.groupLabel !== groupLabel ? previousItem?.groupLabel : "";
        return `<li data-id="${escapeHtml(String(participant.id))}">${escapeHtml(participant.displayName)}${originLabel ? `<span class="move-origin">${escapeHtml(originLabel)}から</span>` : ""}${els.showStudentBadges.checked && participant.isStudent ? '<span class="badge">学生</span>' : ""}</li>`;
      }).join("")}</ol>`;
    return card;
  }));
  if (!animate || !firstItems.size || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  els.groupResults.querySelectorAll("li[data-id]").forEach((li) => {
    const previousItem = firstItems.get(li.dataset.id);
    if (!previousItem) return;
    const last = li.getBoundingClientRect();
    const dx = previousItem.rect.left - last.left;
    const dy = previousItem.rect.top - last.top;
    if (!dx && !dy) return;
    li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: GROUP_SHUFFLE_ANIMATION_DURATION, easing: "cubic-bezier(.4,0,.2,1)" });
  });
}

function resetGroups() {
  state.groups = null;
  els.groupResults.replaceChildren();
  els.groupResults.style.removeProperty("--group-columns");
  els.reshuffle.disabled = true;
  state.prevGroups = null;
  els.replay.disabled = true;
  els.fullscreenGroups.disabled = true;
  els.groupNotice.textContent = "";
  els.groupCount.value = state.participants.length ? calculateGroupCount(getActiveParticipants().length) : "";
}

function saveStudents() {
  state.studentNames = [...new Set(els.students.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.studentNames));
    state.hasSavedStudents = true;
    els.studentStatus.textContent = `${state.studentNames.length}名の学生リストを保存しました。`;
    renderParticipants();
    resetGroups();
  } catch (error) {
    els.studentStatus.textContent = `保存に失敗しました：${error.message}`;
  }
}

els.tabs.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
document.querySelectorAll("[data-seconds]").forEach((button) => button.addEventListener("click", () => setTimer(Number(button.dataset.seconds))));
els.startPause.addEventListener("click", () => state.timer.isRunning ? (pauseTimer(), renderTimer()) : startTimer());
els.resetTimer.addEventListener("click", () => setTimer(state.timer.duration));
els.mute.addEventListener("click", () => {
  state.timer.muted = !state.timer.muted;
  els.mute.textContent = state.timer.muted ? "🔇 ミュート中" : "🔊 音あり";
  els.mute.setAttribute("aria-pressed", String(state.timer.muted));
});
$("#apply-custom-time").addEventListener("click", () => {
  const seconds = Number(els.customMinutes.value) * 60 + Number(els.customSeconds.value);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 5999) {
    els.timerMessage.textContent = "1秒から99分59秒の範囲で設定してください。";
    return;
  }
  setTimer(seconds);
});
els.csvFile.addEventListener("change", (event) => importCsv(event.target.files[0]));
["dragenter", "dragover"].forEach((eventName) => els.dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  els.dropZone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((eventName) => els.dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("is-dragging");
}));
els.dropZone.addEventListener("drop", (event) => importCsv(event.dataTransfer.files[0]));
$("#save-students").addEventListener("click", saveStudents);
els.studentFile.addEventListener("change", (event) => importStudentsFile(event.target.files[0]));
$("#reset-students").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    state.studentNames = [];
    state.hasSavedStudents = false;
    els.students.value = "";
    els.studentStatus.textContent = "保存済みの学生リストを削除しました。初期学生リストを読み込みます。";
    loadDefaultStudents();
  } catch (error) {
    console.error("保存済みの学生リストを削除できませんでした。", error);
    els.studentStatus.textContent = `初期値に戻せませんでした：${error.message}`;
  }
});
$("#auto-group-count").addEventListener("click", () => {
  els.groupCount.value = calculateGroupCount(getActiveParticipants().length);
  els.groupNotice.textContent = "参加人数からグループ数を自動計算しました。";
});
$("#generate-groups").addEventListener("click", generateGroups);
els.reshuffle.addEventListener("click", generateGroups);
els.replay.addEventListener("click", () => {
  if (!state.prevGroups || !state.groups) return;
  renderGroups(state.prevGroups, false);
  renderGroups(state.groups);
});
els.fullscreenGroups.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await $("#groups").requestFullscreen();
    }
  } catch (error) {
    els.groupNotice.textContent = `全画面表示に切り替えられませんでした：${error.message}`;
  }
});
els.fullscreenTimer.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await $("#timer").requestFullscreen();
    }
  } catch (error) {
    els.timerNotice.textContent = `全画面表示に切り替えられませんでした：${error.message}`;
  }
});
document.addEventListener("fullscreenchange", () => {
  const isGroupsFullscreen = document.fullscreenElement === $("#groups");
  const isTimerFullscreen = document.fullscreenElement === $("#timer");
  els.fullscreenGroups.textContent = isGroupsFullscreen ? "⛶ 全画面を終了" : "⛶ 全画面表示";
  els.fullscreenTimer.textContent = isTimerFullscreen ? "⛶ 全画面を終了" : "⛶ 全画面表示";
});
els.showStudentBadges.addEventListener("change", () => {
  if (state.groups) renderGroups(state.groups);
});
$("#add-participant").addEventListener("click", () => {
  els.manualForm.hidden = !els.manualForm.hidden;
  if (!els.manualForm.hidden) els.manualName.focus();
});
$("#cancel-manual-participant").addEventListener("click", () => { els.manualForm.hidden = true; });
$("#save-manual-participant").addEventListener("click", () => {
  const displayName = els.manualName.value.trim();
  if (!displayName) {
    els.importStatus.textContent = "飛び入り参加者の表示名を入力してください。";
    return;
  }
  state.participants.push({
    id: `manual-${crypto.randomUUID()}`,
    username: els.manualUsername.value.trim(),
    displayName,
    isExcluded: els.manualExcluded.checked,
    studentOverride: els.manualStudent.checked
  });
  els.manualName.value = "";
  els.manualUsername.value = "";
  els.manualStudent.checked = false;
  els.manualExcluded.checked = false;
  els.manualForm.hidden = true;
  renderParticipants();
  resetGroups();
});

els.students.value = state.studentNames.join("\n");
renderTimer();
renderParticipants();
renderReferenceParticipants();
if (state.studentLoadError) {
  els.studentStatus.textContent = `保存済みの学生リストを読み込めませんでした：${state.studentLoadError.message}`;
} else {
  loadDefaultStudents();
}
