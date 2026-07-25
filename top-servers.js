const byId = id => document.getElementById(id);
const fmt = value => Number(value || 0).toLocaleString();
const signed = value => {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Math.round(Number(value));
  return `${number > 0 ? "+" : ""}${fmt(number)}`;
};
const pct = (online, members) => members ? online / members * 100 : 0;
const THEME_KEY = "discord-stats-theme";

let payload = null;
let visibleServers = [];
let chart = null;
let comparisonMetric = "members";


function downloadTopFile(filename, content, mimeType) {
  const blob = new Blob([content], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function exportTopServers(format) {
  if (!payload?.servers?.length) {
    byId("topError").textContent = "Top Server data has not loaded yet.";
    byId("topError").classList.remove("hidden");
    return;
  }

  const exportedAt = new Date().toISOString();
  const servers = payload.servers.map((server, index) => ({
    rank: index + 1,
    name: server.name,
    inviteCode: server.code,
    inviteUrl: server.inviteUrl,
    members: Number(server.members || 0),
    online: Number(server.online || 0),
    onlineSharePercent: Number(pct(server.online, server.members).toFixed(2)),
    growth24h: server.growth24h ?? null,
    boosts: Number(server.boosts || 0),
    boostTier: Number(server.boostTier || 0),
    activityScore: server.activityScore ?? null,
    verification: server.verificationLabel || "Unknown",
    verified: Boolean(server.verified),
    community: Boolean(server.community),
    discoverable: Boolean(server.discoverable),
    collectedAt: server.collectedAt || payload.updatedAt || null
  }));

  const stamp = exportedAt.slice(0, 10);

  if (format === "json") {
    downloadTopFile(
      `top-discord-servers-${stamp}.json`,
      JSON.stringify({exportedAt, updatedAt: payload.updatedAt, servers}, null, 2),
      "application/json;charset=utf-8"
    );
    return;
  }

  const headers = Object.keys(servers[0]);
  const rows = servers.map(server => headers.map(key => csvValue(server[key])).join(","));
  const csv = [headers.join(","), ...rows].join("\r\n");

  downloadTopFile(
    `top-discord-servers-${stamp}.csv`,
    "\uFEFF" + csv,
    "text/csv;charset=utf-8"
  );
}

function applyTheme(theme, rerender = false) {
  const dark = theme !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  const button = byId("themeToggle");
  if (button) {
    button.classList.toggle("is-light", !dark);
    button.setAttribute("aria-pressed", String(dark));
    button.querySelector("span").textContent = dark ? "Dark mode" : "Light mode";
  }
  if (window.Chart) {
    Chart.defaults.color = dark ? "#94a099" : "#5f6d64";
    Chart.defaults.borderColor = dark ? "#26312b" : "#d7e0da";
  }
  if (rerender && payload) renderChart();
}

function badgeHtml(server) {
  const badges = [];
  if (server.verified) badges.push('<span class="mini-badge verified">✓ Verified</span>');
  if (server.community) badges.push('<span class="mini-badge community">◆ Community</span>');
  if (server.discoverable) badges.push('<span class="mini-badge discoverable">⌕ Discoverable</span>');
  if (server.code === "minecraft") badges.push('<span class="mini-badge featured">★ Featured</span>');
  return badges.join("");
}

function growthClass(value) {
  return value > 0 ? "growth-positive" : value < 0 ? "growth-negative" : "growth-neutral";
}

function sortedServers(servers) {
  const mode = byId("serverSort").value;
  const values = {
    members: server => server.members,
    growth: server => server.growth24h ?? -Infinity,
    online: server => server.online,
    onlineRate: server => pct(server.online, server.members),
    boosts: server => server.boosts || 0,
    activity: server => server.activityScore ?? -Infinity
  };
  return [...servers].sort((a, b) => values[mode](b) - values[mode](a));
}

function renderHighlights(servers) {
  const largest = [...servers].sort((a,b)=>b.members-a.members)[0];
  const fastest = [...servers].filter(s=>s.growth24h != null).sort((a,b)=>b.growth24h-a.growth24h)[0];
  const active = [...servers].sort((a,b)=>pct(b.online,b.members)-pct(a.online,a.members))[0];

  byId("largestServer").textContent = largest?.name || "—";
  byId("largestMembers").textContent = largest ? `${fmt(largest.members)} members · crown leader` : "Waiting for data";
  byId("fastestServer").textContent = fastest?.name || "Not enough history";
  byId("fastestGrowth").textContent = fastest ? `${signed(fastest.growth24h)} members in 24 hours` : "A full 24 hours of data is required";
  byId("mostActiveServer").textContent = active?.name || "—";
  byId("mostActiveRate").textContent = active ? `${pct(active.online,active.members).toFixed(2)}% currently online` : "Waiting for data";
}

function renderLeaderboard(servers) {
  const ranked = [...servers].sort((a,b)=>b.members-a.members);
  const rankByCode = new Map(ranked.map((server,index)=>[server.code,index+1]));

  byId("leaderboardRows").innerHTML = servers.length ? servers.map(server => {
    const rank = rankByCode.get(server.code);
    return `<tr data-code="${server.code}">
      <td class="rank-cell rank-${rank}">${rank === 1 ? "♛ " : ""}#${rank}</td>
      <td><div class="table-server"><img src="${server.iconUrl || "./assets/favicon.svg"}" alt=""><div><strong>${server.name}</strong><small>discord.gg/${server.code}</small></div></div></td>
      <td><strong>${fmt(server.members)}</strong></td>
      <td>${fmt(server.online)} <small>(${pct(server.online,server.members).toFixed(1)}%)</small></td>
      <td class="${growthClass(server.growth24h)}">${signed(server.growth24h)}</td>
      <td>${fmt(server.boosts || 0)} · Tier ${server.boostTier || 0}</td>
      <td><button class="expand-button" data-expand="${server.code}">Expand</button></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="empty">No servers match your search.</td></tr>';
}

function renderCards(servers) {
  const ranked = [...payload.servers].sort((a,b)=>b.members-a.members);
  const rankByCode = new Map(ranked.map((server,index)=>[server.code,index+1]));

  byId("serverCards").innerHTML = servers.map(server => {
    const rank = rankByCode.get(server.code);
    return `<article class="top-server-card" data-code="${server.code}" tabindex="0">
      <div class="card-banner" style="${server.bannerUrl ? `background-image:url('${server.bannerUrl}')` : ""}"></div>
      <span class="card-rank">#${rank}</span>
      ${rank === 1 ? '<span class="crown-mark">♛ Largest server</span>' : ""}
      <div class="card-body">
        <div class="card-title">
          <img src="${server.iconUrl || "./assets/favicon.svg"}" alt="${server.name} icon">
          <div class="card-title-copy"><h2>${server.name}</h2><p>discord.gg/${server.code}</p></div>
        </div>
        <div class="card-badges">${badgeHtml(server) || '<span class="mini-badge">Public invite</span>'}</div>
        <div class="card-stats">
          <div><span>Members</span><strong>${fmt(server.members)}</strong></div>
          <div><span>Online</span><strong>${fmt(server.online)}</strong></div>
          <div><span>24h growth</span><strong class="${growthClass(server.growth24h)}">${signed(server.growth24h)}</strong></div>
          <div><span>Online share</span><strong>${pct(server.online,server.members).toFixed(1)}%</strong></div>
          <div><span>Boosts</span><strong>${fmt(server.boosts || 0)}</strong></div>
          <div><span>Activity</span><strong>${server.activityScore ?? "—"}</strong></div>
        </div>
        <div class="card-footer"><span>${server.description || "Public Discord community"}</span><strong>Click to expand ↗</strong></div>
      </div>
    </article>`;
  }).join("");
}

function renderChart() {
  const canvas = byId("topServersChart");
  if (chart) chart.destroy();

  const metricMap = {
    members:{label:"Members",value:s=>s.members},
    online:{label:"Online",value:s=>s.online},
    growth24h:{label:"24-hour growth",value:s=>s.growth24h ?? 0},
    boosts:{label:"Boosts",value:s=>s.boosts || 0}
  };
  const metric = metricMap[comparisonMetric];
  const dark = document.documentElement.dataset.theme !== "light";
  chart = new Chart(canvas,{
    type:"bar",
    data:{
      labels:visibleServers.map(server=>server.name),
      datasets:[{
        label:metric.label,
        data:visibleServers.map(metric.value),
        backgroundColor:visibleServers.map((_,index)=>index===0 ? "rgba(114,223,85,.72)" : "rgba(78,183,255,.58)"),
        borderColor:visibleServers.map((_,index)=>index===0 ? "#72df55" : "#4eb7ff"),
        borderWidth:1,
        borderRadius:8
      }]
    },
    options:{
      maintainAspectRatio:false,
      responsive:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>`${metric.label}: ${fmt(context.raw)}`}}},
      scales:{
        x:{grid:{display:false}},
        y:{beginAtZero:comparisonMetric!=="growth24h",grid:{color:dark?"#202a24":"#dfe7e1"},ticks:{callback:value=>Number(value).toLocaleString(undefined,{notation:"compact",maximumFractionDigits:1})}}
      }
    }
  });
}

function filterAndRender() {
  if (!payload) return;
  const query = byId("serverSearch").value.trim().toLowerCase();
  visibleServers = sortedServers(payload.servers.filter(server =>
    !query ||
    server.name.toLowerCase().includes(query) ||
    server.code.toLowerCase().includes(query) ||
    String(server.description || "").toLowerCase().includes(query)
  ));
  renderLeaderboard(visibleServers);
  renderCards(visibleServers);
  renderChart();
}

function openModal(code) {
  const server = payload?.servers.find(item=>item.code===code);
  if (!server) return;
  const modal = byId("serverModal");
  byId("modalServerName").textContent = server.name;
  byId("modalIcon").src = server.iconUrl || "./assets/favicon.svg";
  byId("modalDescription").textContent = server.description || "No public server description is provided by this invite.";
  byId("modalBanner").style.backgroundImage = server.bannerUrl ? `url("${server.bannerUrl}")` : "";
  byId("modalBadges").innerHTML = badgeHtml(server) || '<span class="mini-badge">Public invite</span>';
  byId("modalStats").innerHTML = `
    <article><span>Members</span><strong>${fmt(server.members)}</strong></article>
    <article><span>Online</span><strong>${fmt(server.online)}</strong></article>
    <article><span>24h growth</span><strong class="${growthClass(server.growth24h)}">${signed(server.growth24h)}</strong></article>
    <article><span>Online share</span><strong>${pct(server.online,server.members).toFixed(2)}%</strong></article>
    <article><span>Boosts</span><strong>${fmt(server.boosts || 0)}</strong></article>
    <article><span>Boost tier</span><strong>Tier ${server.boostTier || 0}</strong></article>
    <article><span>Activity score</span><strong>${server.activityScore ?? "—"}</strong></article>
    <article><span>Verification</span><strong>${server.verificationLabel || "Unknown"}</strong></article>`;
  byId("modalDetails").innerHTML = `
    <div><span>Invite code</span><strong>${server.code}</strong></div>
    <div><span>Guild ID</span><strong>${server.id || "Unavailable"}</strong></div>
    <div><span>Invite channel</span><strong>${server.channel || "Unavailable"}</strong></div>
    <div><span>Message activity updated</span><strong>${server.activityUpdatedAt ? new Date(server.activityUpdatedAt).toLocaleString() : "Unavailable"}</strong></div>
    <div><span>Latest collection</span><strong>${new Date(server.collectedAt).toLocaleString()}</strong></div>`;
  byId("modalInvite").href = server.inviteUrl;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  byId("serverModal").classList.add("hidden");
  document.body.style.overflow = "";
}

function render(data) {
  payload = data;
  renderHighlights(data.servers);
  byId("topUpdated").textContent = `Updated ${new Date(data.updatedAt).toLocaleString()}`;
  byId("trackerStatus").textContent = data.errors?.length ? "Tracker partially live" : "Tracker live";
  byId("statusSmall").textContent = `${data.servers.length} servers available`;
  byId("statusDot").className = data.errors?.length ? "pulse warning" : "pulse";
  if(data.errors?.length){
    byId("topError").textContent = `Discord temporarily rejected some invite lookups: ${data.errors.join(" | ")}. Cached results remain visible where available.`;
    byId("topError").classList.remove("hidden");
  }else{
    byId("topError").classList.add("hidden");
  }
  filterAndRender();
}

async function load(force=false) {
  const apiBase = String(window.DISCORD_STATS_API || "").replace(/\/$/,"");
  const button = byId("refreshTopButton");
  try {
    button.textContent = force ? "Refreshing…" : "Refresh";
    const path = force ? "/refresh-top-servers" : "/top-servers";
    const response = await fetch(`${apiBase}${path}?cache=${Date.now()}`,{cache:"no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Worker returned ${response.status}`);
    render(data);
  } catch(error) {
    byId("trackerStatus").textContent = "Tracker error";
    byId("statusDot").className = "pulse offline";
    byId("topError").textContent = error.message;
    byId("topError").classList.remove("hidden");
  } finally {
    button.textContent = "Refresh";
  }
}

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
byId("themeToggle").addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark",true));
byId("refreshTopButton").addEventListener("click",()=>load(true));
byId("exportTopButton").addEventListener("click",event=>{
  event.stopPropagation();
  const popover = byId("exportTopPopover");
  const opening = popover.classList.contains("hidden");
  popover.classList.toggle("hidden", !opening);
  byId("exportTopButton").setAttribute("aria-expanded", String(opening));
});
byId("exportTopPopover").addEventListener("click",event=>{
  const button = event.target.closest("[data-top-export]");
  if (!button) return;
  exportTopServers(button.dataset.topExport);
  byId("exportTopPopover").classList.add("hidden");
  byId("exportTopButton").setAttribute("aria-expanded", "false");
});
byId("serverSearch").addEventListener("input",filterAndRender);
byId("serverSort").addEventListener("change",filterAndRender);
byId("comparisonButtons").addEventListener("click",event=>{
  const button = event.target.closest("button[data-metric]");
  if (!button) return;
  comparisonMetric = button.dataset.metric;
  document.querySelectorAll("#comparisonButtons button").forEach(item=>item.classList.toggle("active",item===button));
  renderChart();
});
document.addEventListener("click",event=>{
  if (!event.target.closest(".export-menu")) {
    byId("exportTopPopover")?.classList.add("hidden");
    byId("exportTopButton")?.setAttribute("aria-expanded", "false");
  }
  const target = event.target.closest("[data-expand],.top-server-card,tr[data-code]");
  if (target && !event.target.closest("[data-close-modal]")) openModal(target.dataset.expand || target.dataset.code);
  if (event.target.closest("[data-close-modal]")) closeModal();
});
document.addEventListener("keydown",event=>{
  if (event.key==="Escape") closeModal();
  const card = event.target.closest(".top-server-card");
  if (card && (event.key==="Enter" || event.key===" ")) {event.preventDefault();openModal(card.dataset.code);}
});
load();
setInterval(load,60_000);



