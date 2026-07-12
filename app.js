/* Firebase v8 setup */
const firebaseConfig = {
apiKey: "AIzaSyAqY7__bcuhlSmHrJKJ-x4U7hT0DUOuzC4",
authDomain: "chat-13779.firebaseapp.com",
databaseURL: "https://chat-13779-default-rtdb.firebaseio.com",
projectId: "chat-13779",
storageBucket: "chat-13779.appspot.com",
messagingSenderId: "628179138807",
appId: "1:628179138807:web:70a8246ec76f7fd776bbf2",
measurementId: "G-7CS0CD7P5B"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

/* Application State Containers */
let currentUser = null;
let currentRoomId = null;
let activeDmTargetUid = null;
let activeDmTargetName = "";
let typingTimeout = null;
let globalUsersCache = {};

let peer = new Peer();
let currentPeerId = null;
let currentCall = null;
let myStream = null;

/* Screen Broadcast State */
let screenStream = null;
let screenPeers = {};
let screenListeners = {};
let screenStartedByMe = false;

/* Audio Voice Recording State Anchors */
let mediaRecorder = null;
let audioChunks = [];

/* DOM Node Cache pointers */
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const userAvatar = document.getElementById("userAvatar");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");
const avatarFileInput = document.getElementById("avatarFileInput");
const roomsList = document.getElementById("roomsList");
const usersList = document.getElementById("usersList");
const newRoomBtn = document.getElementById("newRoomBtn");
const newGroupBtn = document.getElementById("newGroupBtn");
const messagesEl = document.getElementById("messages");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const voiceRecordBtn = document.getElementById("voiceRecordBtn");
const typingIndicator = document.getElementById("typingIndicator");
const currentRoomNameEl = document.getElementById("currentRoomName");
const dmTargetBanner = document.getElementById("dmTargetBanner");
const clearDmBtn = document.getElementById("clearDmBtn");
const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");
const themeToggle = document.getElementById("themeToggle");
const appEl = document.getElementById("app");

const screenShareFooterBtn = document.getElementById("screenShareBtnFooter") || document.getElementById("screenShareBtn");

/* Private Group Modal Pointers */
const groupModal = document.getElementById("groupModal");
const groupNameInput = document.getElementById("groupNameInput");
const groupMembersChecklist = document.getElementById("groupMembersChecklist");
const submitGroupBtn = document.getElementById("submitGroupBtn");
const closeGroupModalBtn = document.getElementById("closeGroupModalBtn");

const callArea = document.getElementById("callArea");
const myVideo = document.getElementById("myVideo");
const theirVideo = document.getElementById("theirVideo");
const remoteLabel = document.getElementById("remoteLabel");
const videoCallBtn = document.getElementById("videoCallBtn");
const voiceCallBtn = document.getElementById("voiceCallBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const endCallBtn = document.getElementById("endCallBtn");

const authModal = document.getElementById("authModal");
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const loginEmailBtn = document.getElementById("loginEmailBtn");
const signupEmailBtn = document.getElementById("signupEmailBtn");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

function showAuthModal() {
authError.classList.add("hidden");
authError.textContent = "";
authModal.classList.remove("hidden");
}
function hideAuthModal() { authModal.classList.add("hidden"); }

function showCallArea() { callArea.classList.remove("hidden"); }
function hideCallArea() {
callArea.classList.add("hidden");
if (myStream) { myStream.getTracks().forEach(t => t.stop()); myStream = null; }
myVideo.srcObject = null;
theirVideo.srcObject = null;
remoteLabel.textContent = "Remote";
if (currentCall) { currentCall.close(); currentCall = null; }
}

function cleanupScreenBroadcast() {
if (screenStream) {
screenStream.getTracks().forEach(t => t.stop());
screenStream = null;
}
Object.values(screenPeers).forEach(call => {
try { call.close(); } catch (e) {}
});
screenPeers = {};
Object.values(screenListeners).forEach(off => {
try { off(); } catch (e) {}
});
screenListeners = {};
screenStartedByMe = false;
}

function isInRoom() {
return !!currentRoomId && currentRoomId !== "-DefaultRoomLockIndex";
}

function publishScreenState(state) {
if (!isInRoom() || !currentUser) return;
return db.ref(`rooms/${currentRoomId}/screenShare`).set(state);
}

function stopScreenShareSession() {
cleanupScreenBroadcast();
hideCallArea();
if (isInRoom() && currentUser) {
db.ref(`rooms/${currentRoomId}/screenShare`).once("value", snap => {
const val = snap.val();
if (val && val.hostUid === currentUser.uid) {
db.ref(`rooms/${currentRoomId}/screenShare`).remove();
}
});
}
}

function attachRemoteScreenPeer(peerId, hostName, hostUid) {
if (!screenStream) return;
if (screenPeers[peerId]) return;

const call = peer.call(peerId, screenStream, {
metadata: {
screen: true,
callerName: hostName || "Screen Share",
hostUid
}
});

screenPeers[peerId] = call;

call.on("stream", remoteStream => {
theirVideo.srcObject = remoteStream;
remoteLabel.textContent = `${hostName || "Screen"} live`;
showCallArea();
});

call.on("close", () => {
delete screenPeers[peerId];
});

call.on("error", () => {
delete screenPeers[peerId];
});
}

function listenForRoomScreenBroadcast() {
if (!isInRoom() || !currentUser) return;
const ref = db.ref(`rooms/${currentRoomId}/screenShare`);

if (screenListeners[currentRoomId]) {
try { screenListeners[currentRoomId](); } catch (e) {}
}

const handler = ref.on("value", snap => {
const data = snap.val();
if (!data) {
if (!screenStartedByMe) {
hideCallArea();
}
return;
}

if (data.hostUid === currentUser.uid) {
screenStartedByMe = true;
return;
}

screenStartedByMe = false;
remoteLabel.textContent = `${data.hostName || "Someone"} is sharing`;
showCallArea();

const hostPeerId = data.hostPeerId;
if (hostPeerId && currentPeerId) {
if (!screenPeers[hostPeerId]) {
const connectRef = db.ref(`rooms/${currentRoomId}/peers/${hostPeerId}`);
connectRef.once("value", snap2 => {
const hostUid = snap2.val();
if (hostUid) attachRemoteScreenPeer(hostPeerId, data.hostName, hostUid);
});
}
}
});

screenListeners[currentRoomId] = () => ref.off("value", handler);
}

peer.on("open", id => {
currentPeerId = id;
if (currentUser && currentRoomId) {
db.ref(`rooms/${currentRoomId}/peers/${id}`).set(currentUser.uid);
}
});

peer.on("call", incomingCall => {
const needsVideo = incomingCall.options.metadata?.video !== false;
const callerName = incomingCall.options.metadata?.callerName || "Remote User";
const isScreen = incomingCall.options.metadata?.screen === true;

const proceedWithAnswer = (localStream) => {
myStream = localStream;
myVideo.srcObject = localStream;
remoteLabel.textContent = callerName;
showCallArea();
incomingCall.answer(localStream);
handleCall(incomingCall);
};

if (myStream && myStream.active) {
proceedWithAnswer(myStream);
} else if (isScreen) {
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(proceedWithAnswer)
.catch(err => console.error("Media permission block on inbound stream:", err));
} else {
navigator.mediaDevices.getUserMedia({ video: needsVideo, audio: true })
.then(proceedWithAnswer)
.catch(err => console.error("Media permission block on inbound stream:", err));
}
});

/* ==========================================================================
PROFILE PICTURE CHANGE UPLOADER
========================================================================== */
changeAvatarBtn.onclick = () => {
if (!currentUser) { showAuthModal(); return; }
avatarFileInput.click();
};

avatarFileInput.onchange = (e) => {
const file = e.target.files[0];
if (!file) return;

if (file.size > 800000) {
alert("Image size too large! Please choose an image smaller than 800KB.");
return;
}

const reader = new FileReader();
reader.onloadend = () => {
const base64String = reader.result;
userAvatar.src = base64String;
userAvatar.classList.remove("hidden");

if (currentUser) {
db.ref(`users/${currentUser.uid}/photo`).set(base64String);
if(globalUsersCache[currentUser.uid]) {
globalUsersCache[currentUser.uid].photo = base64String;
}
if (currentRoomId) {
db.ref(`rooms/${currentRoomId}/users/${currentUser.uid}/photo`).set(base64String);
}
}
};
reader.readAsDataURL(file);
};

/* ==========================================================================
PROFILE CUSTOM NAME ENGINE
========================================================================== */
userInfo.onclick = () => {
if (!currentUser) return;
const preferredName = prompt("Choose your custom display name:", userInfo.textContent);
if (preferredName && preferredName.trim()) {
currentUser.updateProfile({ displayName: preferredName.trim() }).then(() => {
userInfo.textContent = preferredName.trim();
db.ref(`users/${currentUser.uid}/name`).set(preferredName.trim());
if (currentRoomId) {
db.ref(`rooms/${currentRoomId}/users/${currentUser.uid}/name`).set(preferredName.trim());
}
}).catch(console.error);
}
};

/* ==========================================================================
AUTHENTICATION INTERACTION
========================================================================== */
tabLogin.onclick = () => {
tabLogin.classList.add("active"); tabSignup.classList.remove("active");
loginForm.classList.add("active"); signupForm.classList.remove("active");
};
tabSignup.onclick = () => {
tabSignup.classList.add("active"); tabLogin.classList.remove("active");
signupForm.classList.add("active"); loginForm.classList.remove("active");
};
closeModalBtn.onclick = hideAuthModal;
loginBtn.onclick = showAuthModal;

loginEmailBtn.onclick = () => {
const email = loginEmail.value.trim(); const pass = loginPassword.value.trim();
if (!email || !pass) { authError.textContent = "Enter credentials."; authError.classList.remove("hidden"); return; }
auth.signInWithEmailAndPassword(email, pass).then(hideAuthModal).catch(err => { authError.textContent = err.message; authError.classList.remove("hidden"); });
};

signupEmailBtn.onclick = () => {
const email = signupEmail.value.trim(); const pass = signupPassword.value.trim();
if (!email || !pass) { authError.textContent = "Enter values."; authError.classList.remove("hidden"); return; }
auth.createUserWithEmailAndPassword(email, pass).then(hideAuthModal).catch(err => { authError.textContent = err.message; authError.classList.remove("hidden"); });
};

googleLoginBtn.onclick = () => {
const provider = new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider).then(hideAuthModal).catch(err => { authError.textContent = err.message; authError.classList.remove("hidden"); });
};

logoutBtn.onclick = () => { leaveRoom(); auth.signOut(); };

auth.onAuthStateChanged(user => {
currentUser = user;
if (user) {
const name = user.displayName || user.email || "User";
userInfo.textContent = name;
changeAvatarBtn.classList.remove("hidden");
loginBtn.classList.add("hidden"); logoutBtn.classList.remove("hidden");

msgInput.disabled = false;
sendBtn.disabled = false;
voiceRecordBtn.disabled = false;
msgInput.placeholder = "Message...";

db.ref(`users/${user.uid}`).once("value", snap => {
const userData = snap.val();
const photo = (userData && userData.photo) ? userData.photo : (user.photoURL || "");
if (photo) {
userAvatar.src = photo;
userAvatar.classList.remove("hidden");
} else {
userAvatar.classList.add("hidden");
}

db.ref("users/" + user.uid).update({ uid: user.uid, name, email: user.email || null, lastSeen: Date.now() });
if(photo) { db.ref("users/" + user.uid).update({ photo: photo }); }
});

loadRooms();
loadGlobalUsers();
} else {
userInfo.textContent = "";
userAvatar.classList.add("hidden");
changeAvatarBtn.classList.add("hidden");
loginBtn.classList.remove("hidden"); logoutBtn.classList.add("hidden");
roomsList.innerHTML = ""; usersList.innerHTML = ""; messagesEl.innerHTML = "";
currentRoomNameEl.textContent = "Select a room"; currentRoomId = null;
clearDmState();

msgInput.disabled = true;
sendBtn.disabled = true;
voiceRecordBtn.disabled = true;
msgInput.value = "";
msgInput.placeholder = "Sign in to join the conversation...";
}
});

/* ==========================================================================
ROOMS & CUSTOM GROUPS MANAGEMENT
========================================================================== */
function loadRooms() {
db.ref("rooms").on("value", snap => { renderRooms(snap.val() || {}); });
}

function renderRooms(rooms) {
roomsList.innerHTML = "";
Object.keys(rooms).forEach(roomId => {
const room = rooms[roomId];
if (room.members && (!currentUser || !room.members[currentUser.uid])) return;

const div = document.createElement("div");
div.className = "room-item" + (roomId === currentRoomId && !activeDmTargetUid ? " active" : "");
div.textContent = (room.members ? "🔒 " : "# ") + (room.name || roomId);
div.onclick = () => joinRoom(roomId, room.name);
roomsList.appendChild(div);
});
}

newRoomBtn.onclick = () => {
if (!currentUser) { showAuthModal(); return; }
const name = prompt("Public Room name:");
if (!name) return;
const roomRef = db.ref("rooms").push({ name });
joinRoom(roomRef.key, name);
};

newGroupBtn.onclick = () => {
if (!currentUser) { showAuthModal(); return; }
groupNameInput.value = "";
groupMembersChecklist.innerHTML = "";

Object.keys(globalUsersCache).forEach(uid => {
if (uid === currentUser.uid) return;
const label = document.createElement("label");
label.className = "member-checkbox-label";
label.innerHTML = `<input type="checkbox" value="${uid}"> ${globalUsersCache[uid].name || "User"}`;
groupMembersChecklist.appendChild(label);
});

groupModal.classList.remove("hidden");
};

closeGroupModalBtn.onclick = () => groupModal.classList.add("hidden");

submitGroupBtn.onclick = () => {
const gName = groupNameInput.value.trim();
if (!gName) return alert("Please specify a group name!");

const checkedBoxes = groupMembersChecklist.querySelectorAll('input[type="checkbox"]:checked');
const membersMap = {};
membersMap[currentUser.uid] = true;
checkedBoxes.forEach(cb => { membersMap[cb.value] = true; });

const newGroupRef = db.ref("rooms").push({ name: gName, members: membersMap });
groupModal.classList.add("hidden");
joinRoom(newGroupRef.key, gName);
};

function joinRoom(roomId, name) {
if (!currentUser) { showAuthModal(); return; }
leaveRoom();
currentRoomId = roomId;
currentRoomNameEl.textContent = name || roomId;
clearDmState();
refreshActiveSidebarStates();

db.ref(`users/${currentUser.uid}/photo`).once("value", snap => {
const currentPhotoUrl = snap.val() || "";
if (currentPeerId) { db.ref(`rooms/${roomId}/peers/${currentPeerId}`).set(currentUser.uid); }
db.ref(`rooms/${roomId}/users/${currentUser.uid}`).set({
name: currentUser.displayName || currentUser.email || "User",
photo: currentPhotoUrl || null,
peerId: currentPeerId || null
});
});

subscribeToMessages();
subscribeToTyping();
subscribeToCallStatus();
listenForRoomScreenBroadcast();
}

function leaveRoom() {
if (currentRoomId && currentUser) {
if (currentPeerId) { db.ref(`rooms/${currentRoomId}/peers/${currentPeerId}`).remove(); }
db.ref(`rooms/${currentRoomId}/users/${currentUser.uid}`).remove();
db.ref(`rooms/${currentRoomId}/activeCall`).once("value", snap => {
if (snap.val() && snap.val().hostUid === currentUser.uid) {
db.ref(`rooms/${currentRoomId}/activeCall`).remove();
}
});
db.ref(`rooms/${currentRoomId}/screenShare`).once("value", snap => {
if (snap.val() && snap.val().hostUid === currentUser.uid) {
db.ref(`rooms/${currentRoomId}/screenShare`).remove();
}
});
}
stopScreenShareSession();
}
window.addEventListener("beforeunload", leaveRoom);

/* ==========================================================================
GLOBAL DIRECT MESSAGES USERS LIST LOADER
========================================================================== */
function loadGlobalUsers() {
db.ref("users").on("value", snap => {
globalUsersCache = snap.val() || {};
renderGlobalUsers(globalUsersCache);
});
}

function renderGlobalUsers(users) {
usersList.innerHTML = "";
Object.keys(users).forEach(uid => {
if (uid === currentUser?.uid) return;
const user = users[uid];

const div = document.createElement("div");
div.className = "user-item" + (uid === activeDmTargetUid ? " active" : "");

const img = document.createElement("img");
img.className = "dm-avatar";

if (user.photo) {
img.src = user.photo;
} else {
img.src = "data:image/svg+xml;utf8,";
}

const textNode = document.createTextNode(user.name || "User");

div.appendChild(img);
div.appendChild(textNode);
div.onclick = () => switchPrivateDmViewMode(uid, user.name || "User");
usersList.appendChild(div);
});
}

/* ==========================================================================
CALL LOCKING CONTROLS
========================================================================== */
function subscribeToCallStatus() {
if (!currentRoomId) return;
db.ref(`rooms/${currentRoomId}/activeCall`).on("value", snap => {
const activeCall = snap.val();
if (activeCall && activeCall.hostUid !== currentUser.uid) {
videoCallBtn.disabled = true; videoCallBtn.textContent = "🔒";
voiceCallBtn.disabled = true; voiceCallBtn.textContent = "🔒";
screenShareBtn.disabled = true; screenShareBtn.textContent = "🔒";
} else {
videoCallBtn.disabled = !currentUser; videoCallBtn.textContent = "🎥";
voiceCallBtn.disabled = !currentUser; voiceCallBtn.textContent = "🎤";
screenShareBtn.disabled = !currentUser; screenShareBtn.textContent = "🖥️";
}
});
}

screenShareBtn.onclick = startScreenShare;
if (screenShareFooterBtn) screenShareFooterBtn.onclick = startScreenShare;

/* ==========================================================================
MESSAGING ENGINE WITH EMBEDDED CUSTOM WAVEFORM AUDIO PLAYER
========================================================================== */
function sendSystemMessage(text, action = null, targetCallHostPeerId = null) {
if (!currentRoomId) return;
db.ref(`messages/${currentRoomId}`).push({
text,
uid: "SYSTEM",
username: "System",
timestamp: Date.now(),
action,
targetCallHostPeerId
});
}

function subscribeToMessages() {
if (!currentRoomId) return;
messagesEl.innerHTML = "";
db.ref(`messages/${currentRoomId}`).off();
db.ref(`messages/${currentRoomId}`).on("child_added", snap => {
addMessageToUI(snap.val());
});
}

function addMessageToUI(msg) {
if (activeDmTargetUid) {
const isDirectMatch = (msg.uid === currentUser.uid && msg.dmTargetUid === activeDmTargetUid) ||
(msg.uid === activeDmTargetUid && msg.dmTargetUid === currentUser.uid);
if (!isDirectMatch && msg.uid !== "SYSTEM") return;
} else {
if (msg.dmTargetUid) return;
}

if (msg.uid === "SYSTEM") {
const div = document.createElement("div");
div.className = "system-message";
const textSpan = document.createElement("span");
textSpan.textContent = msg.text;
div.appendChild(textSpan);

if (msg.action && msg.targetCallHostPeerId) {
const btn = document.createElement("button");
btn.className = "join-call-btn";
btn.textContent = "Join Call";
btn.onclick = () => connectToExistingCallSession(msg.targetCallHostPeerId, msg.action);
div.appendChild(btn);
}
messagesEl.appendChild(div);
messagesEl.scrollTop = messagesEl.scrollHeight;
return;
}

const div = document.createElement("div");
div.className = "message" + (currentUser && msg.uid === currentUser.uid ? " self" : "");

const avatarImg = document.createElement("img");
avatarImg.className = "message-avatar";

if (currentUser && msg.uid === currentUser.uid) {
avatarImg.src = userAvatar.src || "";
} else if (globalUsersCache[msg.uid] && globalUsersCache[msg.uid].photo) {
avatarImg.src = globalUsersCache[msg.uid].photo;
} else {
avatarImg.src = "data:image/svg+xml;utf8,";
}
div.appendChild(avatarImg);

const contentBlock = document.createElement("div");
contentBlock.className = "message-content-block";

const meta = document.createElement("div");
meta.className = "message-meta";

const authorSpan = document.createElement("span");
authorSpan.textContent = msg.username || "User";
if (currentUser && msg.uid !== currentUser.uid) {
authorSpan.className = "clickable-author";
authorSpan.onclick = () => switchPrivateDmViewMode(msg.uid, msg.username);
}

const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
meta.appendChild(authorSpan);
meta.appendChild(document.createTextNode(` • ${time}`));

if (msg.dmTargetUid) {
const dmBadge = document.createElement("span");
dmBadge.style.color = "var(--accent)";
dmBadge.textContent = " [DM]";
meta.appendChild(dmBadge);
}

const textDiv = document.createElement("div");
textDiv.className = "message-text";

if (msg.audioData) {
const audioEl = document.createElement("audio");
audioEl.src = msg.audioData;

const playerWrapper = document.createElement("div");
playerWrapper.className = "audio-player-container";

const playBtn = document.createElement("button");
playBtn.className = "audio-play-btn";
playBtn.innerHTML = "▶";

const waveform = document.createElement("div");
waveform.className = "audio-waveform-visual";
for (let i = 0; i < 14; i++) {
const bar = document.createElement("span");
bar.className = "waveform-bar";
waveform.appendChild(bar);
}

const durationDisplay = document.createElement("span");
durationDisplay.className = "audio-duration";
durationDisplay.textContent = "0:00";

audioEl.onloadedmetadata = () => {
const mins = Math.floor(audioEl.duration / 60);
const secs = Math.floor(audioEl.duration % 60).toString().padStart(2, "0");
durationDisplay.textContent = `${mins}:${secs}`;
};

playBtn.onclick = () => {
if (audioEl.paused) {
document.querySelectorAll("audio").forEach(el => { if(el !== audioEl) el.pause(); });
audioEl.play();
playBtn.innerHTML = "⏸";
playerWrapper.classList.add("playing");
} else {
audioEl.pause();
}
};

audioEl.onpause = () => {
playBtn.innerHTML = "▶";
playerWrapper.classList.remove("playing");
};

audioEl.onended = () => {
playBtn.innerHTML = "▶";
playerWrapper.classList.remove("playing");
};

audioEl.ontimeupdate = () => {
const mins = Math.floor(audioEl.currentTime / 60);
const secs = Math.floor(audioEl.currentTime % 60).toString().padStart(2, "0");
durationDisplay.textContent = `${mins}:${secs}`;
};

playerWrapper.appendChild(audioEl);
playerWrapper.appendChild(playBtn);
playerWrapper.appendChild(waveform);
playerWrapper.appendChild(durationDisplay);
textDiv.appendChild(playerWrapper);
} else {
textDiv.textContent = msg.text;
}

contentBlock.appendChild(meta);
contentBlock.appendChild(textDiv);
div.appendChild(contentBlock);

messagesEl.appendChild(div);
messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendMessage() {
if (!currentUser) { showAuthModal(); return; }
if (!currentRoomId) { alert("Please select a room channel first before initializing messages!"); return; }
const text = msgInput.value.trim();
if (!text) return;

const msg = {
text,
uid: currentUser.uid,
username: currentUser.displayName || currentUser.email || "User",
timestamp: Date.now()
};

if (activeDmTargetUid) { msg.dmTargetUid = activeDmTargetUid; }
db.ref(`messages/${currentRoomId}`).push(msg);
msgInput.value = "";
setTyping(false);
}

function switchPrivateDmViewMode(uid, username) {
if (!currentUser) { showAuthModal(); return; }
if (!currentRoomId) {
currentRoomId = "-DefaultRoomLockIndex";
currentRoomNameEl.textContent = "Private Chat Context";
}
activeDmTargetUid = uid;
activeDmTargetName = username;
dmTargetBanner.classList.remove("hidden");
dmTargetBanner.querySelector("span").textContent = `Talking to ${username}`;
refreshActiveSidebarStates();
subscribeToMessages();
}

function clearDmState() {
activeDmTargetUid = null;
activeDmTargetName = "";
dmTargetBanner.classList.add("hidden");
}

function refreshActiveSidebarStates() {
Array.from(roomsList.children).forEach(el => el.classList.toggle("active", !activeDmTargetUid && el.textContent.substring(2) === currentRoomNameEl.textContent));
Array.from(usersList.children).forEach(el => {
el.classList.toggle("active", activeDmTargetUid && el.textContent.includes(activeDmTargetName));
});
}

clearDmBtn.onclick = () => {
clearDmState();
if (currentRoomId === "-DefaultRoomLockIndex") {
currentRoomNameEl.textContent = "Select a room";
messagesEl.innerHTML = "";
} else {
subscribeToMessages();
}
refreshActiveSidebarStates();
};

sendBtn.onclick = sendMessage;
msgInput.addEventListener("keydown", e => {
if (e.key === "Enter" && !e.shiftKey) {
e.preventDefault();
sendMessage();
} else {
setTyping(true);
}
});

/* ==========================================================================
NAMED REALTIME TYPING SYSTEM
========================================================================== */
function setTyping(isTyping) {
if (!currentRoomId || !currentUser) return;

const myName = currentUser.displayName || currentUser.email || "User";
db.ref(`typing/${currentRoomId}/${currentUser.uid}`).set(isTyping ? myName : null);

if (isTyping) {
clearTimeout(typingTimeout);
typingTimeout = setTimeout(() => {
db.ref(`typing/${currentRoomId}/${currentUser.uid}`).set(null);
}, 3000);
}
}

function subscribeToTyping() {
typingIndicator.textContent = "";
db.ref(`typing/${currentRoomId}`).off();

db.ref(`typing/${currentRoomId}`).on("value", snap => {
const data = snap.val() || {};
const typingNames = [];
Object.keys(data).forEach(uid => {
if (uid !== currentUser?.uid && data[uid]) {
typingNames.push(data[uid]);
}
});

if (typingNames.length === 1) {
typingIndicator.textContent = `${typingNames[0]} is typing...`;
} else if (typingNames.length === 2) {
typingIndicator.textContent = `${typingNames[0]} and ${typingNames[1]} are typing...`;
} else if (typingNames.length > 2) {
typingIndicator.textContent = "Several people are typing...";
} else {
typingIndicator.textContent = "";
}
});
}

/* ==========================================================================
MEDIARECORDER NATIVE VOICE RECORDING CORE INTERACTION
========================================================================== */
voiceRecordBtn.onclick = () => {
if (!currentUser) return showAuthModal();
if (!currentRoomId) return alert("Select a room channel before recording voice notes!");

if (mediaRecorder && mediaRecorder.state === "recording") {
mediaRecorder.stop();
voiceRecordBtn.classList.remove("recording");
voiceRecordBtn.title = "Record Voice Message";
} else {
navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
audioChunks = [];
mediaRecorder = new MediaRecorder(stream);

mediaRecorder.ondataavailable = e => {
if (e.data.size > 0) audioChunks.push(e.data);
};

mediaRecorder.onstop = () => {
const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
if (audioBlob.size < 2000) return;

const reader = new FileReader();
reader.onloadend = () => {
const base64Audio = reader.result;
const voiceMessageNode = {
uid: currentUser.uid,
username: currentUser.displayName || currentUser.email || "User",
timestamp: Date.now(),
audioData: base64Audio
};

if (activeDmTargetUid) voiceMessageNode.dmTargetUid = activeDmTargetUid;
db.ref(`messages/${currentRoomId}`).push(voiceMessageNode);
};
reader.readAsDataURL(audioBlob);
stream.getTracks().forEach(track => track.stop());
};

mediaRecorder.start();
voiceRecordBtn.classList.add("recording");
voiceRecordBtn.title = "Stop Recording & Send";
}).catch(err => {
console.error(err);
alert("Microphone capture access blocked.");
});
}
};

