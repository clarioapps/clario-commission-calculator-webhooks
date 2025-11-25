import express from "express";
import { createClient, AppStrategy } from "@wix/sdk";
import { appInstances } from "@wix/app-management";
import { siteProperties } from "@wix/business-tools";
import { Resend } from "resend";

const app = express();

// Accept raw text (Wix sends JWT as text)
app.use(express.text({ type: "*/*" }));

/* ───────────────────── Wix App IDs & Public Keys ───────────────────── */

// Commission Calculator
const COMM_APP_ID = "a1b89848-2c86-4f84-88d4-4634c3a9b1f8";
const COMM_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo8A5nj/4dkLBECsMMg3B
FzypOH6HPA9TtQdWRHeQ83kOjL1J/y1EyGqjoLxUNeE1UUeIsA5koyd1GkzQcD/v
uCpz3lK0Y9UEZDjDPdJDZD0ylwfvI5rXXsbbk2Y7kN5CjexiPFag41QuaJ/dF34b
0vqycwImHZAC/Md9NXJCHHK4DCaG4mqhwuXB8BO6oHuQRcU89UqsbAequyGxshcU
oxraNiEheNq7CyCfoTbcxdUye0Mu95EmV4UoojEqaaq0P0/CKEKLDibgofwRG5VX
v/Vz9fOR8FqmPhlYG0iGpvzS1CyS0VXjbIAxAa9HiOGXFA63xf0sAU2A21hFK7JH
HQIDAQAB
-----END PUBLIC KEY-----`;

// Transactions KPI
const KPI_APP_ID = "40ea058f-5654-4732-9de6-7c57f3485649";
const KPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA394uvbNpgLQpvvcBcY5p
g0XABNMwyOKfz8q8WotK9cblQ7qk+xVJn/oqyA9KLhIwKoA2GeENLSyLb8pjR8Gt
n4f+ObjJe/tlPonVOyzaCIIqku3ZSFIlSVh1Iw8K1RXRQzXXcNJ5bgrEgFNJjwdP
ZM65zwzI2gNoHNp3uAm9Bs0GwJJVUH237uUdknyWyY0ThptbLWqs1a/I0lJk4qrM
rDGdvHB9BAS0ZtAA0hYFMDQVNcFIVwMzrRR4T21rdvG7zKkTUUmVVHZR5eDphIoT
6ZhVZ3qONjXkJb5k0b98b/7DvdO3TGneqJ3K0CTmpteKRDV72tSrG/AEgjiKAxRe
8wIDAQAB
-----END PUBLIC KEY-----`;

/* ───────────────────── Env (set in Render → Environment) ─────────────────────
  COMM_APP_SECRET   = Commission app OAuth Client Secret (from Dev Center)
  KPI_APP_SECRET    = KPI app OAuth Client Secret (from Dev Center)
  RESEND_API_KEY    = your Resend key (optional, for email)
  ADMIN_EMAIL       = where to send admin emails
  FROM_EMAIL        = "Clario Apps <no-reply@yourdomain.com>"
-------------------------------------------------------------------------- */

const COMM_APP_SECRET = process.env.COMM_APP_SECRET || "";
const KPI_APP_SECRET  = process.env.KPI_APP_SECRET  || "";

/* ───────────────────── Verifier Clients (public key only) ─────────────────────
   Used solely to verify/decode the incoming Wix webhook JWT.
------------------------------------------------------------------------------- */

const verifierCommission = createClient({
  auth: AppStrategy({ appId: COMM_APP_ID, publicKey: COMM_PUBLIC_KEY }),
  modules: { appInstances },
});

const verifierKpi = createClient({
  auth: AppStrategy({ appId: KPI_APP_ID, publicKey: KPI_PUBLIC_KEY }),
  modules: { appInstances },
});

/* ───────────────────── Per-event Authed Client Builder ─────────────────────
   We must pass appId + appSecret + instanceId so the SDK mints an access token.
----------------------------------------------------------------------------- */

