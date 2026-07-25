const charts = {};
const byId = id => document.getElementById(id);
const fmt = value => Number(value || 0).toLocaleString();
const signed = value => `${Number(value) > 0 ? "+" : ""}${Number(value || 0).toLocaleString()}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const FIVE_MINUTES = 5 * 60 * 1000;
const GAP_LIMIT = 10 * 60 * 1000;
let fullPayload = null;
let selectedRange = "24h";



const THEME_KEY = "discord-stats-theme";

function applySiteTheme(theme, rerender = false) {
  const dark = theme !== "light";
  const resolved = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  try {
    localStorage.setItem(THEME_KEY, resolved);
  } catch {}

  const button = byId("themeToggle");
  if (button) {
    button.classList.toggle("is-light", !dark);
    button.setAttribute("aria-pressed", String(dark));
    const label = button.querySelector("span");
    if (label) label.textContent = dark ? "Dark mode" : "Light mode";
  }

  if (window.Chart) {
    Chart.defaults.color = dark ? "#94a099" : "#52645a";
    Chart.defaults.borderColor = dark ? "#26312b" : "#d4e0d7";
  }

  if (rerender && fullPayload) render(fullPayload);
}

function initialSiteTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ||
      (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  } catch {
    return "dark";
  }
}

function ensureMessageActivityPanel() {
  if (byId("messageActivityPanel")) return;
  const panel = document.createElement("section");
  panel.id = "messageActivityPanel";
  panel.className = "panel message-activity-panel";
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Message activity</h2>
        <p>Discord's relative message activity score. This is not a literal message count.</p>
      </div>
      <span id="messageActivityFreshness">Waiting for Discord…</span>
    </div>
    <div class="activity-stats">
      <article><span>Current score</span><strong id="activityCurrent">—</strong><small>Latest activity bin</small></article>
      <article><span>Average score</span><strong id="activityAverage">—</strong><small>Across supplied bins</small></article>
      <article><span>Peak score</span><strong id="activityPeak">—</strong><small>Highest supplied bin</small></article>
      <article><span>Lowest score</span><strong id="activityMinimum">—</strong><small>Lowest supplied bin</small></article>
    </div>
    <div class="chart-wrap large"><canvas id="messageActivityChart"></canvas></div>
  `;
  const target = byId("diagnostics") || document.querySelector(".members") || document.querySelector("footer");
  if (target?.parentNode) target.parentNode.insertBefore(panel, target);
  else document.querySelector("main")?.appendChild(panel);
}

function renderMessageActivity(payload) {
  ensureMessageActivityPanel();
  const activity = payload.messageActivity || payload.activity || {};
  const bins = Array.isArray(activity.bins) ? activity.bins.map(Number).filter(Number.isFinite) : [];
  const updatedAt = activity.lastUpdated || activity.updatedAt || null;
  const current = Number.isFinite(Number(activity.current)) ? Number(activity.current) : bins.at(-1);
  const average = Number.isFinite(Number(activity.average)) ? Number(activity.average) : (bins.length ? bins.reduce((a,b)=>a+b,0)/bins.length : null);
  const peak = Number.isFinite(Number(activity.peak)) ? Number(activity.peak) : (bins.length ? Math.max(...bins) : null);
  const minimum = Number.isFinite(Number(activity.minimum)) ? Number(activity.minimum) : (bins.length ? Math.min(...bins) : null);

  byId("activityCurrent").textContent = current == null ? "—" : current.toFixed(0);
  byId("activityAverage").textContent = average == null ? "—" : average.toFixed(1);
  byId("activityPeak").textContent = peak == null ? "—" : peak.toFixed(0);
  byId("activityMinimum").textContent = minimum == null ? "—" : minimum.toFixed(0);
  byId("messageActivityFreshness").textContent = updatedAt ? `Discord updated ${new Date(updatedAt).toLocaleString()}` : "No activity timestamp";

  const end = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  const data = bins.map((value, index) => ({
    x: end - (bins.length - 1 - index) * 60 * 60 * 1000,
    y: value
  }));

  makeChart("messageActivityChart", {
    type:"line",
    data:{datasets:[{
      label:"Message activity score",
      data,
      borderColor:"#d3b16f",
      backgroundColor:"rgba(211,177,111,.12)",
      fill:true,
      tension:.25,
      pointRadius:bins.length > 72 ? 0 : 2,
      pointHoverRadius:5
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{intersect:false,mode:"nearest"},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:items=>items.length ? new Date(items[0].raw.x).toLocaleString() : "",
          label:ctx=>`Activity score: ${ctx.raw.y}`,
          afterLabel:()=>"Relative Discord activity, not messages"
        }}
      },
      scales:{
        x:{type:"linear",grid:{display:false},ticks:{maxTicksLimit:8,callback:value=>new Date(value).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit"})}},
        y:{suggestedMin:0,suggestedMax:100,ticks:{precision:0},grid:{color:"#222c26"}}
      }
    }
  });
}

Chart.defaults.color = "#94a099";
Chart.defaults.borderColor = "#26312b";
Chart.defaults.font.family = "DM Sans";

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(byId(id), config);
}

