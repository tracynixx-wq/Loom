import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.LOON_CONFIG || {};
const validConfig = cfg.supabaseUrl?.startsWith("https://") && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes("YOUR-PROJECT") && !cfg.supabaseAnonKey.includes("YOUR_");
const $ = (id) => document.getElementById(id);
const escapeText = (value) => String(value ?? "");
let supabase = null, currentUser = null, currentProfile = null, activeConversation = null, realtimeChannel = null;

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

function renderMessage(message) {
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (message.sender_id === currentUser.id ? " mine" : "");
  bubble.textContent = message.body;
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
  } else data.forEach(renderMessage);
  $("messages").scrollTop = $("messages").scrollHeight;
}
async function openConversation(id, title) {
  activeConversation = id;
  $("chatTitle").textContent = title;
  $("chatView").classList.add("open");
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  await loadMessages(id);
  realtimeChannel = supabase.channel("messages-" + id)
    .on("postgres_changes", {event:"INSERT",schema:"public",table:"messages",filter:"conversation_id=eq." + id}, payload => {
      if (payload.new.sender_id !== currentUser.id) {
        const empty = $("messages").querySelector(".empty"); if (empty) empty.remove();
        renderMessage(payload.new); $("messages").scrollTop = $("messages").scrollHeight;
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
    const preview = document.createElement("div"); preview.className = "preview"; preview.textContent = last?.body || "Начните общение";
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
  const { data: profile, error } = await supabase.from("profiles").select("id,username,display_name").eq("id",currentUser.id).single();
  if (error) { showNotice("Профиль не найден: " + error.message,true); return; }
  currentProfile = profile;
  $("authLayer").hidden = true;
  $("accountName").textContent = profile.display_name || "@" + profile.username;
  $("accountHandle").textContent = "@" + profile.username;
  $("signOutBtn").onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  $("editProfileBtn").onclick = async () => {
    const next = prompt("Как тебя показывать в Loon?", currentProfile.display_name || currentProfile.username);
    if (next === null) return;
    const display_name = next.trim().slice(0,40);
    if (!display_name) return showNotice("Имя не может быть пустым.", true);
    const { error } = await supabase.from("profiles").update({display_name}).eq("id", currentUser.id);
    if (error) return showNotice(error.message, true);
    currentProfile.display_name = display_name;
    $("accountName").textContent = display_name;
    showNotice("Имя профиля обновлено.");
  };
  $("notificationsBtn").onclick = async () => {
    if (!("Notification" in window)) return showNotice("Уведомления не поддерживаются этим браузером.", true);
    const permission = await Notification.requestPermission();
    showNotice(permission === "granted" ? "Уведомления разрешены." : permission === "denied" ? "Разрешение отклонено в настройках браузера." : "Разрешение пока не выдано.");
  };
  $("themeBtn").onclick = () => {
    document.body.classList.toggle("light");
    const light = document.body.classList.contains("light");
    $("themeValue").textContent = light ? "Светлое" : "Тёмное";
    document.querySelector('meta[name="theme-color"]').content = light ? "#f5f1fc" : "#090810";
  };
  $("privacyBtn").onclick = () => showNotice("Ваш профиль и переписки доступны только в рамках настроек доступа и участников чатов.");
  $("aboutBtn").onclick = () => showNotice("Loon · версия 0.3 · ранняя версия мессенджера.");

  await loadChats();
}
async function start() {
  if (!validConfig) {
    $("authLayer").hidden = false;
    $("authLayer").innerHTML = '<div class="auth-card"><div class="brand"><i class="moon"></i> Loon</div><h1>Подключение сервера</h1><p class="auth-sub">Чтобы включить регистрацию и реальные чаты, создай проект Supabase и добавь URL и публичный ключ в config.js. Инструкция находится в BACKEND_SETUP.md.</p><p class="auth-foot">Локальные демонстрационные чаты отключены: Loon пока не подключён к серверу.</p></div>';
    return;
  }
  supabase = createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  authScreen();
  const {data:{session}} = await supabase.auth.getSession();
  if (session) await enterApp(session);
  supabase.auth.onAuthStateChange((_event,session)=>{if(session) setTimeout(()=>enterApp(session),0);});
  $("backBtn").onclick=()=>{$("chatView").classList.remove("open");if(realtimeChannel){supabase.removeChannel(realtimeChannel);realtimeChannel=null;}};
  $("sendForm").onsubmit=async event=>{
    event.preventDefault();const input=$("messageInput");const body=input.value.trim();
    if(!body||!activeConversation)return;
    const {data,error}=await supabase.from("messages").insert({conversation_id:activeConversation,sender_id:currentUser.id,body}).select("id,conversation_id,sender_id,body,created_at").single();
    if(error)return showNotice(error.message,true);
    const empty=$("messages").querySelector(".empty");if(empty)empty.remove();
    renderMessage(data);input.value="";$("messages").scrollTop=$("messages").scrollHeight;
  };
  let searchTimer;
  $("userSearch").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchUsers($("userSearch").value),250);});
  $("newBtn").onclick=()=>document.querySelector('[data-screen="contacts"]').click();
  $("searchBtn").onclick=()=>{const field=$("chatSearch");field.hidden=!field.hidden;if(!field.hidden)field.focus();};
  $("chatSearch").addEventListener("input",()=>document.querySelectorAll("#chatList .chat").forEach(c=>c.hidden=!c.textContent.toLowerCase().includes($("chatSearch").value.toLowerCase())));
  const tabs=[...document.querySelectorAll(".tab")],screens=[...document.querySelectorAll(".screen")];
  tabs.forEach(t=>t.addEventListener("click",()=>{tabs.forEach(x=>x.classList.toggle("active",x===t));screens.forEach(s=>s.classList.toggle("active",s.id===t.dataset.screen));}));
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
start().catch(err=>showNotice(err.message||"Ошибка запуска",true));
