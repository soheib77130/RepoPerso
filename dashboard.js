const SUPABASE_URL = "https://skfqoyyoahuaffshimnc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yxLCOU94zhGck9yvGYch5Q_ePCPd9Yq";
const sb = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
});

let currentUserId = null;
let currentRequest = null;
let selectedRating = 0;
let realtimeChannel = null;

// DOM refs
const welcomeTitle = document.getElementById("welcomeTitle");
const kpiRequests = document.getElementById("kpiRequests");
const kpiBudget = document.getElementById("kpiBudget");
const kpiRating = document.getElementById("kpiRating");
const requestList = document.getElementById("requestList");
const completedList = document.getElementById("completedList");
const chatList = document.getElementById("chatList");
const chatTitle = document.getElementById("chatTitle");
const chatStatus = document.getElementById("chatStatus");
const chatHint = document.getElementById("chatHint");
const chatMessages = document.getElementById("chatMessages");
const chatActions = document.getElementById("chatActions");
const chatInputArea = document.getElementById("chatInputArea");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const supportBtn = document.getElementById("supportBtn");
const paymentModal = document.getElementById("paymentModal");
const paymentPrice = document.getElementById("paymentPrice");
const confirmPayment = document.getElementById("confirmPayment");
const cancelPayment = document.getElementById("cancelPayment");
const ratingModal = document.getElementById("ratingModal");
const ratingStars = document.getElementById("ratingStars");
const ratingComment = document.getElementById("ratingComment");
const submitRating = document.getElementById("submitRating");
const skipRating = document.getElementById("skipRating");

// ---- AUTH ----
async function init() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) { window.location.href = "connexion.html"; return; }
  if (user.user_metadata?.role && user.user_metadata.role !== "client") {
    await sb.auth.signOut(); window.location.href = "connexion.html"; return;
  }
  currentUserId = user.id;
  const { data: profile } = await sb.from("clients").select("firstname,lastname").eq("user_id", user.id).maybeSingle();
  const name = [profile?.firstname, profile?.lastname].filter(Boolean).join(" ");
  if (welcomeTitle) welcomeTitle.textContent = name ? `Bonjour ${name}` : "Tableau de bord client";
  await refreshAll();
  setupRealtime();
}
init();

// ---- LOGOUT ----
document.querySelectorAll("[data-logout]").forEach(b => b.addEventListener("click", async e => {
  e.preventDefault();
  try { await sb?.auth.signOut(); } catch (_) {}
  Object.keys(localStorage).forEach(k => { if (k.includes("sb-") && k.includes("-auth-token")) localStorage.removeItem(k); });
  window.location.href = "index.html";
}));

// ---- REFRESH ----
async function refreshAll() {
  await loadRequests().catch(() => {});
  await loadKPIs().catch(() => {});
  await loadRating().catch(() => {});
}

async function loadKPIs() {
  try {
    const { data, error } = await sb.from("requests").select("id,status,negotiated_price,budget").eq("client_user_id", currentUserId);
    if (error || !data) return;
    const active = data.filter(r => !["termine", "annule", "verification"].includes(r.status));
    if (kpiRequests) kpiRequests.textContent = active.length;
    const totalBudget = data.reduce((s, r) => s + Number(r.negotiated_price || r.budget || 0), 0);
    if (kpiBudget) kpiBudget.textContent = totalBudget + " €";
  } catch (_) {}
}

async function loadRating() {
  try {
    const { data, error } = await sb.from("ratings").select("score").eq("rated_user_id", currentUserId);
    if (error || !data || data.length === 0) { if (kpiRating) kpiRating.textContent = "—"; return; }
    const avg = data.reduce((s, r) => s + Number(r.score), 0) / data.length;
    if (kpiRating) kpiRating.textContent = avg.toFixed(1) + " / 10";
  } catch (_) { if (kpiRating) kpiRating.textContent = "—"; }
}

