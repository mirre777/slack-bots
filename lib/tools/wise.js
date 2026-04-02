const WISE_API = "https://api.wise.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.WISE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function getProfiles() {
  const res = await fetch(`${WISE_API}/v2/profiles`, { headers: headers() });
  return res.json();
}

async function getBalances({ profileType } = {}) {
  const profiles = await getProfiles();
  const selected = profileType
    ? profiles.filter((p) => p.type === profileType.toUpperCase())
    : profiles;

  const results = [];

  for (const profile of selected) {
    const label = profile.type === "BUSINESS" ? "Business" : "Personal";
    const res = await fetch(`${WISE_API}/v4/profiles/${profile.id}/balances?types=STANDARD`, {
      headers: headers(),
    });
    const balances = await res.json();

    if (balances.length) {
      const lines = balances.map((b) => `  ${b.amount.currency}: ${b.amount.value.toFixed(2)}`);
      results.push(`**${label}:**\n${lines.join("\n")}`);
    }
  }

  return results.length ? results.join("\n\n") : "No balances found.";
}

async function getTransactions({ profileType, currency, limit = 10 } = {}) {
  const profiles = await getProfiles();
  const selected = profileType
    ? profiles.filter((p) => p.type === profileType.toUpperCase())
    : profiles;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const results = [];

  for (const profile of selected) {
    const label = profile.type === "BUSINESS" ? "Business" : "Personal";

    const actRes = await fetch(
      `${WISE_API}/v1/profiles/${profile.id}/activities?since=${since.toISOString()}&size=${limit}`,
      { headers: headers() }
    );
    const data = await actRes.json();
    const activities = data.activities || data;

    if (activities?.length) {
      const lines = activities.slice(0, limit).map((a) => {
        const date = new Date(a.createdOn || a.date).toLocaleDateString("nl-NL");
        const desc = a.title || a.description || "Unknown";
        const amount = a.primaryAmount
          ? `${a.primaryAmount.value > 0 ? "+" : ""}${a.primaryAmount.value.toFixed(2)} ${a.primaryAmount.currency}`
          : "";
        return `  ${date} — ${desc} ${amount}`;
      });
      results.push(`**${label}:**\n${lines.join("\n")}`);
    }
  }

  return results.length ? results.join("\n\n") : "No recent transactions found.";
}

async function getExchangeRate({ from, to }) {
  const res = await fetch(
    `${WISE_API}/v1/rates?source=${from.toUpperCase()}&target=${to.toUpperCase()}`,
    { headers: headers() }
  );
  const rates = await res.json();
  if (!rates.length) return `No rate found for ${from} → ${to}.`;
  const rate = rates[0];
  return `${from.toUpperCase()} → ${to.toUpperCase()}: ${rate.rate.toFixed(4)} (${new Date(rate.time).toLocaleString("nl-NL")})`;
}

module.exports = { getBalances, getTransactions, getExchangeRate };
