const WISE_API = "https://api.wise.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.WISE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function getProfileId() {
  const res = await fetch(`${WISE_API}/v2/profiles`, { headers: headers() });
  const profiles = await res.json();
  // Prefer business profile, fallback to personal
  const profile = profiles.find((p) => p.type === "BUSINESS") || profiles[0];
  return profile.id;
}

async function getBalances() {
  const profileId = await getProfileId();
  const res = await fetch(`${WISE_API}/v4/profiles/${profileId}/balances?types=STANDARD`, {
    headers: headers(),
  });
  const balances = await res.json();

  if (!balances.length) return "No balances found.";

  return balances
    .map((b) => {
      const amount = b.amount.value.toFixed(2);
      const currency = b.amount.currency;
      return `${currency}: ${amount}`;
    })
    .join("\n");
}

async function getTransactions({ currency, limit = 10 }) {
  const profileId = await getProfileId();

  // Get the balance ID for the requested currency
  const balRes = await fetch(`${WISE_API}/v4/profiles/${profileId}/balances?types=STANDARD`, {
    headers: headers(),
  });
  const balances = await balRes.json();

  const balance = currency
    ? balances.find((b) => b.amount.currency === currency.toUpperCase())
    : balances[0];

  if (!balance) return `No balance found for ${currency || "any currency"}.`;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const params = new URLSearchParams({
    intervalStart: since.toISOString(),
    intervalEnd: new Date().toISOString(),
    type: "COMPACT",
  });

  const res = await fetch(
    `${WISE_API}/v4/profiles/${profileId}/balances/${balance.id}/statements/${params}`,
    { headers: headers() }
  );

  // Fallback: use v1 activities endpoint
  const actRes = await fetch(
    `${WISE_API}/v1/profiles/${profileId}/activities?since=${since.toISOString()}&size=${limit}`,
    { headers: headers() }
  );
  const data = await actRes.json();
  const activities = data.activities || data;

  if (!activities?.length) return "No recent transactions found.";

  return activities
    .slice(0, limit)
    .map((a) => {
      const date = new Date(a.createdOn || a.date).toLocaleDateString("nl-NL");
      const desc = a.title || a.description || "Unknown";
      const amount = a.primaryAmount
        ? `${a.primaryAmount.value > 0 ? "+" : ""}${a.primaryAmount.value.toFixed(2)} ${a.primaryAmount.currency}`
        : "";
      return `${date} — ${desc} ${amount}`;
    })
    .join("\n");
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