function formatStatus(s) {
  const m = { nouveau: "Nouveau", en_attente: "En attente", negociation: "Négociation", en_attente_paiement: "En attente de paiement", en_cours: "En cours", verification: "Vérification", termine: "Terminé", annule: "Annulé" };
  return m[s] || s || "Nouveau";
}

function statusPillClass(s) {
  if (s === "en_cours") return "green";
  if (s === "negociation") return "yellow";
  if (s === "en_attente_paiement") return "yellow";
  if (s === "verification") return "yellow";
  if (s === "termine") return "green";
  if (s === "annule") return "red";
  return "";
}

async function loadRequests() {
  try {
  const { data, error } = await sb.from("requests")
    .select("id,title,status,created_at,negotiated_price,budget,assigned_indep_user_id,category,skills,match_summary,deadline")
    .eq("client_user_id", currentUserId).order("created_at", { ascending: false }).limit(20);
  if (error || !data) {
    if (requestList) requestList.innerHTML = '<li class="hint">Aucune demande trouvée.</li>';
    if (chatList) chatList.innerHTML = '<li class="hint">Aucune conversation.</li>';
    if (completedList) completedList.innerHTML = '<li class="hint">Aucune mission terminée.</li>';
    return;
  }

  const active = data.filter(r => !["termine", "annule"].includes(r.status));
  const done = data.filter(r => ["termine", "annule"].includes(r.status));

  if (active.length === 0) {
    requestList.innerHTML = '<li class="hint">Aucune demande en cours.</li>';
  } else {
    requestList.innerHTML = active.map(r => `<li class="req-item" data-id="${r.id}"><div><div class="title">${r.title}</div><div class="meta">${r.category || ""} · ${r.budget ? r.budget + " €" : ""}</div></div><span class="pill ${statusPillClass(r.status)}">${formatStatus(r.status)}</span></li>`).join("");
  }

  if (done.length === 0) {
    completedList.innerHTML = '<li class="hint">Aucune mission terminée.</li>';
  } else {
    completedList.innerHTML = done.map(r => `<li class="req-item" data-id="${r.id}"><div><div class="title">${r.title}</div></div><span class="pill ${statusPillClass(r.status)}">${formatStatus(r.status)}</span></li>`).join("");
  }

  // Chat sidebar
  const withIndep = data.filter(r => r.assigned_indep_user_id || ["negociation", "en_cours", "verification"].includes(r.status));
  if (withIndep.length === 0) {
    chatList.innerHTML = '<li class="hint">Aucune conversation.</li>';
  } else {
    chatList.innerHTML = withIndep.map(r => `<li class="req-item" data-chat="${r.id}"><div class="title">${r.title}</div><span class="pill ${statusPillClass(r.status)}" style="font-size:10px">${formatStatus(r.status)}</span></li>`).join("");
  }

  // Bind clicks
  document.querySelectorAll("[data-id]").forEach(el => el.addEventListener("click", () => openConversation(el.dataset.id)));
  document.querySelectorAll("[data-chat]").forEach(el => el.addEventListener("click", () => openConversation(el.dataset.chat)));
  } catch (err) {
    console.error("loadRequests error:", err);
    if (requestList) requestList.innerHTML = '<li class="hint">Erreur de connexion. Rechargez la page.</li>';
    if (chatList) chatList.innerHTML = '<li class="hint">Aucune conversation.</li>';
  }
}