function rangeMilliseconds(range) {
  return ({"1h":3600000,"6h":21600000,"24h":86400000,"7d":604800000,"30d":2592000000})[range] || Infinity;
}

function filterHistory(history, range = selectedRange) {
  if (range === "all") return history;
  const cutoff = Date.now() - rangeMilliseconds(range);
  return history.filter(point => new Date(point.time).getTime() >= cutoff);
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function memberMedianNear(history, timestamp, radius = 20 * 60 * 1000) {
  const values = history
    .filter(point => Math.abs(new Date(point.time).getTime() - timestamp) <= radius)
    .map(point => point.members);

  return median(values);
}

function closestReading(history, timestamp, maxDistance = 45 * 60 * 1000) {
  let closest = null;
  let closestDistance = Infinity;

  for (const point of history) {
    const time = new Date(point.time).getTime();
    if (!Number.isFinite(time)) continue;

    const distance = Math.abs(time - timestamp);
    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }

  return closestDistance <= maxDistance ? closest : null;
}

function changeSince(history, duration) {
  const ordered = [...history]
    .filter(point => Number.isFinite(new Date(point.time).getTime()) && Number.isFinite(Number(point.members)))
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  const latest = ordered.at(-1);
  if (!latest) return null;

  const latestTime = new Date(latest.time).getTime();
  const targetTime = latestTime - duration;
  const baseline = closestReading(ordered, targetTime);

  // Do not silently compare against the oldest reading when the proper
  // 24-hour baseline is missing. That was the cause of incorrect swings.
  if (!baseline) return null;

  // Discord invite member totals are approximate and can jump between
  // requests. Use local medians around both endpoints to reduce noise.
  const currentMembers =
    memberMedianNear(ordered, latestTime, 20 * 60 * 1000) ??
    Number(latest.members);

  const baselineTime = new Date(baseline.time).getTime();
  const baselineMembers =
    memberMedianNear(ordered, baselineTime, 20 * 60 * 1000) ??
    Number(baseline.members);

  return Math.round(currentMembers - baselineMembers);
}

function allTimeChange(history) {
  const ordered = history
    .map(normaliseHistoryPoint)
    .filter(Boolean)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  if (ordered.length < 2) return null;

  const firstTime = new Date(ordered[0].time).getTime();
  const lastTime = new Date(ordered.at(-1).time).getTime();

  // Use medians near the beginning and end of the complete dataset so one
  // approximate Discord invite reading cannot distort the all-time result.
  const startingMembers =
    memberMedianNear(ordered, firstTime, 30 * 60 * 1000) ??
    Number(ordered[0].members);

  const currentMembers =
    memberMedianNear(ordered, lastTime, 30 * 60 * 1000) ??
    Number(ordered.at(-1).members);

  return {
    change: Math.round(currentMembers - startingMembers),
    startingMembers: Math.round(startingMembers),
    currentMembers: Math.round(currentMembers),
    firstTime,
    lastTime
  };
}

function ageLabel(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusForAge(age) {
  if (age <= 10 * 60 * 1000) return {label:"Live", className:"live"};
  if (age <= 20 * 60 * 1000) return {label:"Delayed", className:"warning"};
  return {label:"Offline", className:"offline"};
}

function setStatus(latestTime) {
  const age = Date.now() - new Date(latestTime).getTime();
  const status = statusForAge(age);
  byId("trackerStatus").textContent = status.label;
  byId("statusSmall").textContent = `Updated ${ageLabel(age)}`;
  byId("bannerStatus").textContent = status.label === "Live" ? "Tracker is live" : status.label === "Delayed" ? "Tracker update is delayed" : "Tracker may be offline";
  byId("bannerAge").textContent = `Last data ${ageLabel(age)}`;
  byId("dataAge").textContent = ageLabel(age);
  for (const id of ["statusDot", "bannerDot"]) {
    byId(id).className = `pulse ${status.className}`;
  }
  byId("statusBanner").className = `status-banner ${status.className}`;
}

function insertGapPoints(history) {
  const output = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (i > 0) {
      const previous = history[i - 1];
      const previousTime = new Date(previous.time).getTime();
      const currentTime = new Date(current.time).getTime();
      if (currentTime - previousTime > GAP_LIMIT) {
        output.push({time:new Date(previousTime + 1).toISOString(), members:null, online:null, gap:true});
      }
    }
    output.push(current);
  }
  return output;
}

function countMissingIntervals(history) {
  let missing = 0;
  for (let i = 1; i < history.length; i++) {
    const gap = new Date(history[i].time) - new Date(history[i - 1].time);
    if (gap > GAP_LIMIT) missing += Math.max(1, Math.round(gap / FIVE_MINUTES) - 1);
  }
  return missing;
}

function pointTooltip(context, field) {
  const point = context.raw;
  if (!point || point.y == null) return "No reading collected";
  const source = point.source;
  const share = source.members ? (source.online / source.members * 100).toFixed(2) : "0.00";
  return [
    `${field}: ${fmt(point.y)}`,
    `Members: ${fmt(source.members)}`,
    `Online: ${fmt(source.online)} (${share}%)`,
    `Change: ${signed(source.change || 0)}`
  ];
}

function chartData(history, key) {
  return insertGapPoints(history).map(point => ({
    x: new Date(point.time).getTime(),
    y: point[key] == null ? null : Number(point[key]),
    source: point
  }));
}

function timeScaleOptions() {
  return {
    type:"linear",
    grid:{display:false},
    ticks:{maxTicksLimit:8, callback:value => new Date(value).toLocaleString(undefined, selectedRange === "1h" || selectedRange === "6h" ? {hour:"2-digit",minute:"2-digit"} : {month:"short",day:"numeric",hour:"2-digit"})}
  };
}

function renderHeatmap(history) {
  const host = byId("heatmap");
  if (!host) return;

  const buckets = Array.from({length:7}, () => Array.from({length:24}, () => []));
  const points = Array.isArray(history) ? history : [];

  for (const point of points) {
    const time = point?.time ?? point?.timestamp ?? point?.date ?? point?.createdAt;
    const online = Number(
      point?.online ??
      point?.onlineCount ??
      point?.presenceCount ??
      point?.approximate_presence_count ??
      point?.online_count
    );
    const date = new Date(time);

    if (!Number.isFinite(date.getTime()) || !Number.isFinite(online)) continue;
    buckets[date.getDay()][date.getHours()].push(online);
  }
  const values = buckets.flat().map(items => items.length ? items.reduce((a,b)=>a+b,0)/items.length : null).filter(v => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  let html = `<div class="heat-corner"></div>${Array.from({length:24},(_,h)=>`<div class="heat-hour">${h % 3 === 0 ? String(h).padStart(2,"0") : ""}</div>`).join("")}`;
  for (let day = 0; day < 7; day++) {
    html += `<div class="heat-day">${days[day]}</div>`;
    for (let hour = 0; hour < 24; hour++) {
      const items = buckets[day][hour];
      const value = items.length ? items.reduce((a,b)=>a+b,0)/items.length : null;
      const intensity = value === null ? 0 : Math.max(.08, (value - min) / Math.max(1, max - min));
      html += `<div class="heat-cell ${value === null ? "empty" : ""}" style="--heat:${intensity}" title="${days[day]} ${String(hour).padStart(2,"0")}:00 · ${value === null ? "No data" : `${fmt(Math.round(value))} average online`}"></div>`;
    }
  }
  host.innerHTML = html;
}


function renderServerBadges(server) {
  const container = byId("serverBadges");
  if (!container) return;

  const features = new Set(
    [
      ...(Array.isArray(server?.features) ? server.features : []),
      ...(Array.isArray(server?.profileFeatures) ? server.profileFeatures : [])
    ].map(value => String(value).toUpperCase())
  );

  const isCommunity = Boolean(server?.community) || features.has("COMMUNITY");
  const isVerified = Boolean(server?.verified) || features.has("VERIFIED");

  const badges = [];

  if (isVerified) {
    badges.push(`
      <span class="discord-server-badge verified-badge"
            title="Verified Discord server"
            aria-label="Verified Discord server">
        <span class="badge-symbol" aria-hidden="true">✓</span>
        <span class="badge-label">Verified</span>
      </span>
    `);
  }

  if (isCommunity) {
    badges.push(`
      <span class="discord-server-badge community-badge"
            title="Community Discord server"
            aria-label="Community Discord server">
        <span class="badge-symbol community-symbol" aria-hidden="true">◆</span>
        <span class="badge-label">Community</span>
      </span>
    `);
  }

  container.innerHTML = badges.join("");
  container.classList.toggle("hidden", badges.length === 0);
}

function render(payload) {
  fullPayload = payload;
  const allHistory = Array.isArray(payload.history)
    ? payload.history
        .map(normaliseHistoryPoint)
        .filter(Boolean)
        .sort((a,b)=>new Date(a.time)-new Date(b.time))
    : [];
  const history = filterHistory(allHistory);
  const latest = allHistory.at(-1);
  if (!latest) throw new Error("No snapshots are stored yet. Open the Worker /refresh endpoint once.");
  const first = history[0] || latest;
  const selectedGrowth = Number(latest.members) - Number(first.members);
  const selectedHours = Math.max(1/12, (new Date(latest.time) - new Date(first.time)) / 3600000);
  const averagePerHour = selectedGrowth / selectedHours;
  const last24 = filterHistory(allHistory, "24h");
  const peak = last24.reduce((best,p)=>!best || p.online > best.online ? p : best, null) || latest;
  const low = last24.reduce((best,p)=>!best || p.online < best.online ? p : best, null) || latest;
  const onlineRate = latest.members ? latest.online / latest.members * 100 : 0;
  const missing = countMissingIntervals(allHistory);

  byId("totalMembers").textContent = fmt(latest.members);
  byId("heroMembers").textContent = fmt(latest.members);
  byId("heroOnline").textContent = fmt(latest.online);

  const server = payload.server || {};
  const icon = byId("serverIcon");
  const fallback = byId("serverIconFallback");
  const serverName = server.name || "Discord server";
  byId("heroServerName").textContent = serverName;
  renderServerBadges(server);
  fallback.textContent = serverName.trim().charAt(0).toUpperCase() || "D";

  const showFallback = () => {
    icon.style.display = "none";
    fallback.style.display = "grid";
  };

  if (server.iconUrl || server.icon) {
    icon.style.display = "block";
    fallback.style.display = "none";
    icon.onerror = showFallback;
    icon.src = server.iconUrl || server.icon;
  } else {
    showFallback();
  }

  const banner = byId("serverBanner");
  if (server.bannerUrl) {
    banner.style.backgroundImage = `linear-gradient(180deg,transparent,rgba(9,13,11,.72)),url("${server.bannerUrl}")`;
  } else {
    banner.style.backgroundImage = "";
  }

  byId("serverDescription").textContent = server.description || "";
  const inviteUrl = server.inviteUrl || (server.inviteCode ? `https://discord.gg/${server.inviteCode}` : "#");
  const inviteButton = byId("inviteButton");
  inviteButton.href = inviteUrl;
  inviteButton.classList.toggle("hidden", inviteUrl === "#");
  byId("onlineMembers").textContent = fmt(latest.online);
  byId("onlineRate").textContent = `${onlineRate.toFixed(2)}% of members`;
  const change1h = changeSince(allHistory, 3600000);
  const change24h = changeSince(allHistory, 86400000);
  const lifetime = allTimeChange(allHistory);

  byId("change1h").textContent = change1h == null ? "—" : signed(change1h);
  byId("change24h").textContent = change24h == null ? "—" : signed(change24h);
  byId("changeAllTime").textContent = lifetime == null ? "—" : signed(lifetime.change);

  const allTimeNote = byId("changeAllTimeNote");
  if (allTimeNote) {
    allTimeNote.textContent = lifetime == null
      ? "not enough collected data"
      : `since ${new Date(lifetime.firstTime).toLocaleDateString()} · ${fmt(lifetime.startingMembers)} → ${fmt(lifetime.currentMembers)}`;
  }

  const change24Card = byId("change24h")?.closest("article, .card, .stat-card");
  const change24Note = change24Card?.querySelector("small");
  if (change24Note) {
    change24Note.textContent = change24h == null
      ? "not enough data near 24 hours ago"
      : "smoothed against readings near 24 hours ago";
  }
  byId("averageHour").textContent = `${averagePerHour > 0 ? "+" : ""}${averagePerHour.toFixed(1)}`;
  byId("peakOnline").textContent = fmt(peak.online);
  byId("peakTime").textContent = new Date(peak.time).toLocaleString();
  byId("lowOnline").textContent = fmt(low.online);
  byId("lowTime").textContent = new Date(low.time).toLocaleString();
  byId("dataPoints").textContent = fmt(allHistory.length);
  byId("coverageText").textContent = `${fmt(missing)} estimated missing intervals`;
  byId("memberTimestamp").textContent = new Date(latest.time).toLocaleString();
  byId("selectedGrowth").textContent = `${signed(selectedGrowth)} selected period`;

  byId("serverName").textContent = payload.server?.name || "Discord server";
  byId("inviteCode").textContent = payload.server?.inviteCode || "—";
  byId("channelName").textContent = payload.server?.channel ? `#${payload.server.channel}` : "Not provided";
  byId("firstReading").textContent = new Date(allHistory[0].time).toLocaleString();
  byId("lastChecked").textContent = new Date(latest.time).toLocaleString();
  byId("lastSuccessfulFetch").textContent = new Date(latest.time).toLocaleString();
  byId("missingIntervals").textContent = fmt(missing);
  byId("nextRun").textContent = new Date(new Date(latest.time).getTime() + FIVE_MINUTES).toLocaleString();
  byId("apiStatus").textContent = "Online";
  byId("serverMeta").textContent = `Watching ${payload.server?.name || "a Discord server"} through discord.gg/${payload.server?.inviteCode || "invite"}`;
  byId("historyCount").textContent = `${fmt(history.length)} readings selected`;
  setStatus(latest.time);

  makeChart("memberChart", {
    type:"line",
    data:{datasets:[{label:"Members",data:chartData(history,"members"),borderColor:"#9cc8a5",backgroundColor:"rgba(92,151,105,.14)",fill:true,tension:.22,spanGaps:false,pointRadius:history.length > 70 ? 0 : 2,pointHoverRadius:5}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:"nearest"},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items[0]?.raw?.source?.gap ? "Collection gap" : new Date(items[0].raw.x).toLocaleString(),label:ctx=>pointTooltip(ctx,"Members")}}},scales:{x:timeScaleOptions(),y:{beginAtZero:false,ticks:{callback:value=>fmt(value)},grid:{color:"#222c26"}}}}
  });

  makeChart("onlineTrendChart", {
    type:"line",
    data:{datasets:[{label:"Online",data:chartData(history,"online"),borderColor:"#74a982",backgroundColor:"rgba(74,126,88,.12)",fill:true,tension:.22,spanGaps:false,pointRadius:history.length > 70 ? 0 : 2,pointHoverRadius:5}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:"nearest"},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items[0]?.raw?.source?.gap ? "Collection gap" : new Date(items[0].raw.x).toLocaleString(),label:ctx=>pointTooltip(ctx,"Online")}}},scales:{x:timeScaleOptions(),y:{beginAtZero:false,ticks:{callback:value=>fmt(value)},grid:{color:"#222c26"}}}}
  });

  makeChart("onlineShareChart", {type:"doughnut",data:{labels:["Online","Offline"],datasets:[{data:[latest.online,Math.max(0,latest.members-latest.online)],backgroundColor:["#8fbd99","#28332d"],borderWidth:4,borderColor:"#131916"}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom",labels:{boxWidth:8,usePointStyle:true,font:{size:11}}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${fmt(ctx.raw)} (${(ctx.raw/latest.members*100).toFixed(2)}%)`}}}}});

  const hours = Array.from({length:24},(_,hour)=>({hour,change:0}));
  for (let i=1;i<history.length;i++) hours[new Date(history[i].time).getHours()].change += Number(history[i].members)-Number(history[i-1].members);
  makeChart("hourChart", {type:"bar",data:{labels:hours.map(p=>`${String(p.hour).padStart(2,"0")}:00`),datasets:[{data:hours.map(p=>p.change),backgroundColor:hours.map(p=>p.change<0?"#b88778":"#a8c8ae"),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`Net change: ${signed(ctx.raw)}`}}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8}},y:{beginAtZero:true,ticks:{precision:0},grid:{color:"#222c26"}}}}});

  renderMessageActivity(payload);
  renderHeatmap(allHistory);

  const recent = [...history].reverse().slice(0,50);
  byId("recent").innerHTML = recent.map((row,index) => {
    const originalIndex = allHistory.indexOf(row);
    const previous = originalIndex > 0 ? allHistory[originalIndex - 1] : null;
    const change = previous ? Number(row.members)-Number(previous.members) : Number(row.change || 0);
    const share = row.members ? Number(row.online)/Number(row.members)*100 : 0;
    return `<tr><td>${escapeHtml(new Date(row.time).toLocaleString())}</td><td>${fmt(row.members)}</td><td>${fmt(row.online)}</td><td>${share.toFixed(2)}%</td><td><span class="change ${change<0?"negative":change>0?"positive":"neutral"}">${signed(change)}</span></td></tr>`;
  }).join("") || `<tr><td class="empty" colspan="5">No readings in this period.</td></tr>`;
}