/* Utilities */
emojiBtn.onclick = () => { if (!currentUser) { showAuthModal(); return; } emojiPicker.classList.toggle("hidden"); };
emojiPicker.onclick = e => {
const emoji = e.target.textContent.trim();
if (!emoji || e.target === emojiPicker) return;
msgInput.value += emoji + " ";
msgInput.focus();
};
document.addEventListener("click", e => { if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add("hidden"); });

themeToggle.onclick = () => {
const isDark = appEl.classList.contains("dark");
appEl.classList.toggle("dark", !isDark);
appEl.classList.toggle("light", isDark);
themeToggle.textContent = isDark ? "☀️" : "🌙";
};

/* ==========================================================================
WEBRTC INTEGRATED CALL HANDLERS
========================================================================== */
function handleCall(call) {
currentCall = call;
call.on("stream", remoteStream => { theirVideo.srcObject = remoteStream; });
call.on("close", () => { hideCallArea(); });
call.on("error", err => { console.error(err); hideCallArea(); });
}

async function initializeSessionLockProcedure(type, constraints) {
if (!currentUser) return showAuthModal();
if (!isInRoom()) return alert("Select a channel room first.");

const check = await db.ref(`rooms/${currentRoomId}/activeCall`).once("value");
if (check.exists() && check.val().hostUid !== currentUser.uid) {
alert("A call session is already running inside this room!");
return;
}

try {
myStream = await navigator.mediaDevices.getUserMedia(constraints);
myVideo.srcObject = myStream;
showCallArea();

await db.ref(`rooms/${currentRoomId}/activeCall`).set({
hostUid: currentUser.uid,
hostPeerId: currentPeerId,
hostName: currentUser.displayName || currentUser.email || "User",
type: type,
timestamp: Date.now()
});

const hostLabelName = currentUser.displayName || currentUser.email || "Someone";
sendSystemMessage(`${hostLabelName} started a ${type} call`, type, currentPeerId);
} catch (err) {
console.error(err);
alert("Could not initialize call configurations.");
}
}

