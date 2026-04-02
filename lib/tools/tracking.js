const { getClient } = require("../redis");

const CARRIERS = {
  postnl: {
    name: "PostNL",
    patterns: [/\b(3S[A-Z0-9]{10,15})\b/gi, /\b([A-Z]{2}\d{9}NL)\b/g],
    trackUrl: (code) => `https://postnl.nl/tracktrace/?B=${code}&P=&D=&T=C`,
  },
  dhl: {
    name: "DHL",
    patterns: [/\b(JJD\d{18,22})\b/g, /\b(JVGL\d{14,20})\b/g, /\b(\d{10,22})\b/g],
    trackUrl: (code) => `https://www.dhl.nl/nl/express/tracering.html?AWB=${code}`,
  },
  ups: {
    name: "UPS",
    patterns: [/\b(1Z[A-Z0-9]{16})\b/g],
    trackUrl: (code) => `https://www.ups.com/track?tracknum=${code}`,
  },
  dpd: {
    name: "DPD",
    patterns: [/\b(0\d{13})\b/g],
    trackUrl: (code) => `https://tracking.dpd.de/status/nl_NL/parcel/${code}`,
  },
  gls: {
    name: "GLS",
    patterns: [/\b(\d{11,12})\b/g],
    trackUrl: (code) => `https://gls-group.com/NL/nl/volg-je-pakket?match=${code}`,
  },
};

// Priority order — check specific carriers first, generic number patterns last
const CARRIER_ORDER = ["postnl", "ups", "dpd", "dhl"];

function extractTrackingNumbers(text) {
  const found = [];
  const seen = new Set();

  for (const carrierId of CARRIER_ORDER) {
    const carrier = CARRIERS[carrierId];
    for (const pattern of carrier.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const code = match[1];
        // Skip short generic numbers (too many false positives)
        if (carrierId === "dhl" && code.length < 14 && !/^JJD|^JVGL/.test(code)) continue;
        if (carrierId === "gls" && code.length < 11) continue;
        if (!seen.has(code)) {
          seen.add(code);
          found.push({
            code,
            carrier: carrier.name,
            carrierId,
            trackUrl: carrier.trackUrl(code),
          });
        }
      }
    }
  }

  return found;
}

async function getTrackedPackages() {
  const redis = getClient();
  const data = await redis.get("tracked_packages");
  return data ? JSON.parse(data) : [];
}

async function saveTrackedPackages(packages) {
  const redis = getClient();
  await redis.set("tracked_packages", JSON.stringify(packages));
}

async function addPackage({ code, carrier, carrierId, trackUrl, description, source }) {
  const packages = await getTrackedPackages();
  const exists = packages.find((p) => p.code === code);
  if (exists) return null;

  const pkg = {
    code,
    carrier,
    carrierId,
    trackUrl,
    description: description || "Unknown package",
    source: source || "email",
    status: "Gevonden in email",
    addedAt: new Date().toISOString(),
    lastChecked: null,
  };

  packages.push(pkg);
  await saveTrackedPackages(packages);
  return pkg;
}

async function removeDelivered() {
  const packages = await getTrackedPackages();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

  const active = packages.filter((p) => {
    if (p.status?.toLowerCase().includes("bezorgd") || p.status?.toLowerCase().includes("delivered")) {
      return new Date(p.deliveredAt || p.addedAt) > cutoff;
    }
    return true;
  });

  await saveTrackedPackages(active);
  return packages.length - active.length;
}

module.exports = {
  CARRIERS,
  extractTrackingNumbers,
  getTrackedPackages,
  saveTrackedPackages,
  addPackage,
  removeDelivered,
};