function normaliseHistoryPoint(point) {
  const time = point?.time ?? point?.timestamp ?? point?.date ?? point?.createdAt;
  const members = point?.members ?? point?.memberCount ?? point?.member_count;
  const online = point?.online ?? point?.onlineCount ?? point?.presenceCount ?? point?.online_count;

  const parsedTime = new Date(time).getTime();
  const parsedMembers = Number(String(members ?? "").replaceAll(",", ""));
  const parsedOnline = Number(String(online ?? 0).replaceAll(",", ""));

  if (!Number.isFinite(parsedTime) || !Number.isFinite(parsedMembers)) return null;

  return {
    ...point,
    time: new Date(parsedTime).toISOString(),
    members: parsedMembers,
    online: Number.isFinite(parsedOnline) ? parsedOnline : 0
  };
}

function mergeHistory(...sources) {
  const byTimestamp = new Map();

  for (const source of sources) {
    const history = Array.isArray(source)
      ? source
      : Array.isArray(source?.history)
        ? source.history
        : [];

    for (const rawPoint of history) {
      const point = normaliseHistoryPoint(rawPoint);
      if (!point) continue;
      byTimestamp.set(point.time, point);
    }
  }

  return [...byTimestamp.values()].sort(
    (a, b) => new Date(a.time) - new Date(b.time)
  );
}