function clientForInstance(appId, appSecret, instanceId) {
  return createClient({
    auth: AppStrategy({
      appId,
      appSecret,     // OAuth Client Secret from Dev Center
      instanceId,    // from the webhook event payload
    }),
    modules: { appInstances, siteProperties },
  });
}

/* ───────────────────── Email Setup (Resend) ───────────────────── */

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "you@example.com";
const FROM_EMAIL  = process.env.FROM_EMAIL  || "Clario Apps <no-reply@example.com>";

async function sendAdminEmail(subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY not set – skipping email.");
    return;
  }
  if (!ADMIN_EMAIL || !FROM_EMAIL) {
    console.warn("⚠️ ADMIN_EMAIL or FROM_EMAIL not set – set them in Render environment.");
    return;
  }
  try {
    const result = await resend.emails.send({ from: FROM_EMAIL, to: [ADMIN_EMAIL], subject, html });
    console.log("📧 Admin email sent:", result);
  } catch (err) {
    console.error("❌ Failed to send admin email:", err);
  }
}

function isoOrNA(v) {
  if (!v) return "N/A";
  try { return new Date(v).toISOString(); } catch { return String(v); }
}

/* ───────────────────── Fetch Extra Instance Details ─────────────────────
   Requires app permissions (then reinstall the app to grant them):
   - Read site, business, and email details  (SITE_SETTINGS.VIEW)
   - Read Site Owner Email
------------------------------------------------------------------------- */

async function fetchInstanceDetails(appKey, instanceId) {
  try {
    const isCommission = appKey === "commission";
    const appId        = isCommission ? COMM_APP_ID     : KPI_APP_ID;
    const appSecret    = isCommission ? COMM_APP_SECRET : KPI_APP_SECRET;

    if (!appSecret) {
      console.warn(`⚠️ ${isCommission ? "COMM" : "KPI"}_APP_SECRET not set – details may be N/A.`);
    }

    const authed = clientForInstance(appId, appSecret, instanceId);

    // 1) App Instance (owner email & metaSiteId often live here)
    let ai;
    try {
      ai = await authed.appInstances.getAppInstance({ instanceId });
      console.log(`🔎 getAppInstance (${appKey}) result:`, JSON.stringify(ai, null, 2));
    } catch (e) {
      console.error("❌ getAppInstance failed:", e);
    }

    // 2) Site Properties (site name, language, currency, business email)
    let sp;
    try {
      sp = await authed.siteProperties.getSiteProperties({
        fields: ["siteDisplayName", "language", "paymentCurrency", "email"],
      });
      console.log(`🔎 getSiteProperties (${appKey}) result:`, JSON.stringify(sp, null, 2));
    } catch (e) {
      console.error("❌ getSiteProperties failed:", e);
    }

    // Normalize fields defensively
    const siteBlock = ai?.site || ai?.appInstance?.site;
    const ownerEmail =
      siteBlock?.ownerInfo?.email ||
      ai?.ownerEmail ||
      ai?.appInstance?.ownerEmail ||
      "N/A";

    const siteId =
      siteBlock?.metaSiteId ||
      ai?.siteId ||
      ai?.metaSiteId ||
      "N/A";

    const props = sp?.properties || {};
    const siteName = props.siteDisplayName || "N/A";
    const language = props.language || "N/A";
    const currency = props.paymentCurrency || "N/A";

    return { ownerEmail, siteId, siteName, language, currency };
  } catch (err) {
    console.error("❌ fetchInstanceDetails error:", err);
    return { ownerEmail: "N/A", siteId: "N/A", siteName: "N/A", language: "N/A", currency: "N/A" };
  }
}

/* ───────────────────── Email Builders (shared) ───────────────────── */

async function handleAppInstalled(event, appLabel, appKey) {
  console.log(`👉 [${appLabel}] App installed for instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – App Installed</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>App ID:</strong> ${event.payload?.appId || "N/A"}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – App Installed`, html);
}

