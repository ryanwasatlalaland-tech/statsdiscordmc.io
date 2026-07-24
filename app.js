
const charts = {};
const byId = (id) => document.getElementById(id);
const number = (value) => Number(value || 0).toLocaleString();
const signed = (value) => `${Number(value) > 0 ? "+" : ""}${Number(value || 0).toLocaleString()}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(byId(id), config);
}

function filterHistory(history) {
  const value = byId("range").value;
  if (value === "all") return history;
  const cutoff = Date.now() - Number(value) * 86400000;
  return history.filter(point => new Date(point.time).getTime() >= cutoff);
}

function render(payload) {
  const history = filterHistory(Array.isArray(payload.history) ? payload.history : []);
  const latest = history.at(-1) || payload.history?.at(-1);
  if (!latest) throw new Error("No snapshots exist yet. Run the GitHub Action once after setting DISCORD_INVITE.");
  const first = history[0] || latest;
  const netGrowth = latest.members - first.members;
  const peakOnline = Math.max(...history.map(p => Number(p.online || 0)), latest.online);
  const onlineRate = latest.members ? ((latest.online / latest.members) * 100).toFixed(1) : "0.0";

  byId("totalMembers").textContent = number(latest.members);
  byId("onlineMembers").textContent = number(latest.online);
  byId("onlineRate").textContent = `${onlineRate}% of members`;
  byId("netGrowth").textContent = signed(netGrowth);
  byId("peakOnline").textContent = number(peakOnline);
  byId("serverName").textContent = payload.server?.name || "Discord server";
  byId("inviteCode").textContent = payload.server?.inviteCode || "—";
  byId("channelName").textContent = payload.server?.channel ? `#${payload.server.channel}` : "Not provided";
  byId("lastChecked").textContent = new Date(latest.time).toLocaleString();
  byId("serverMeta").textContent = `Watching ${payload.server?.name || "a Discord server"} through discord.gg/${payload.server?.inviteCode || "invite"}`;
  byId("trackerStatus").textContent = "Data connected";
  byId("statusSmall").textContent = `Updated ${new Date(latest.time).toLocaleTimeString()}`;
  byId("statusDot").classList.remove("offline");

  const labels = history.map(point => new Date(point.time).toLocaleDateString(undefined,{month:"short",day:"numeric"}));
  makeChart("growthChart", {type:"line",data:{labels,datasets:[{label:"Members",data:history.map(p=>p.members),borderColor:"#8fbd99",backgroundColor:"rgba(89,145,101,.13)",fill:true,tension:.3,pointRadius:history.length>60?0:2},{label:"Online",data:history.map(p=>p.online),borderColor:"#527a5c",tension:.3,pointRadius:history.length>60?0:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8}},y:{beginAtZero:false,ticks:{precision:0},grid:{color:"#222c26"}}}}});
  makeChart("onlineChart", {type:"doughnut",data:{labels:["Online","Offline"],datasets:[{data:[latest.online,Math.max(0,latest.members-latest.online)],backgroundColor:["#8fbd99","#28332d"],borderWidth:4,borderColor:"#131916"}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom",labels:{boxWidth:8,usePointStyle:true,font:{size:10}}}}}});

  const hours = Array.from({length:24},(_,hour)=>({hour,change:0}));
  for (let i=1;i<history.length;i++) hours[new Date(history[i].time).getHours()].change += history[i].members-history[i-1].members;
  makeChart("hourChart", {type:"bar",data:{labels:hours.map(p=>`${String(p.hour).padStart(2,"0")}:00`),datasets:[{data:hours.map(p=>p.change),backgroundColor:hours.map(p=>p.change<0?"#b88778":"#a8c8ae"),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8}},y:{beginAtZero:true,ticks:{precision:0},grid:{color:"#222c26"}}}}});

  const recent = [...history].reverse().slice(0,30);
  byId("recent").innerHTML = recent.map((row,index) => {
    const previous = history[history.length - 2 - index];
    const change = previous ? row.members - previous.members : Number(row.change || 0);
    return `<tr><td>${escapeHtml(new Date(row.time).toLocaleString())}</td><td>${number(row.members)}</td><td>${number(row.online)}</td><td><span class="change ${change<0?"negative":""}">${signed(change)}</span></td></tr>`;
  }).join("");
}

async function load() {
  try {
    const apiBase = String(window.DISCORD_STATS_API || "").replace(/\/$/, "");
    if (!apiBase || apiBase.includes("YOUR-WORKER")) {
      throw new Error("Set your Cloudflare Worker URL in config.js first.");
    }
    const response = await fetch(`${apiBase}/stats?cache=${Date.now()}`, {cache:"no-store"});
    if (!response.ok) throw new Error(`Could not load Worker statistics (${response.status}).`);
    const payload = await response.json();
    render(payload);
    byId("errorBox").classList.add("hidden");
  } catch (error) {
    byId("trackerStatus").textContent = "Data unavailable";
    byId("statusDot").classList.add("offline");
    byId("errorBox").textContent = error.message;
    byId("errorBox").classList.remove("hidden");
    console.error(error);
  }
}

byId("range").addEventListener("change", load);
load();


// Refresh the display between Worker updates without reloading the page.
setInterval(load, 60_000);