// ---- CONVERSATION ----
async function openConversation(requestId) {
  const { data: req } = await sb.from("requests")
    .select("id,title,status,spec_checklist,negotiated_price,match_summary,assigned_indep_user_id,budget,deadline")
    .eq("id", requestId).eq("client_user_id", currentUserId).maybeSingle();
  if (!req) return;
  currentRequest = req;

  // Highlight active
  document.querySelectorAll("[data-chat]").forEach(el => el.classList.toggle("active", String(el.dataset.chat) === String(requestId)));

  chatTitle.textContent = req.title || "Discussion";
  chatStatus.textContent = formatStatus(req.status);
  chatInputArea.style.display = "flex";

  // Actions
  let actionsHtml = "";

  // Cancel button: available before mission is en_cours
  if (["nouveau", "en_attente", "negociation"].includes(req.status)) {
    actionsHtml += `<button class="btn sm danger" id="cancelMissionBtn">Annuler la mission</button>`;
  }


  // Negotiation: show propose price + accept current price (only if indep proposed last)
  if (req.status === "negociation") {
    actionsHtml += `<button class="btn sm primary" id="acceptPriceBtn" style="display:none">Accepter le prix (${req.negotiated_price || req.budget || "?"} €)</button>`;
    actionsHtml += `<button class="btn sm danger" id="declineProposalBtn">Refuser la candidature</button>`;
  }

  // Payment pending: show pay button
  if (req.status === "en_attente_paiement") {
    actionsHtml += `<button class="btn sm primary" id="payNowBtn" style="background:linear-gradient(135deg,#f59e0b,#f97316);box-shadow:0 10px 20px rgba(245,158,11,.3)">Payer maintenant</button>`;
    actionsHtml += `<button class="btn sm danger" id="cancelMissionBtn">Annuler</button>`;
  }

  // Verification: show status info
  if (req.status === "verification") {
    actionsHtml += `<span class="pill yellow">En vérification par l'admin</span>`;
  }

  // Terminé: show deliverables link + rating
  if (req.status === "termine") {
    actionsHtml += `<button class="btn sm primary" id="viewDeliverablesBtn">Voir les livrables</button>`;
    actionsHtml += `<button class="btn sm" id="rateBtn" style="display:none">Noter</button>`;
  }

  chatActions.innerHTML = actionsHtml;

  // Bind action buttons
  document.getElementById("cancelMissionBtn")?.addEventListener("click", cancelMission);
  document.getElementById("acceptPriceBtn")?.addEventListener("click", acceptPrice);
  document.getElementById("declineProposalBtn")?.addEventListener("click", declineProposal);
  document.getElementById("viewDeliverablesBtn")?.addEventListener("click", viewDeliverables);
  document.getElementById("rateBtn")?.addEventListener("click", () => openRatingModal());
  document.getElementById("payNowBtn")?.addEventListener("click", () => {
    window.location.href = "paiement.html?request_id=" + currentRequest.id;
  });

  // Check who proposed last price - client can only accept if indep proposed last
  if (req.status === "negociation") {
    const { data: priceMsgs } = await sb.from("request_messages")
      .select("body").eq("request_id", req.id).eq("sender_role", "system")
      .like("body", "%prix propos%")
      .order("created_at", { ascending: false }).limit(1);
    const lastPriceMsg = priceMsgs?.[0]?.body || "";
    const indepProposed = lastPriceMsg.includes("ind\u00e9pendant") || lastPriceMsg.includes("independant") || lastPriceMsg.includes("Candidature");
    // Also check initial candidature (indep always proposes first when applying)
    const { data: anyClientPrice } = await sb.from("request_messages")
      .select("id").eq("request_id", req.id).eq("sender_role", "system")
      .like("body", "%client propose%").limit(1);
    const clientEverProposed = anyClientPrice && anyClientPrice.length > 0;
    // Show accept button only if the other party proposed last
    const acceptBtn = document.getElementById("acceptPriceBtn");
    if (acceptBtn) {
      // If no explicit client price msg exists, indep proposed (via candidature) so client CAN accept
      // If last price msg is from indep, client CAN accept
      // If last price msg is from client, client CANNOT accept (they proposed last)
      const lastIsClient = lastPriceMsg.includes("client");
      acceptBtn.style.display = lastIsClient ? "none" : "inline-flex";
    }
  }

  // Check if already rated before showing rate button
  if (req.status === "termine") {
    const { data: existingRating } = await sb.from("ratings")
      .select("id").eq("request_id", req.id).eq("rater_user_id", currentUserId).maybeSingle();
    const rateBtn = document.getElementById("rateBtn");
    if (rateBtn) {
      if (existingRating) {
        rateBtn.textContent = "Déjà noté";
        rateBtn.disabled = true;
      }
      rateBtn.style.display = "inline-flex";
    }
  }

  // Negotiation bar for proposing price
  let negoBarHtml = "";
  if (req.status === "negociation") {
    negoBarHtml = `<div style="display:flex;gap:8px;align-items:center;padding:10px;border-top:1px solid rgba(255,255,255,.06)">
      <input type="number" id="clientPriceInput" placeholder="Proposer un prix (€)" min="0" value="${req.negotiated_price || ""}" style="max-width:200px;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(17,24,39,.7);color:var(--text);font-weight:600" />
      <button class="btn sm primary" id="clientProposePriceBtn">Proposer ce prix</button>
    </div>`;
  }

  // Insert nego bar after chat input
  const existingNegoBar = document.getElementById("clientNegoBar");
  if (existingNegoBar) existingNegoBar.remove();
  if (negoBarHtml) {
    const negoDiv = document.createElement("div");
    negoDiv.id = "clientNegoBar";
    negoDiv.innerHTML = negoBarHtml;
    chatInputArea.parentNode.insertBefore(negoDiv, chatInputArea.nextSibling);
    document.getElementById("clientProposePriceBtn")?.addEventListener("click", proposePrice);
  }

  if (req.status === "negociation") {
    const displayedPrice = req.negotiated_price || req.budget || "à définir";
    chatHint.textContent = `Négociation — Prix actuel : ${displayedPrice} €. Proposez un prix ou acceptez celui de l'indépendant.`;
  } else if (req.status === "en_attente_paiement") {
    const price = req.negotiated_price || req.budget || 0;
    const fee = Math.round((price * 0.05 + 0.70) * 100) / 100;
    chatHint.textContent = `Prix accepté : ${price} € + ${fee} € de protection = ${(price + fee).toFixed(2)} € TTC. Cliquez sur "Payer maintenant" pour lancer la mission.`;
  } else if (req.status === "en_cours") {
    chatHint.textContent = "Mission en cours — L'indépendant travaille sur votre demande.";
  } else if (req.status === "verification") {
    chatHint.textContent = "L'indépendant a livré. Un administrateur vérifie les livrables.";
  } else if (req.status === "termine") {
    chatHint.textContent = "Mission terminée — Vos livrables sont disponibles. Pensez à noter l'indépendant !";
  } else {
    chatHint.textContent = req.match_summary || "En attente d'un indépendant.";
  }

  await loadMessages();
  subscribeMessages(requestId);
}

