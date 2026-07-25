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


function renderFeaturedMinecraft(server) {
  if(!server) {
    byId("featuredMinecraft")?.classList.add("hidden");
    return;
  }

  byId("featuredMinecraft")?.classList.remove("hidden");
  byId("featuredMinecraftName").textContent = server.name || "Minecraft";
  byId("featuredMinecraftDescription").textContent =
    server.description || "The official Minecraft Discord community.";
  byId("featuredMinecraftMembers").textContent = fmt(server.members);
  byId("featuredMinecraftOnline").textContent = fmt(server.online);
  byId("featuredMinecraftRate").textContent =
    server.members ? `${pct(server.online,server.members).toFixed(1)}%` : "—";

  const icon = byId("featuredMinecraftIcon");
  if(icon && server.iconUrl) icon.src = server.iconUrl;

  const link = byId("featuredMinecraftLink");
  if(link) link.href = server.inviteUrl || "https://discord.gg/minecraft";
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


function serverKey(server) {
  return String(
    server?.id ||
    server?.code ||
    server?.slug ||
    server?.name ||
    ""
  ).toLowerCase();
}

function renderLeaderboard(servers) {
  const ranked = [...servers].sort((a,b)=>b.members-a.members);
  const rankByCode = new Map(ranked.map((server,index)=>[serverKey(server),index+1]));

  byId("leaderboardRows").innerHTML = servers.length ? servers.map(server => {
    const rank = rankByCode.get(serverKey(server));
    return `<tr data-code="${serverKey(server)}">
      <td class="rank-cell rank-${rank}">${rank === 1 ? "♛ " : ""}#${rank}</td>
      <td><div class="table-server"><img src="${server.iconUrl || "./assets/favicon.svg"}" alt=""><div><strong>${server.name}</strong><small>discord.gg/${server.code}</small></div></div></td>
      <td><strong>${fmt(server.members)}</strong></td>
      <td>${fmt(server.online)} <small>(${pct(server.online,server.members).toFixed(1)}%)</small></td>
      <td class="${growthClass(server.growth24h)}">${signed(server.growth24h)}</td>
      <td>${server.boosts == null ? "—" : `${fmt(server.boosts)} · Tier ${server.boostTier ?? "—"}`}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="6" class="empty">No servers match your search.</td></tr>';
}

function renderCards(servers) {
  const container = byId("serverCards");
  if(!container) return;

  const ranked = [...payload.servers].sort((a,b)=>b.members-a.members);
  const rankByCode = new Map(ranked.map((server,index)=>[serverKey(server),index+1]));

  container.innerHTML = servers.map(server => {
    const rank = rankByCode.get(serverKey(server));
    return `<article class="top-server-card" data-code="${serverKey(server)}" tabindex="0">
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
  data.servers = [...(data.servers || [])].sort((a,b)=>b.members-a.members).slice(0,10);
  renderFeaturedMinecraft(data.featuredServer);
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
  if(!selectedCompareKeys.length && data.servers?.length){
    selectedCompareKeys = data.servers.slice(0,3).map(stableServerKey);
  }
  renderCustomComparison();
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



let discoveryPayload = null;
let discoveryPage = 1;

function discoverySorted(servers) {
  const mode = byId("discoverySort")?.value || "discovery";
  const query = (byId("discoverySearch")?.value || "").trim().toLowerCase();
  const filtered = servers.filter(server =>
    !query ||
    String(server.name || "").toLowerCase().includes(query) ||
    String(server.description || "").toLowerCase().includes(query)
  );

  const copy = [...filtered];
  if(mode === "members") copy.sort((a,b)=>b.members-a.members);
  if(mode === "online") copy.sort((a,b)=>b.online-a.online);
  if(mode === "onlineRate") copy.sort((a,b)=>pct(b.online,b.members)-pct(a.online,a.members));
  if(mode === "name") copy.sort((a,b)=>a.name.localeCompare(b.name));
  return copy;
}

function discoveryBadge(server) {
  const badges = [];
  if(server.verified) badges.push('<span class="mini-badge verified">✓ Verified</span>');
  if(server.partnered) badges.push('<span class="mini-badge partnered">◆ Partnered</span>');
  if(!badges.length) badges.push('<span class="mini-badge discoverable">⌕ Discovery</span>');
  return badges.join("");
}

function renderDiscoveryCards() {
  if(!discoveryPayload) return;
  const servers = discoverySorted(discoveryPayload.servers || []);
  byId("discoveryCards").innerHTML = servers.length ? servers.map(server => `
    <article class="discovery-card">
      <div class="discovery-card-banner" style="${server.bannerUrl ? `background-image:url('${server.bannerUrl}')` : ""}"></div>
      <div class="discovery-card-content">
        <div class="discovery-title">
          <img src="${server.iconUrl || "./assets/favicon.svg"}" alt="">
          <div>
            <h3>${server.name}</h3>
            <div class="card-badges">${discoveryBadge(server)}</div>
          </div>
        </div>
        <p>${server.description || "Public Discord Discovery community."}</p>
        <div class="discovery-stats">
          <div><span>Members</span><strong>${fmt(server.members)}</strong></div>
          <div><span>Online</span><strong>${fmt(server.online)}</strong></div>
          <div><span>Online share</span><strong>${pct(server.online,server.members).toFixed(1)}%</strong></div>
        </div>
        <a class="secondary discovery-open" href="${server.discoveryUrl}" target="_blank" rel="noopener noreferrer">View on Discord ↗</a>
      </div>
    </article>
  `).join("") : '<p class="empty">No servers on this page match your filter.</p>';
}

function renderDiscoveryPagination() {
  const totalPages = Math.max(1,Number(discoveryPayload?.totalPages || discoveryPage + 1));
  byId("discoveryPrevious").disabled = discoveryPage <= 1;
  byId("discoveryNext").disabled = discoveryPage >= totalPages;

  const start = Math.max(1,discoveryPage - 2);
  const end = Math.min(totalPages,discoveryPage + 2);
  const pages = [];
  if(start > 1) pages.push(1);
  if(start > 2) pages.push("…");
  for(let page = start; page <= end; page++) pages.push(page);
  if(end < totalPages - 1) pages.push("…");
  if(end < totalPages) pages.push(totalPages);

  byId("discoveryPageNumbers").innerHTML = pages.map(page =>
    page === "…"
      ? '<span class="page-gap">…</span>'
      : `<button type="button" class="${page === discoveryPage ? "active" : ""}" data-discovery-page="${page}">${page}</button>`
  ).join("");
}

async function loadDiscovery(page = 1,force = false) {
  const apiBase = String(window.DISCORD_STATS_API || "").replace(/\/$/,"");
  discoveryPage = Math.max(1,Number(page) || 1);
  byId("discoveryCards").innerHTML = '<p class="empty">Loading Discord Discovery…</p>';

  try {
    const response = await fetch(`${apiBase}/discovery?page=${discoveryPage}${force ? "&refresh=1" : ""}&cache=${Date.now()}`,{cache:"no-store"});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || `Discovery returned ${response.status}`);
    discoveryPayload = data;
    byId("discoveryCount").textContent = data.totalResults
      ? `${fmt(data.totalResults)} servers · page ${discoveryPage} of ${fmt(data.totalPages)}`
      : `Page ${discoveryPage}`;
    renderDiscoveryCards();
    renderDiscoveryPagination();
  } catch(error) {
    byId("discoveryCards").innerHTML = `<p class="empty">${error.message}</p>`;
  }
}

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
byId("themeToggle").addEventListener("click",()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark",true));
byId("refreshTopButton").addEventListener("click",()=>load(true));
const exportTopButton = byId("exportTopButton");
const exportTopPopover = byId("exportTopPopover");

exportTopButton?.addEventListener("click",event=>{
  event.stopPropagation();
  if (!exportTopPopover) return;
  const opening = exportTopPopover.classList.contains("hidden");
  exportTopPopover.classList.toggle("hidden", !opening);
  exportTopButton.setAttribute("aria-expanded", String(opening));
});

exportTopPopover?.addEventListener("click",event=>{
  const button = event.target.closest("[data-top-export]");
  if (!button) return;
  exportTopServers(button.dataset.topExport);
  exportTopPopover.classList.add("hidden");
  exportTopButton?.setAttribute("aria-expanded", "false");
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
  if (event.target.closest("[data-close-modal]")) closeModal();
});
document.addEventListener("keydown",event=>{
  if (event.key==="Escape") closeModal();
});

byId("discoverySearch")?.addEventListener("input", renderDiscoveryCards);
byId("discoverySort")?.addEventListener("change", renderDiscoveryCards);

byId("discoveryPrevious")?.addEventListener("click", () => {
  if (discoveryPage > 1) loadDiscovery(discoveryPage - 1);
});

byId("discoveryNext")?.addEventListener("click", () => {
  const totalPages = Number(discoveryPayload?.totalPages || Infinity);
  if (discoveryPage < totalPages) loadDiscovery(discoveryPage + 1);
});

byId("discoveryPageNumbers")?.addEventListener("click", event => {
  const button = event.target.closest("[data-discovery-page]");
  if (button) loadDiscovery(Number(button.dataset.discoveryPage));
});

load();
loadDiscovery(1);
setInterval(load,60_000);



let customCompareChart = null;
let selectedCompareKeys = [];

function stableServerKey(server) {
  return String(server?.id || server?.code || server?.slug || server?.name || "").toLowerCase();
}

function customMetricConfig(metric) {
  const configs = {
    members:{label:"Members",value:s=>Number(s.members || 0),format:v=>fmt(v)},
    online:{label:"Online",value:s=>Number(s.online || 0),format:v=>fmt(v)},
    onlineRate:{label:"Online share",value:s=>pct(s.online,s.members),format:v=>`${Number(v).toFixed(1)}%`},
    growth24h:{label:"24-hour growth",value:s=>s.growth24h == null ? null : Number(s.growth24h),format:v=>signed(v)},
    boosts:{label:"Boosts",value:s=>s.boosts == null ? null : Number(s.boosts),format:v=>v == null ? "—" : fmt(v)},
    activityScore:{label:"Activity score",value:s=>s.activityScore == null ? null : Number(s.activityScore),format:v=>v == null ? "—" : fmt(v)}
  };
  return configs[metric] || configs.members;
}

function compareServersAvailable() {
  return Array.isArray(payload?.servers) ? payload.servers : [];
}

function renderComparePicker() {
  const picker = byId("compareServerPicker");
  if(!picker) return;
  picker.innerHTML = compareServersAvailable().map(server=>{
    const key = stableServerKey(server);
    const checked = selectedCompareKeys.includes(key);
    return `<label class="compare-server-option ${checked ? "selected" : ""}">
      <input type="checkbox" value="${key}" ${checked ? "checked" : ""}>
      <img src="${server.iconUrl || "./assets/favicon.svg"}" alt="">
      <span><strong>${server.name}</strong><small>${fmt(server.members)} members</small></span>
      <b>${checked ? "✓" : "+"}</b>
    </label>`;
  }).join("");
}

function openCompareDrawer() {
  renderComparePicker();
  byId("compareDrawer")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCompareDrawer() {
  byId("compareDrawer")?.classList.add("hidden");
  document.body.style.overflow = "";
}

function renderCustomComparison() {
  const metricName = byId("customCompareMetric")?.value || "members";
  const metric = customMetricConfig(metricName);
  const selected = compareServersAvailable().filter(server=>selectedCompareKeys.includes(stableServerKey(server)));

  byId("compareMetricLabel").textContent = metric.label;
  byId("compareSelectionSummary").innerHTML = selected.length
    ? selected.map(server=>`<span class="compare-chip"><img src="${server.iconUrl || "./assets/favicon.svg"}" alt="">${server.name}</span>`).join("")
    : "<span>No servers selected yet</span>";

  const values = selected
    .map(server=>({server,value:metric.value(server)}))
    .filter(item=>item.value != null && Number.isFinite(Number(item.value)))
    .sort((a,b)=>b.value-a.value);

  const winner = values[0];
  const last = values.at(-1);
  byId("compareWinner").textContent = winner?.server.name || "—";
  byId("compareWinnerNote").textContent = winner ? metric.format(winner.value) : "Choose servers to begin";

  if(values.length > 1){
    const gap = winner.value - last.value;
    byId("compareGap").textContent = metric.format(gap);
    byId("compareGapNote").textContent = `${winner.server.name} vs ${last.server.name}`;
  }else{
    byId("compareGap").textContent = "—";
    byId("compareGapNote").textContent = "Select at least two servers";
  }

  const canvas = byId("customCompareChart");
  if(!canvas || !window.Chart) return;
  if(customCompareChart) customCompareChart.destroy();

  customCompareChart = new Chart(canvas,{
    type:"bar",
    data:{
      labels:selected.map(server=>server.name),
      datasets:[{
        data:selected.map(server=>metric.value(server) ?? 0),
        borderWidth:1,
        borderRadius:12,
        backgroundColor:selected.map((_,index)=>index===0 ? "rgba(101,229,123,.72)" : "rgba(104,185,255,.58)"),
        borderColor:selected.map((_,index)=>index===0 ? "#65e57b" : "#68b9ff")
      }]
    },
    options:{
      maintainAspectRatio:false,
      responsive:true,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:context=>`${metric.label}: ${metric.format(context.raw)}`}}
      },
      scales:{
        x:{grid:{display:false}},
        y:{
          beginAtZero:metricName!=="growth24h",
          ticks:{callback:value=>metricName==="onlineRate" ? `${value}%` : Number(value).toLocaleString(undefined,{notation:"compact",maximumFractionDigits:1})}
        }
      }
    }
  });
}

byId("openCompareButton")?.addEventListener("click",openCompareDrawer);
byId("closeCompareButton")?.addEventListener("click",closeCompareDrawer);
byId("closeCompareBackdrop")?.addEventListener("click",closeCompareDrawer);
byId("clearCompareButton")?.addEventListener("click",()=>{
  selectedCompareKeys = [];
  renderComparePicker();
});
byId("compareServerPicker")?.addEventListener("change",event=>{
  const input = event.target.closest('input[type="checkbox"]');
  if(!input) return;
  const key = input.value;
  if(input.checked){
    if(selectedCompareKeys.length >= 4){
      input.checked = false;
      return;
    }
    if(!selectedCompareKeys.includes(key)) selectedCompareKeys.push(key);
  }else{
    selectedCompareKeys = selectedCompareKeys.filter(item=>item!==key);
  }
  renderComparePicker();
});
byId("applyCompareButton")?.addEventListener("click",()=>{
  closeCompareDrawer();
  renderCustomComparison();
  byId("compareStudio")?.scrollIntoView({behavior:"smooth",block:"start"});
});
byId("customCompareMetric")?.addEventListener("change",renderCustomComparison);
