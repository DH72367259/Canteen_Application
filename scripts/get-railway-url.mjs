#!/usr/bin/env node
/**
 * Queries the Railway GraphQL API and prints the live service URL to stdout.
 * Used by CI to resolve the deployment URL without a static APP_URL secret.
 *
 * Required env vars: RAILWAY_TOKEN, RAILWAY_SERVICE_ID
 */

const { RAILWAY_TOKEN, RAILWAY_SERVICE_ID } = process.env;

if (!RAILWAY_TOKEN || !RAILWAY_SERVICE_ID) {
  process.stderr.write("Missing RAILWAY_TOKEN or RAILWAY_SERVICE_ID env vars\n");
  process.exit(1);
}

const query = `query {
  service(id: "${RAILWAY_SERVICE_ID}") {
    domains {
      serviceDomains { domain }
      customDomains  { domain }
    }
  }
}`;

let res;
try {
  res = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${RAILWAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
} catch (err) {
  process.stderr.write(`Railway API request failed: ${err.message}\n`);
  process.exit(1);
}

if (!res.ok) {
  process.stderr.write(`Railway API returned ${res.status}\n`);
  process.exit(1);
}

const data = await res.json();
const dom  = data?.data?.service?.domains ?? {};

// Prefer a custom domain; fall back to the Railway-assigned *.up.railway.app domain
const custom  = (dom.customDomains  ?? []).map(x => x.domain).filter(Boolean);
const service = (dom.serviceDomains ?? []).map(x => x.domain).filter(Boolean);
const pick    = custom[0] ?? service[0];

if (!pick) {
  process.stderr.write("No domain found for this Railway service\n");
  process.exit(1);
}

process.stdout.write(`https://${pick}\n`);
