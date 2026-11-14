import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.LOON_CONFIG || {};
const validConfig = cfg.supabaseUrl?.startsWith("https://") && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes("YOUR-PROJECT") && !cfg.supabaseAnonKey.includes("YOUR_");
const $ = (id) => document.getElementById(id);
const escapeText = (value) => String(value ?? "");
let supabase = null, currentUser = null, currentProfile = null, activeConversation = null, realtimeChannel = null;


const encoder = new TextEncoder();
const decoder = new TextDecoder();
const conversationKeys = new Map();
let devicePrivateKey = null, devicePublicKey = null, e2eeReady = false;
const bytesToBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const base64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function openKeyDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open("loon-crypto",1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readDeviceKey(userId) {
  const db = await openKeyDatabase();
  return new Promise((resolve,reject) => {
    const request = db.transaction("keys","readonly").objectStore("keys").get(userId);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function saveDeviceKey(userId,record) {
  const db = await openKeyDatabase();
  return new Promise((resolve,reject) => {
    const tx = db.transaction("keys","readwrite");
    tx.objectStore("keys").put(record,userId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function ensureDeviceEncryption(profile) {
  if (!crypto || !crypto.subtle || !indexedDB) throw new Error("На этом устройстве браузер не поддерживает локальное шифрование.");
  const stored = await readDeviceKey(currentUser.id);
  if (stored) {
    devicePrivateKey = stored.privateKey;
    devicePublicKey = stored.publicKey;
    if (profile.e2ee_public_key && profile.e2ee_public_key !== devicePublicKey) {
      throw new Error("Ключ аккаунта не совпадает с ключом на устройстве. Не создавай новый ключ: история защищена.");
    }
  } else if (profile.e2ee_public_key) {
    throw new Error("Ключ этого аккаунта уже создан на другом устройстве. Перенос и восстановление ключа пока не поддерживаются.");
  } else {
    const pair = await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
    const publicRaw = await crypto.subtle.exportKey("raw",pair.publicKey);
    const privateRaw = await crypto.subtle.exportKey("pkcs8",pair.privateKey);
    devicePrivateKey = await crypto.subtle.importKey("pkcs8",privateRaw,{name:"ECDH",namedCurve:"P-256"},false,["deriveBits"]);
    devicePublicKey = bytesToBase64(publicRaw);
    await saveDeviceKey(currentUser.id,{privateKey:devicePrivateKey,publicKey:devicePublicKey});
  }
  if (!profile.e2ee_public_key) {
    const {error} = await supabase.from("profiles").update({e2ee_public_key:devicePublicKey}).eq("id",currentUser.id);
    if (error) throw new Error("Не удалось сохранить открытый ключ: " + error.message);
  }
  e2eeReady = true;
}
async function getConversationKey(conversationId) {
  if (conversationKeys.has(conversationId)) return conversationKeys.get(conversationId);
  if (!e2eeReady || !devicePrivateKey) throw new Error("Шифрование на этом устройстве не настроено.");
  const {data:members,error:membersError} = await supabase.from("conversation_members").select("user_id").eq("conversation_id",conversationId);
  if (membersError) throw membersError;
  const peer = (members || []).find(member => member.user_id !== currentUser.id);
  if (!peer) throw new Error("Не найден второй участник чата.");
  const {data:profile,error} = await supabase.from("profiles").select("e2ee_public_key").eq("id",peer.user_id).single();
  if (error) throw error;
  if (!profile || !profile.e2ee_public_key) throw new Error("У собеседника ещё не настроено шифрование. Попроси его открыть Loon на своём устройстве.");
  const publicKey = await crypto.subtle.importKey("raw",base64ToBytes(profile.e2ee_public_key),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared = await crypto.subtle.deriveBits({name:"ECDH",public:publicKey},devicePrivateKey,256);
  const hkdfKey = await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {name:"HKDF",hash:"SHA-256",salt:encoder.encode(conversationId),info:encoder.encode("Loon E2EE v1")},
    hkdfKey,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]
  );
  conversationKeys.set(conversationId,key);
  return key;
}
async function encryptMessage(plaintext,conversationId) {
  const key = await getConversationKey(conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(plaintext));
  return "LOON1." + bytesToBase64(iv) + "." + bytesToBase64(ciphertext);
}
async function decryptMessage(value,conversationId) {
  if (!value.startsWith("LOON1.")) return value;
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Неверный формат сообщения.");
  const key = await getConversationKey(conversationId);
  const plaintext = await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(parts[1])},key,base64ToBytes(parts[2]));
  return decoder.decode(plaintext);
}

function showNotice(message, isError = false) {
  const el = $("notice");
  el.textContent = message;
  el.style.color = isError ? "#ff9b9b" : "#b99aff";
  el.hidden = false;
}
function authScreen() {
  $("authLayer").hidden = false;
  $("authLayer").innerHTML = `
    <div class="auth-card">
      <div class="brand"><i class="moon"></i> Loon</div>
      <h1>Добро пожаловать</h1>
      <p class="auth-sub">Войди или создай аккаунт Loon</p>
      <div class="auth-switch"><button id="loginMode" class="selected">Войти</button><button id="signupMode">Регистрация</button></div>
      <form id="authForm">
        <div id="usernameField" hidden><label>Имя пользователя</label><input name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" placeholder="например, loon_user"></div>
        <div id="displayField" hidden><label>Как к тебе обращаться</label><input name="displayName" maxlength="40" placeholder="Имя"></div>
        <label>Email</label><input name="email" type="email" autocomplete="email" required placeholder="name@example.com">
        <label>Пароль</label><input name="password" type="password" minlength="8" autocomplete="current-password" required placeholder="Минимум 8 символов">
        <button class="auth-submit" type="submit">Войти</button>
        <p id="authError" class="auth-error"></p>
      </form>
      <p class="auth-foot">Твои сообщения доступны только участникам соответствующего чата.</p>
    </div>`;
  let mode = "login";
  const setMode = (next) => {
    mode = next;
    $("loginMode").classList.toggle("selected", mode === "login");
    $("signupMode").classList.toggle("selected", mode === "signup");
    $("usernameField").hidden = mode !== "signup";
    $("displayField").hidden = mode !== "signup";
    $("authForm").querySelector(".auth-submit").textContent = mode === "login" ? "Войти" : "Создать аккаунт";
  };
  $("loginMode").onclick = () => setMode("login");
  $("signupMode").onclick = () => setMode("signup");
  $("authForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    const error = $("authError");
    error.textContent = "";
    try {
      if (mode === "signup") {
        const username = String(form.get("username")).trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Имя пользователя: 3–24 символа, только a-z, 0-9 и _.");
        const { data, error: err } = await supabase.auth.signUp({
          email, password, options: {
            data: { username, display_name: String(form.get("displayName") || "").trim() },
            emailRedirectTo: location.origin + location.pathname
          }
        });
        if (err) throw err;
        if (!data.session) {
          error.textContent = "Аккаунт создан. Подтверди email по ссылке из письма, затем войди.";
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) { error.textContent = err.message || "Не удалось выполнить вход."; }
  };
}

async function renderMessage(message) {
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (message.sender_id === currentUser.id ? " mine" : "");
  try { bubble.textContent = await decryptMessage(message.body,message.conversation_id); }
  catch { bubble.textContent = "🔒 Не удалось расшифровать: ключ может быть на другом устройстве."; }
  const stamp = document.createElement("small");
  stamp.className = "message-time";
  stamp.textContent = new Date(message.created_at).toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"});
  bubble.append(stamp);
  $("messages").append(bubble);
}
async function loadMessages(conversationId) {
  const { data, error } = await supabase.from("messages").select("id,conversation_id,sender_id,body,created_at").eq("conversation_id", conversationId).order("created_at", {ascending:true}).limit(200);
  if (error) return showNotice(error.message, true);
  $("messages").replaceChildren();
  if (!data.length) {
    const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Начните общение в Loon 👋"; $("messages").append(empty);
  } else for (const message of data) await renderMessage(message);
  $("messages").scrollTop = $("messages").scrollHeight;
}
async function openConversation(id, title) {
  activeConversation = id;
  $("chatTitle").textContent = title;
  $("chatView").classList.add("open");
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  try {
    await getConversationKey(id);
    $("chatSecurity").textContent = "🔒 Сквозное шифрование включено";
    $("messageInput").disabled = false;
    $("messageInput").placeholder = "Зашифрованное сообщение...";
    $("sendForm").querySelector("button").disabled = false;
  } catch (error) {
    $("chatSecurity").textContent = "⚠ Шифрование недоступно";
    $("messageInput").disabled = true;
    $("messageInput").placeholder = "Нельзя отправить без ключа";
    $("sendForm").querySelector("button").disabled = true;
    showNotice(error.message,true);
  }
  await loadMessages(id);
  realtimeChannel = supabase.channel("messages-" + id)
    .on("postgres_changes", {event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq." + id}, payload => {
      if (payload.new.sender_id !== currentUser.id) {
        const empty = $("messages").querySelector(".empty"); if (empty) empty.remove();
        await renderMessage(payload.new); $("messages").scrollTop = $("messages").scrollHeight;
      }
    }).subscribe();
}
async function loadChats() {
  const list = $("chatList");
  list.replaceChildren();
  const { data: memberships, error } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", currentUser.id);
  if (error) return showNotice(error.message, true);
  if (!memberships.length) {
    const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Пока нет чатов. Найди пользователя во вкладке «Контакты»."; list.replaceChildren(empty); return;
  }
  const ids = memberships.map(x => x.conversation_id);
  const { data: allMembers } = await supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids);
  const otherIds = [...new Set((allMembers || []).filter(x => x.user_id !== currentUser.id).map(x => x.user_id))];
  const { data: profiles } = otherIds.length ? await supabase.from("profiles").select("id,username,display_name").in("id", otherIds) : {data:[]};
  const profileById = new Map((profiles || []).map(x => [x.id,x]));
  for (const id of ids) {
    const member = (allMembers || []).find(x => x.conversation_id === id && x.user_id !== currentUser.id);
    const profile = member ? profileById.get(member.user_id) : null;
    if (!profile) continue;
    const { data: last } = await supabase.from("messages").select("body,created_at").eq("conversation_id",id).order("created_at",{ascending:false}).limit(1).maybeSingle();
    const button = document.createElement("button"); button.className = "chat";
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = (profile.display_name || profile.username).slice(0,1).toUpperCase();
    const details = document.createElement("span"); details.className = "details";
    const name = document.createElement("div"); name.className = "name"; name.textContent = profile.display_name || "@" + profile.username;
    const preview = document.createElement("div"); preview.className = "preview"; preview.textContent = last?.body ? (last.body.startsWith("LOON1.") ? "🔒 Зашифрованное сообщение" : last.body) : "Начните общение";
    details.append(name,preview); button.append(avatar,details);
    button.onclick = () => openConversation(id, profile.display_name || "@" + profile.username);
    list.append(button);
  }
}
async function searchUsers(value) {
  const results = $("contactResults"); results.replaceChildren();
  const query = value.trim().replace(/^@/,"").toLowerCase();
  if (query.length < 2) return;
  const { data, error } = await supabase.from("profiles").select("id,username,display_name").ilike("username", query + "%").neq("id",currentUser.id).limit(15);
  if (error) return showNotice(error.message,true);
  if (!data.length) { const empty=document.createElement("div");empty.className="empty";empty.textContent="Пользователи не найдены.";results.append(empty);return; }
  data.forEach(profile => {
    const button=document.createElement("button");button.className="chat";
    const avatar=document.createElement("span");avatar.className="avatar";avatar.textContent=(profile.display_name||profile.username).slice(0,1).toUpperCase();
    const details=document.createElement("span");details.className="details";
    const name=document.createElement("div");name.className="name";name.textContent=profile.display_name||profile.username;
    const handle=document.createElement("div");handle.className="preview";handle.textContent="@"+profile.username;
    details.append(name,handle);button.append(avatar,details);
    button.onclick=async()=>{try{const {data,error}=await supabase.rpc("open_direct_conversation",{target_username:profile.username});if(error)throw error;await loadChats();await openConversation(data,profile.display_name||"@"+profile.username);$("contactResults").replaceChildren();$("userSearch").value="";}catch(err){showNotice(err.message,true);}};
    results.append(button);
  });
}
async function enterApp(session) {
  currentUser = session.user;
  const { data: profile, error } = await supabase.from("profiles").select("id,username,display_name,e2ee_public_key").eq("id",currentUser.id).single();
  if (error) { showNotice("Профиль не найден: " + error.message,true); return; }
  currentProfile = profile;
  try { await ensureDeviceEncryption(profile); showNotice("🔒 Шифрование настроено на этом устройстве."); }
  catch (cryptoError) { e2eeReady = false; showNotice(cryptoError.message,true); }
  $("profileAvatar").textContent = (profile.display_name || profile.username).slice(0,1).toUpperCase();
  $("authLayer").hidden = true;
  $("accountName").textContent = profile.display_name || "@" + profile.username;
  $("accountHandle").textContent = "@" + profile.username;
  const bind = (id, handler) => { const element = $(id); if (element) element.onclick = handler; };
  bind("signOutBtn", async () => {
    const {error} = await supabase.auth.signOut();
    if (error) return showNotice(error.message,true);
    location.reload();
  });
  bind("editProfileBtn", async () => {
    const next = prompt("Как тебя показывать в Loon?", currentProfile.display_name || currentProfile.username);
    if (next === null) return;
    const display_name = next.trim().slice(0,40);
    if (!display_name) return showNotice("Имя не может быть пустым.", true);
    const {error} = await supabase.from("profiles").update({display_name}).eq("id",currentUser.id);
    if (error) return showNotice(error.message,true);
    currentProfile.display_name = display_name;
    $("accountName").textContent = display_name;
    $("profileAvatar").textContent = display_name.slice(0,1).toUpperCase();
    showNotice("Имя профиля обновлено.");
  });
  bind("notificationsBtn", async () => {
    if (!("Notification" in window)) return showNotice("Уведомления пока не поддерживаются этим браузером.");
    if (Notification.permission === "granted") return showNotice("Разрешение на уведомления уже включено.");
    if (Notification.permission === "denied") return showNotice("Разреши уведомления для Loon в настройках iPhone.");
    const permission = await Notification.requestPermission();
    $("notificationValue").textContent = permission === "granted" ? "Включены" : "Настроить";
    showNotice(permission === "granted" ? "Разрешение получено." : "Разрешение не предоставлено.");
  });
  const applyTheme = (theme) => {
    document.body.classList.toggle("light",theme === "light");
    $("themeValue").textContent = theme === "light" ? "Светлая" : "Тёмная";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#f5f1fc" : "#090810";
  };
  let selectedTheme = localStorage.getItem("loon-theme") || "dark";
  applyTheme(selectedTheme);
  bind("themeBtn", () => {
    selectedTheme = selectedTheme === "dark" ? "light" : "dark";
    localStorage.setItem("loon-theme",selectedTheme);
    applyTheme(selectedTheme);
  });
  bind("privacyBtn", () => showNotice("Доступ к перепискам ограничен участниками соответствующего чата. Не передавай никому пароль и коды входа."));
  bind("aboutBtn", () => showNotice("Loon · версия 0.3.1 · ранняя версия мессенджера."));
  await loadChats();
}
async function start() {
  if (!validConfig) {
    $("authLayer").hidden = false;
    $("authLayer").innerHTML = '<div class="auth-card"><div class="brand"><i class="moon"></i> Loon</div><h1>Подключение сервера</h1><p class="auth-sub">Чтобы включить регистрацию и реальные чаты, создай проект Supabase и добавь URL и публичный ключ в config.js. Инструкция находится в BACKEND_SETUP.md.</p><p class="auth-foot">Локальные демонстрационные чаты отключены: Loon пока не подключён к серверу.</p></div>';
    return;
  }
  supabase = createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const tabs=[...document.querySelectorAll(".tab")],screens=[...document.querySelectorAll(".screen")];
  tabs.forEach(tab=>tab.addEventListener("click",()=>{
    tabs.forEach(item=>item.classList.toggle("active",item===tab));
    screens.forEach(screen=>screen.classList.toggle("active",screen.id===tab.dataset.screen));
    window.scrollTo({top:0,behavior:"smooth"});
  }));
  authScreen();
  const {data:{session}} = await supabase.auth.getSession();
  if (session) await enterApp(session);
  supabase.auth.onAuthStateChange((_event,session)=>{if(session) setTimeout(()=>enterApp(session),0);});
  $("backBtn").onclick=()=>{$("chatView").classList.remove("open");if(realtimeChannel){supabase.removeChannel(realtimeChannel);realtimeChannel=null;}};
  $("sendForm").onsubmit=async event=>{
    event.preventDefault();const input=$("messageInput");const plaintext=input.value.trim();
    if(!plaintext||!activeConversation)return;
    const submit=$("sendForm").querySelector("button");submit.disabled=true;
    try {
      const body=await encryptMessage(plaintext,activeConversation);
      const {data,error}=await supabase.from("messages").insert({conversation_id:activeConversation,sender_id:currentUser.id,body}).select("id,conversation_id,sender_id,body,created_at").single();
      if(error)throw error;
      const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
      await renderMessage(data);input.value="";$("messages").scrollTop=$("messages").scrollHeight;
    } catch(error) { showNotice("Сообщение не отправлено: "+error.message,true); }
    finally { submit.disabled=false; }
  };
  let searchTimer;
  $("userSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchUsers($("userSearch").value),250);});
  $("newBtn").onclick=()=>document.querySelector('[data-screen="contacts"]').click();
  $("searchBtn").onclick=()=>{const field=$("chatSearch");field.hidden=!field.hidden;if(!field.hidden)field.focus();};
  $("chatSearch").addEventListener("input",()=>document.querySelectorAll("#chatList .chat").forEach(c=>c.hidden=!c.textContent.toLowerCase().includes($("chatSearch").value.toLowerCase())));
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
start().catch(err=>showNotice(err.message||"Ошибка запуска",true));
