#!/usr/bin/env node
/**
 * Prints the live Railway deployment URL to stdout.
 *
 * Strategy (in order):
 *  1. Query Railway GraphQL API for the latest deployment staticUrl
 *  2. Query service domains (serviceDomains / customDomains)
 *  3. Fall back to FALLBACK_APP_URL env var (set from secrets.APP_URL in CI)
 *
 * Required env vars: RAILWAY_TOKEN, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID
 * Optional env var:  FALLBACK_APP_URL
 */

const {
  RAILWAY_TOKEN,
  RAILWAY_SERVICE_ID,
  RAILWAY_ENVIRONMENT_ID,
  FALLBACK_APP_URL,
} = process.env;

async function gql(query, variables = {}) {
  const res = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${RAILWAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Railway API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors[0]));
  return json.data;
}

function useFallback(reason) {
  if (FALLBACK_APP_URL) {
    process.stderr.write(`[get-railway-url] ${reason} — using FALLBACK_APP_URL\n`);
    process.stdout.write(FALLBACK_APP_URL + "\n");
    process.exit(0);
  }
  process.stderr.write(`[get-railway-url] ${reason} and no FALLBACK_APP_URL set\n`);
  process.exit(1);
}

if (!RAILWAY_TOKEN || !RAILWAY_SERVICE_ID) {
  useFallback("Missing RAILWAY_TOKEN or RAILWAY_SERVICE_ID");
}

// ── Strategy 1: latest deployment staticUrl ────────────────────────────────
try {
  const data = await gql(
    `query($serviceId: String!, $environmentId: String!) {
       deployments(input: { serviceId: $serviceId, environmentId: $environmentId }) {
         edges { node { staticUrl } }
       }
     }`,
    { serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID ?? "" },
  );
  const url = data?.deployments?.edges?.[0]?.node?.staticUrl;
  if (url) {
    process.stdout.write((url.startsWith("http") ? url : `https://${url}`) + "\n");
    process.exit(0);
  }
} catch (e) {
  process.stderr.write(`[get-railway-url] deployments query failed: ${e.message}\n`);
}

// ── Strategy 2: service domains ────────────────────────────────────────────
try {
  const data = await gql(
    `query($serviceId: String!) {
       service(id: $serviceId) {
         domains {
           serviceDomains { domain }
           customDomains  { domain }
         }
       }
     }`,
    { serviceId: RAILWAY_SERVICE_ID },
  );
  const dom     = data?.service?.domains ?? {};
  const custom  = (dom.customDomains  ?? []).map(x => x.domain).filter(Boolean);
  const service = (dom.serviceDomains ?? []).map(x => x.domain).filter(Boolean);
  const pick    = custom[0] ?? service[0];
  if (pick) {
    process.stdout.write(`https://${pick}\n`);
    process.exit(0);
  }
} catch (e) {
  process.stderr.write(`[get-railway-url] service domains query failed: ${e.message}\n`);
}

// ── Strategy 3: fallback ───────────────────────────────────────────────────
useFallback("All Railway API strategies failed");
