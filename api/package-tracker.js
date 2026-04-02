const { listEmailsRaw } = require("../lib/tools/gmail");
const { askClaude } = require("../lib/claude");
const { postMessage } = require("../lib/slack");
const { addPackage, getTrackedPackages, removeDelivered } = require("../lib/tools/tracking");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  // Step 1: Scan recent emails for tracking numbers
  const emails = await listEmailsRaw({
    maxResults: 30,
    query: "newer_than:3d (track OR tracking OR bezorging OR verzending OR pakket OR shipment OR bestelling OR order)",
  });

  let newPackages = [];

  if (emails.length) {
    const emailText = emails
      .map((e) => `Subject: ${e.subject}\nFrom: ${e.from}\n${e.snippet}`)
      .join("\n\n---\n\n");

    const result = await askClaude(
      "You extract package tracking information from emails. Only return valid JSON.",
      `Find all package tracking numbers in these emails. Look for PostNL, DHL, UPS, DPD, GLS, or any other carrier tracking codes.

Emails:
${emailText}

Return a JSON array. Each item:
- "code": the tracking number/code
- "carrier": carrier name (PostNL, DHL, UPS, DPD, GLS, or Other)
- "description": what was ordered (from subject/snippet, concise, in Dutch)
- "source": sender/shop name

If no tracking numbers found, return empty array: []
Respond ONLY with the JSON array.`,
      false
    );

    let found;
    try {
      found = JSON.parse(result);
    } catch {
      found = [];
    }

    // Add each new package
    for (const pkg of found) {
      const carrierMap = {
        postnl: { name: "PostNL", url: (c) => `https://postnl.nl/tracktrace/?B=${c}&P=&D=&T=C` },
        dhl: { name: "DHL", url: (c) => `https://www.dhl.nl/nl/express/tracering.html?AWB=${c}` },
        ups: { name: "UPS", url: (c) => `https://www.ups.com/track?tracknum=${c}` },
        dpd: { name: "DPD", url: (c) => `https://tracking.dpd.de/status/nl_NL/parcel/${c}` },
        gls: { name: "GLS", url: (c) => `https://gls-group.com/NL/nl/volg-je-pakket?match=${c}` },
      };

      const carrierId = pkg.carrier?.toLowerCase().replace(/\s/g, "") || "other";
      const carrierInfo = carrierMap[carrierId];
      const trackUrl = carrierInfo
        ? carrierInfo.url(pkg.code)
        : `https://parcelsapp.com/nl/tracking/${pkg.code}`;

      const added = await addPackage({
        code: pkg.code,
        carrier: pkg.carrier || "Other",
        carrierId,
        trackUrl,
        description: pkg.description,
        source: pkg.source,
      });

      if (added) newPackages.push(added);
    }
  }

  // Step 2: Get all tracked packages
  const allPackages = await getTrackedPackages();

  // Step 3: Clean up old delivered packages
  await removeDelivered();

  // Step 4: Post to Slack
  if (newPackages.length > 0 || allPackages.length > 0) {
    let message = `:package: *Pakket Tracker*\n`;

    if (newPackages.length) {
      message += `\n*Nieuw gevonden:*\n`;
      message += newPackages
        .map((p) => `• *${p.description}* van ${p.source}\n  ${p.carrier}: <${p.trackUrl}|${p.code}>`)
        .join("\n");
    }

    if (allPackages.length) {
      message += `\n\n*Alle actieve pakketten (${allPackages.length}):*\n`;
      message += allPackages
        .map((p) => `• *${p.description}* — ${p.carrier}: <${p.trackUrl}|Track>`)
        .join("\n");
    }

    await postMessage(process.env.BOT1_TOKEN, process.env.SLACK_CHANNEL_ID, message);
  }

  return res.status(200).json({
    status: "ok",
    newPackages: newPackages.length,
    totalTracked: allPackages.length,
  });
};
