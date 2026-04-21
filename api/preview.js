const querystring = require("querystring");
const { waitUntil } = require("@vercel/functions");
const { verifySlackSignature } = require("../lib/slack");

const PRODUCTION_BRANCH = "main";

function parseAllowlist() {
  const raw = process.env.ALLOWED_SLACK_USER_IDS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function createPreviewDeployment(branch) {
  const body = {
    name: "onething",
    gitSource: {
      type: "github",
      repoId: parseInt(process.env.ONETHING_GITHUB_REPO_ID, 10),
      ref: branch,
    },
  };
  const res = await fetch(
    `https://api.vercel.com/v13/deployments?teamId=${process.env.VERCEL_TEAM_ID}&forceNew=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Vercel API ${res.status}`);
  return data;
}

async function processAsync(responseUrl, branch) {
  try {
    const dep = await createPreviewDeployment(branch);
    const url = dep.url ? `https://${dep.url}` : "(no url)";
    const inspectUrl = dep.inspectorUrl || `https://vercel.com/mirre777s-projects/onething/${dep.id}`;
    const text = [
      `:rocket: Preview deploy queued for \`${branch}\``,
      `URL: ${url}`,
      `Inspect: ${inspectUrl}`,
      `State: \`${dep.readyState || dep.status || "QUEUED"}\` (auto-updates on Vercel)`,
    ].join("\n");
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "in_channel", text }),
    });
  } catch (err) {
    console.error("preview async failed:", err);
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: `:x: Preview deploy failed: ${err.message}`,
      }),
    }).catch(() => {});
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  if (!verifySlackSignature(req, rawBody, process.env.BOT1_SIGNING_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const params = querystring.parse(rawBody);
  const userId = params.user_id;
  const text = (params.text || "").trim();
  const responseUrl = params.response_url;

  const allowlist = parseAllowlist();
  if (allowlist.length === 0) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: `Preview deploys are locked. Your Slack user_id is \`${userId}\` — add it to \`ALLOWED_SLACK_USER_IDS\` (comma-separated) in Vercel env and retry.`,
    });
  }
  if (!allowlist.includes(userId)) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: `:no_entry: Your Slack user_id \`${userId}\` is not allowed to trigger preview deploys.`,
    });
  }

  if (!text) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: "Usage: `/preview <branch>` — deploys the given branch as a preview. Branch must exist on GitHub.",
    });
  }
  if (text === PRODUCTION_BRANCH) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: `:warning: Refusing to deploy \`${PRODUCTION_BRANCH}\` as preview. Use the Vercel dashboard for production deploys.`,
    });
  }

  const branch = text.split(/\s+/)[0];
  waitUntil(processAsync(responseUrl, branch));

  return res.status(200).json({
    response_type: "in_channel",
    text: `:hourglass_flowing_sand: Creating preview deployment for \`${branch}\`…`,
  });
};

module.exports.config = { api: { bodyParser: false } };
