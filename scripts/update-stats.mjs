import fs from "node:fs/promises";
import path from "node:path";

const inviteInput = process.env.DISCORD_INVITE?.trim();
if (!inviteInput) throw new Error("DISCORD_INVITE is missing. Add it as a GitHub Actions repository variable.");
const inviteCode = inviteInput.replace(/^https?:\/\/(www\.)?(discord\.gg|discord(app)?\.com\/invite)\//i, "").split(/[/?#]/)[0];
if (!inviteCode) throw new Error("Could not extract an invite code from DISCORD_INVITE.");

const endpoint = `https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true&with_expiration=true`;
const response = await fetch(endpoint, {headers:{"User-Agent":"InvitePulseGitHubPages/1.0"}});
if (!response.ok) throw new Error(`Discord invite request failed: ${response.status} ${response.statusText}`);
const invite = await response.json();
const snapshot = {time:new Date().toISOString(),members:Number(invite.approximate_member_count||0),online:Number(invite.approximate_presence_count||0)};
const file = path.resolve("data/data.json");
let existing = {server:{},history:[]};
try { existing = JSON.parse(await fs.readFile(file,"utf8")); } catch {}
const history = Array.isArray(existing.history) ? existing.history : [];
const previous = history.at(-1);
snapshot.change = previous ? snapshot.members - Number(previous.members||0) : 0;
if (!previous || previous.members !== snapshot.members || previous.online !== snapshot.online) history.push(snapshot);
else previous.time = snapshot.time;
const maxEntries = 105120; // about one year at five-minute intervals
if (history.length > maxEntries) history.splice(0, history.length-maxEntries);
const output = {
  server:{name:invite.guild?.name||existing.server?.name||"Discord server",inviteCode:invite.code||inviteCode,channel:invite.channel?.name||null,guildId:invite.guild?.id||null},
  updatedAt:snapshot.time,
  history
};
await fs.mkdir(path.dirname(file),{recursive:true});
await fs.writeFile(file,JSON.stringify(output,null,2)+"\n");
console.log(`Recorded ${snapshot.members} members and ${snapshot.online} online.`);
