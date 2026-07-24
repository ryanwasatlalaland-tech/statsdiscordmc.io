import fs from "node:fs/promises";
import path from "node:path";

function fail(message) {
  console.error(`::error title=Discord tracker update failed::${message}`);
  process.exit(1);
}

const inviteInput = process.env.DISCORD_INVITE?.trim();
if (!inviteInput) {
  fail("DISCORD_INVITE is empty. Add it under Settings > Secrets and variables > Actions as either a Variable or Secret.");
}

const inviteCode = inviteInput
  .replace(/^https?:\/\/(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\//i, "")
  .split(/[/?#]/)[0]
  .trim();

if (!/^[A-Za-z0-9-]+$/.test(inviteCode)) {
  fail("DISCORD_INVITE is not a valid invite URL or invite code.");
}

const endpoint = `https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true&with_expiration=true`;
let response;
try {
  response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MinecraftDiscordTrackerGitHubPages/2.0"
    },
    signal: AbortSignal.timeout(20_000)
  });
} catch (error) {
  fail(`Could not reach Discord: ${error.message}`);
}

const bodyText = await response.text();
let invite;
try {
  invite = JSON.parse(bodyText);
} catch {
  fail(`Discord returned a non-JSON response with HTTP ${response.status}.`);
}

if (!response.ok) {
  const detail = invite?.message || response.statusText || "Unknown Discord API error";
  fail(`Discord invite request returned HTTP ${response.status}: ${detail}. Check that the invite is permanent and still valid.`);
}

const members = Number(invite.approximate_member_count);
const online = Number(invite.approximate_presence_count);
if (!Number.isFinite(members) || !Number.isFinite(online)) {
  fail("Discord did not return approximate member counts for this invite.");
}

const snapshot = {
  time: new Date().toISOString(),
  members,
  online
};

const file = path.resolve("data/data.json");
let existing = { server: {}, history: [] };
try {
  existing = JSON.parse(await fs.readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    console.warn(`Existing data file could not be read and will be replaced: ${error.message}`);
  }
}

const history = Array.isArray(existing.history) ? existing.history : [];
const previous = history.at(-1);
snapshot.change = previous ? snapshot.members - Number(previous.members || 0) : 0;

if (!previous || previous.members !== snapshot.members || previous.online !== snapshot.online) {
  history.push(snapshot);
} else {
  previous.time = snapshot.time;
}

const maxEntries = 105_120;
if (history.length > maxEntries) history.splice(0, history.length - maxEntries);

const output = {
  server: {
    name: invite.guild?.name || existing.server?.name || "Discord server",
    inviteCode: invite.code || inviteCode,
    channel: invite.channel?.name || null,
    guildId: invite.guild?.id || null
  },
  updatedAt: snapshot.time,
  history
};

await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Recorded ${members} members and ${online} online for ${output.server.name}.`);
