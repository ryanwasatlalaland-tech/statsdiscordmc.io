const API_BASE = String(window.STATS_API_BASE || "https://statsdiscordmc-api.discordstatsmc.workers.dev").replace(/\/+$/,"");

const state = {
  articles:[],
  query:"",
  edition:"all",
  hotfixOnly:false
};

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g,char=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("discord-stats-theme",theme);
  const button = byId("themeToggle");
  button?.setAttribute("aria-pressed",String(theme === "dark"));
  const label = button?.querySelector("span");
  if(label) label.textContent = theme === "dark" ? "Dark mode" : "Light mode";
}

function articleDate(article){
  const raw = article.createdAt || article.updatedAt;
  if(!raw) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB",{
    day:"numeric",month:"long",year:"numeric"
  }).format(new Date(raw));
}

function normaliseSearch(value){
  return String(value || "").toLowerCase().replace(/\s+/g," ").trim();
}

function filteredArticles(){
  return state.articles.filter(article=>{
    if(state.edition !== "all" && article.edition !== state.edition) return false;
    if(state.hotfixOnly && !article.hotfix) return false;
    if(!state.query) return true;
    const haystack = normaliseSearch(`${article.title} ${article.summary} ${article.body}`);
    return haystack.includes(state.query);
  });
}

function enhanceArticleContent(container){
  container.querySelectorAll("img").forEach(image=>{
    image.removeAttribute("width");
    image.removeAttribute("height");
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error",()=>image.closest("p,figure")?.classList.add("image-failed"),{once:true});
  });

  container.querySelectorAll("pre code").forEach(block=>{
    try { window.hljs?.highlightElement(block); } catch {}
  });

  // Some Feedback articles use inline code without pre. Preserve it without forcing block highlighting.
  container.querySelectorAll("a").forEach(link=>{
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

function makeArticle(article,index){
  const details = document.createElement("details");
  details.className = "changelog-card";
  details.dataset.edition = article.edition;
  details.dataset.hotfix = String(Boolean(article.hotfix));
  details.id = `changelog-${article.id}`;

  const badge = article.edition === "java" ? "Java" :
    article.edition === "bedrock" ? "Bedrock" : "Minecraft";

  details.innerHTML = `
    <summary>
      <div class="changelog-summary-main">
        <div class="changelog-badges">
          <span class="edition-badge ${escapeHtml(article.edition)}">${badge}</span>
          ${article.hotfix ? '<span class="hotfix-badge">Hotfix</span>' : ""}
        </div>
        <h2>${escapeHtml(article.title)}</h2>
        <p>${escapeHtml(article.summary || "Open to read the full release notes.")}</p>
      </div>
      <div class="changelog-summary-meta">
        <time datetime="${escapeHtml(article.createdAt || "")}">${articleDate(article)}</time>
        <span class="chevron" aria-hidden="true">⌄</span>
      </div>
    </summary>
    <div class="changelog-body-wrap">
      <div class="changelog-body">${article.body || "<p>No article content was returned.</p>"}</div>
      <div class="article-footer">
        <span>Automatically collected from Minecraft Feedback</span>
        <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">Open original article ↗</a>
      </div>
    </div>`;

  details.addEventListener("toggle",()=>{
    if(details.open){
      enhanceArticleContent(details.querySelector(".changelog-body"));
      history.replaceState(null,"",`#${details.id}`);
    }
  });

  if(location.hash === `#${details.id}`){
    details.open = true;
    setTimeout(()=>details.scrollIntoView({block:"start"}),0);
  }

  return details;
}

function render(){
  const list = byId("changelogList");
  const empty = byId("emptyState");
  const articles = filteredArticles();
  list.replaceChildren(...articles.map(makeArticle));
  empty.classList.toggle("hidden",articles.length > 0);
  byId("pageStatus").textContent = `${articles.length} changelog${articles.length === 1 ? "" : "s"} shown`;
}

async function load(){
  const errorBox = byId("changelogError");
  try{
    const response = await fetch(`${API_BASE}/changelogs`,{cache:"no-store"});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    state.articles = Array.isArray(data.articles) ? data.articles : [];
    byId("statusDot").classList.add("live");
    byId("pageStatusDot").classList.add("live");
    byId("trackerStatus").textContent = "Connected";
    byId("statusSmall").textContent = "Minecraft Feedback";
    byId("changelogMeta").textContent =
      `Checked ${data.checkedAt ? new Date(data.checkedAt).toLocaleString("en-GB") : "recently"} · updates daily`;
    render();
  }catch(error){
    errorBox.textContent = error.message || "Unable to load changelogs.";
    errorBox.classList.remove("hidden");
    byId("pageStatus").textContent = "Changelogs unavailable";
    byId("trackerStatus").textContent = "Connection error";
    byId("changelogList").replaceChildren();
  }
}

byId("changelogSearch").addEventListener("input",event=>{
  state.query = normaliseSearch(event.target.value);
  render();
});

byId("editionFilters").addEventListener("click",event=>{
  const button = event.target.closest("[data-edition]");
  if(!button) return;
  state.edition = button.dataset.edition;
  byId("editionFilters").querySelectorAll("button").forEach(item=>item.classList.toggle("active",item === button));
  render();
});

byId("hotfixOnly").addEventListener("change",event=>{
  state.hotfixOnly = event.target.checked;
  render();
});

byId("expandAll").addEventListener("click",()=>{
  document.querySelectorAll(".changelog-card").forEach(details=>{
    details.open = true;
    enhanceArticleContent(details.querySelector(".changelog-body"));
  });
});

byId("collapseAll").addEventListener("click",()=>{
  document.querySelectorAll(".changelog-card").forEach(details=>details.open = false);
});

byId("themeToggle").addEventListener("click",()=>{
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

setTheme(document.documentElement.dataset.theme || "dark");
load();


function classifyRenderedChangelogBadges(){
  document.querySelectorAll(".edition-badge,.hotfix-badge").forEach(badge=>{
    const text=(badge.textContent||"").trim().toLowerCase();
    if(text.includes("bedrock")) badge.classList.add("bedrock");
    if(text.includes("java")) badge.classList.add("java");
    if(text.includes("hotfix")) badge.classList.add("hotfix-badge");
  });
}
const changelogBadgeObserver = new MutationObserver(classifyRenderedChangelogBadges);
changelogBadgeObserver.observe(document.body,{subtree:true,childList:true});
setTimeout(classifyRenderedChangelogBadges,100);