async function loadMessages() {
  if (!currentRequest) return;
  const { data: msgs } = await sb.from("request_messages")
    .select("sender_role,body,created_at").eq("request_id", currentRequest.id)
    .order("created_at", { ascending: true });

  const merged = msgs || [];
  if (merged.length === 0) {
    chatMessages.innerHTML = '<div class="hint" style="text-align:center;margin:auto">Aucun message pour le moment.</div>';
    return;
  }

  chatMessages.innerHTML = merged.map(m => {
    const time = new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `<div class="msg ${m.sender_role}"><div>${m.body}</div><div class="time">${time}</div></div>`;
  }).join("");
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ---- SEND MESSAGE ----
sendBtn?.addEventListener("click", sendMessage);
msgInput?.addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

async function sendMessage() {
  if (!currentRequest || !msgInput.value.trim()) return;
  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "client",
    channel: "fil",
    body: msgInput.value.trim()
  });
  msgInput.value = "";
  await loadMessages();
}

// ---- PROPOSE PRICE (CLIENT) ----
async function proposePrice() {
  if (!currentRequest) return;
  const input = document.getElementById("clientPriceInput");
  if (!input || !input.value) return;
  const price = Number(input.value);
  if (!price || price <= 0) { alert("Entrez un prix valide."); return; }

  await sb.from("requests").update({ negotiated_price: price }).eq("id", currentRequest.id);
  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "system",
    channel: "fil",
    body: `Le client propose un nouveau prix : ${price} \u20ac`
  });
  await loadMessages();
  await openConversation(currentRequest.id);
}