async function loadLocalHistory() {
  try {
    const response = await fetch(`data.json?cache=${Date.now()}`, {cache:"no-store"});
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : (data.history || []);
  } catch {
    return [];
  }
}

async function load(showSpinner = false) {
  try {
    if (showSpinner) byId("refreshButton").textContent = "Refreshing…";
    const apiBase = String(window.DISCORD_STATS_API || "").replace(/\/$/, "");
    if (!apiBase || apiBase.includes("YOUR-WORKER")) throw new Error("Set your Cloudflare Worker URL in config.js first.");

    const [response, localHistory] = await Promise.all([
      fetch(`${apiBase}/stats?cache=${Date.now()}`, {cache:"no-store"}),
      loadLocalHistory()
    ]);

    if (!response.ok) throw new Error(`Could not load Worker statistics (${response.status}).`);

    const payload = await response.json();
    payload.history = mergeHistory(localHistory, payload.history);

    render(payload);
    byId("errorBox").classList.add("hidden");
  } catch (error) {
    byId("trackerStatus").textContent = "Unavailable";
    byId("apiStatus").textContent = "Offline";
    byId("statusDot").className = "pulse offline";
    byId("bannerDot").className = "pulse offline";
    byId("statusBanner").className = "status-banner offline";
    byId("errorBox").textContent = error.message;
    byId("errorBox").classList.remove("hidden");
    console.error(error);
  } finally {
    byId("refreshButton").textContent = "Refresh";
  }
}