videoCallBtn.onclick = () => startVideoCall();
voiceCallBtn.onclick = () => startVoiceCall();
endCallBtn.onclick = () => hideCallArea();

function startVideoCall() { initializeSessionLockProcedure("video", { video: true, audio: true }); }
function startVoiceCall() { initializeSessionLockProcedure("voice", { video: false, audio: true }); }

async function startScreenShare() {
if (!currentUser) return showAuthModal();
if (!isInRoom()) return alert("Select a channel room first.");

const check = await db.ref(`rooms/${currentRoomId}/screenShare`).once("value");
if (check.exists() && check.val().hostUid !== currentUser.uid) {
return alert("Screen sharing is already live in this room.");
}

try {
screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
myStream = screenStream;
myVideo.srcObject = screenStream;
remoteLabel.textContent = "Live Screen Share";
showCallArea();

const hostLabelName = currentUser.displayName || currentUser.email || "Someone";

await publishScreenState({
hostUid: currentUser.uid,
hostPeerId: currentPeerId,
hostName: hostLabelName,
timestamp: Date.now(),
live: true
});

screenStartedByMe = true;
sendSystemMessage(`${hostLabelName} started screen sharing`, "screen", currentPeerId);

screenStream.getVideoTracks()[0].addEventListener("ended", async () => {
stopScreenShareSession();
});
} catch (err) {
console.error("Screen share failed:", err);
alert("Screen share failed.");
}
}

screenShareBtn.onclick = startScreenShare;

async function connectToExistingCallSession(targetHostPeerId, actionType) {
if (!currentUser) return showAuthModal();
if (!targetHostPeerId) return;

const requireVideo = (actionType === "video" || actionType === "screen");
try {
myStream = await navigator.mediaDevices.getUserMedia({ video: requireVideo, audio: true });
myVideo.srcObject = myStream;
showCallArea();

const callerName = currentUser.displayName || currentUser.email || "User";
const call = peer.call(targetHostPeerId, myStream, {
metadata: {
video: requireVideo,
callerName: callerName
}
});
handleCall(call);
} catch (err) {
console.error("Failed to connect to call session:", err);
}
}
/* Ctrl+S Redirect to Google Classroom */
document.addEventListener("keydown", function(e) {
    if (e.ctrlKey && e.key === "s") {
        e.preventDefault(); // Prevents browser's default "Save" behavior
        window.location.href = "https://classroom.google.com/";
    }
});