// ---- ACCEPT PRICE (CLIENT) ----
async function acceptPrice() {
  if (!currentRequest) return;
  const price = currentRequest.negotiated_price || currentRequest.budget || 0;
  const fee = Math.round((price * 0.05 + 0.70) * 100) / 100;
  const total = (price + fee).toFixed(2);
  const ok = window.confirm(`Accepter le prix de ${price} € ?\nFrais de protection : ${fee} €\nTotal à payer : ${total} €\n\nVous serez redirigé vers la page de paiement.`);
  if (!ok) return;

  const { error } = await sb.from("requests").update({
    status: "en_attente_paiement"
  }).eq("id", currentRequest.id).eq("client_user_id", currentUserId);

  if (error) {
    alert("Impossible d'accepter le prix pour le moment.");
    return;
  }

  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "system",
    channel: "fil",
    body: `Le client a accepté le prix de ${price} €. En attente du paiement.`
  }).catch(() => {});

  // Redirect to payment page
  window.location.href = "paiement.html?request_id=" + currentRequest.id;
}

async function declineProposal() {
  if (!currentRequest) return;
  const ok = window.confirm("Refuser cette candidature ? La mission repassera en attente.");
  if (!ok) return;
  const { error } = await sb.from("requests").update({
    assigned_indep_user_id: null,
    status: "en_attente",
    negotiated_price: null,
    match_summary: "Candidature refusée par le client. Mission remise en attente."
  }).eq("id", currentRequest.id).eq("client_user_id", currentUserId);
  if (error) {
    alert("Impossible de refuser l'offre pour le moment.");
    return;
  }
  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "system",
    channel: "fil",
    body: "Le client a refusé la candidature. La mission a été remise en attente."
  }).catch(() => {});
  await refreshAll();
  chatMessages.innerHTML = '<div class="hint" style="text-align:center;margin:auto">Candidature refusée. En attente d\'un nouvel indépendant.</div>';
  if (chatInputArea) chatInputArea.style.display = "none";
  if (chatActions) chatActions.innerHTML = "";
  if (chatStatus) chatStatus.textContent = "En attente";
}

// ---- CANCEL MISSION ----
async function cancelMission() {
  if (!currentRequest) return;
  const ok = window.confirm("Annuler cette mission ? Cette action est irréversible.");
  if (!ok) return;
  const { error } = await sb.from("requests").update({
    status: "annule",
    assigned_indep_user_id: null,
    match_summary: "Mission annulée par le client."
  }).eq("id", currentRequest.id).eq("client_user_id", currentUserId);
  if (error) {
    alert("Impossible d'annuler la mission pour le moment.");
    return;
  }
  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "system",
    channel: "fil",
    body: "La mission a été annulée par le client."
  }).catch(() => {});
  alert("Mission annulée.");
  await refreshAll();
  chatMessages.innerHTML = '<div class="hint" style="text-align:center;margin:auto">Mission annulée.</div>';
  if (chatInputArea) chatInputArea.style.display = "none";
  if (chatActions) chatActions.innerHTML = "";
}

// ---- VIEW DELIVERABLES ----
async function viewDeliverables() {
  if (!currentRequest) return;
  const { data } = await sb.from("deliverables").select("file_name,file_url,file_size,uploaded_at")
    .eq("request_id", currentRequest.id).order("uploaded_at", { ascending: false });
  if (!data || data.length === 0) {
    alert("Aucun livrable trouvé pour cette mission.");
    return;
  }
  let html = '<div style="padding:10px"><h3 style="margin-bottom:12px">Livrables</h3>';
  data.forEach(f => {
    const size = f.file_size ? (f.file_size / 1024).toFixed(1) + " Ko" : "";
    const url = f.file_url && !f.file_url.startsWith("simulated://") ? f.file_url : "";
    const downloadBtn = url ? `<a href="${url}" target="_blank" class="btn sm" style="margin-left:8px">Télécharger</a>` : `<span class="hint" style="margin-left:8px">Fichier simulé</span>`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);margin-bottom:6px;font-size:13px"><span>${f.file_name}</span><div style="display:flex;align-items:center;gap:4px"><span class="hint">${size}</span>${downloadBtn}</div></div>`;
  });
  html += '</div>';
  chatMessages.innerHTML = html;
}