async function handlePaidPlanPurchased(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Paid plan purchased for instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – Paid Plan Purchased</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Purchased at:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${isoOrNA(p.expiresOn)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – Paid Plan Purchased`, html);
}

async function handlePaidPlanAutoRenewalCancelled(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Auto-renewal cancelled. Instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – Auto-Renewal Cancelled</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Operation time:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${isoOrNA(p.expiresOn)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – Auto-Renewal Cancelled`, html);
}

async function handlePaidPlanReactivated(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Plan reactivated. Instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – Plan Reactivated</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Reactivated at:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – Plan Reactivated`, html);
}

async function handlePaidPlanConvertedToPaid(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Trial converted to paid. Instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – Plan Converted to Paid</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – Plan Converted to Paid`, html);
}

async function handlePaidPlanTransferred(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Plan transferred. Instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – Plan Transferred</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>From Instance:</strong> ${p.originInstanceId || "N/A"}</li>
      <li><strong>To Instance:</strong> ${p.targetInstanceId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – Plan Transferred`, html);
}

async function handleAppRemoved(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] App removed. Instance:`, event.instanceId);
  const extra = await fetchInstanceDetails(appKey, event.instanceId);
  const html = `
    <h1>${appLabel} – App Removed</h1>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Operation time:</strong> ${isoOrNA(p.operationTimeStamp)}</li>
      <li><strong>Owner Email:</strong> ${extra.ownerEmail}</li>
      <li><strong>Site Name:</strong> ${extra.siteName}</li>
      <li><strong>Site ID:</strong> ${extra.siteId}</li>
      <li><strong>Language:</strong> ${extra.language}</li>
      <li><strong>Currency:</strong> ${extra.currency}</li>
    </ul>`;
  await sendAdminEmail(`${appLabel} – App Removed`, html);
}

/* ───────────────────── Webhooks ───────────────────── */

app.post("/webhook", async (req, res) => {
  console.log("===== [Commission Calculator] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierCommission.webhooks.process(req.body);
    console.log("Decoded event (Commission):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Commission Calculator";
    switch (event.eventType) {
      case "AppInstalled":                await handleAppInstalled(event, appLabel, "commission"); break;
      case "PaidPlanPurchased":           await handlePaidPlanPurchased(event, appLabel, "commission"); break;
      case "PaidPlanAutoRenewalCancelled":await handlePaidPlanAutoRenewalCancelled(event, appLabel, "commission"); break;
      case "PaidPlanReactivated":
      case "PlanReactivated":             await handlePaidPlanReactivated(event, appLabel, "commission"); break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":         await handlePaidPlanConvertedToPaid(event, appLabel, "commission"); break;
      case "PaidPlanTransferred":
      case "PlanTransferred":             await handlePaidPlanTransferred(event, appLabel, "commission"); break;
      case "AppRemoved":                  await handleAppRemoved(event, appLabel, "commission"); break;
      default: console.log("[Commission] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[Commission] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

app.post("/webhook-kpi", async (req, res) => {
  console.log("===== [Transactions KPI] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierKpi.webhooks.process(req.body);
    console.log("Decoded event (KPI):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Transactions KPI";
    switch (event.eventType) {
      case "AppInstalled":                await handleAppInstalled(event, appLabel, "kpi"); break;
      case "PaidPlanPurchased":           await handlePaidPlanPurchased(event, appLabel, "kpi"); break;
      case "PaidPlanAutoRenewalCancelled":await handlePaidPlanAutoRenewalCancelled(event, appLabel, "kpi"); break;
      case "PaidPlanReactivated":
      case "PlanReactivated":             await handlePaidPlanReactivated(event, appLabel, "kpi"); break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":         await handlePaidPlanConvertedToPaid(event, appLabel, "kpi"); break;
      case "PaidPlanTransferred":
      case "PlanTransferred":             await handlePaidPlanTransferred(event, appLabel, "kpi"); break;
      case "AppRemoved":                  await handleAppRemoved(event, appLabel, "kpi"); break;
      default: console.log("[KPI] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[KPI] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

/* ───────────────────── Health ───────────────────── */

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

/* ───────────────────── Start server ───────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