function download(content, filename, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportData(format) {
  if (!fullPayload) return;
  const history = filterHistory(fullPayload.history || []);
  const stamp = new Date().toISOString().slice(0,10);
  if (format === "json") download(JSON.stringify({...fullPayload, history}, null, 2), `discord-stats-${stamp}.json`, "application/json");
  else {
    const rows = [["time","members","online","online_percentage","change"], ...history.map(p=>[p.time,p.members,p.online,p.members?(p.online/p.members*100).toFixed(4):0,p.change ?? 0])];
    const csv = rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
    download(csv, `discord-stats-${stamp}.csv`, "text/csv");
  }
  byId("exportPopover").classList.add("hidden");
}

byId("rangeButtons").addEventListener("click", event => {
  const button = event.target.closest("button[data-range]");
  if (!button || !fullPayload) return;
  selectedRange = button.dataset.range;
  document.querySelectorAll("#rangeButtons button").forEach(item=>item.classList.toggle("active",item===button));
  render(fullPayload);
});
byId("refreshButton").addEventListener("click",()=>load(true));
byId("exportButton").addEventListener("click",()=>{
  const popover = byId("exportPopover");
  popover.classList.toggle("hidden");
  byId("exportButton").setAttribute("aria-expanded",String(!popover.classList.contains("hidden")));
});
byId("exportPopover").addEventListener("click",event=>{
  const button = event.target.closest("button[data-export]");
  if (button) exportData(button.dataset.export);
});
document.addEventListener("click",event=>{
  if (!event.target.closest(".export-menu")) byId("exportPopover").classList.add("hidden");
});

applySiteTheme(initialSiteTheme());
byId("themeToggle")?.addEventListener("click", () => {
  applySiteTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});

load();
setInterval(()=>fullPayload?.history?.length && setStatus(fullPayload.history.at(-1).time), 30_000);
setInterval(load, 60_000);