// ---- REALTIME ----
function setupRealtime() {
  sb.channel("client-requests-" + currentUserId)
    .on("postgres_changes", { event: "*", schema: "public", table: "requests", filter: `client_user_id=eq.${currentUserId}` },
      () => { refreshAll(); if (currentRequest) openConversation(currentRequest.id); })
    .subscribe();
}

function subscribeMessages(requestId) {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel("chat-" + requestId)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "request_messages", filter: `request_id=eq.${requestId}` },
      () => loadMessages())
    .subscribe();
}

// ---- PAYMENT ----
function openPaymentModal() {
  if (!currentRequest) return;
  const price = currentRequest.negotiated_price || currentRequest.budget || 0;
  paymentPrice.textContent = price + " €";
  paymentModal.classList.add("show");
}

cancelPayment?.addEventListener("click", () => paymentModal.classList.remove("show"));

confirmPayment?.addEventListener("click", async () => {
  if (!currentRequest) return;
  const price = currentRequest.negotiated_price || currentRequest.budget || 0;
  await sb.from("payments").insert({
    request_id: currentRequest.id,
    client_user_id: currentUserId,
    indep_user_id: currentRequest.assigned_indep_user_id,
    amount: price,
    status: "paid",
    paid_at: new Date().toISOString()
  }).catch(() => {});
  await sb.from("request_messages").insert({
    request_id: currentRequest.id,
    sender_user_id: currentUserId,
    sender_role: "system",
    channel: "fil",
    body: `Paiement de ${price} € confirmé.`
  });
  paymentModal.classList.remove("show");
  await refreshAll();
  await openConversation(currentRequest.id);
});

// ---- RATING ----
function initRatingStars() {
  ratingStars.innerHTML = "";
  for (let i = 1; i <= 10; i++) {
    const star = document.createElement("div");
    star.className = "star";
    star.textContent = i;
    star.addEventListener("click", () => {
      selectedRating = i;
      ratingStars.querySelectorAll(".star").forEach((s, idx) => s.classList.toggle("active", idx < i));
    });
    ratingStars.appendChild(star);
  }
}
initRatingStars();

function openRatingModal() {
  selectedRating = 0;
  ratingComment.value = "";
  ratingStars.querySelectorAll(".star").forEach(s => s.classList.remove("active"));
  ratingModal.classList.add("show");
}

skipRating?.addEventListener("click", () => ratingModal.classList.remove("show"));

submitRating?.addEventListener("click", async () => {
  if (!currentRequest || selectedRating === 0) { alert("Choisissez une note."); return; }
  const { error: ratingError } = await sb.from("ratings").insert({
    request_id: currentRequest.id,
    rater_user_id: currentUserId,
    rated_user_id: currentRequest.assigned_indep_user_id,
    rater_role: "client",
    score: selectedRating,
    comment: ratingComment.value.trim() || null
  });
  if (ratingError) {
    if (ratingError.message && ratingError.message.includes("unique")) {
      alert("Vous avez déjà noté cette mission.");
    } else {
      alert("Erreur lors de l'envoi de la note.");
    }
    ratingModal.classList.remove("show");
    return;
  }
  ratingModal.classList.remove("show");
  alert("Merci pour votre évaluation !");
  // Check if both parties have rated -> close mission
  const { data: allRatings } = await sb.from("ratings")
    .select("rater_role").eq("request_id", currentRequest.id);
  const roles = (allRatings || []).map(r => r.rater_role);
  if (roles.includes("client") && roles.includes("independant")) {
    await sb.from("requests").update({ status: "termine" }).eq("id", currentRequest.id);
  }
  await loadRating();
  await refreshAll();
  if (currentRequest) await openConversation(currentRequest.id);
});

supportBtn?.addEventListener("click", () => alert("Support contacté (démo). Réponse sous 24h."));
