import express from "express";
import { AppStrategy, createClient } from "@wix/sdk";
import { appInstances } from "@wix/app-management";
import { Resend } from "resend";

const app = express();

/* ───────────────────── Wix App IDs & Public Keys ───────────────────── */

// Commission Calculator
const CC_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo8A5nj/4dkLBECsMMg3B
FzypOH6HPA9TtQdWRHeQ83kOjL1J/y1EyGqjoLxUNeE1UUeIsA5koyd1GkzQcD/v
uCpz3lK0Y9UEZDjDPdJDZD0ylwfvI5rXXsbbk2Y7kN5CjexiPFag41QuaJ/dF34b
0vqycwImHZAC/Md9NXJCHHK4DCaG4mqhwuXB8BO6oHuQRcU89UqsbAequyGxshcU
oxraNiEheNq7CyCfoTbcxdUye0Mu95EmV4UoojEqaaq0P0/CKEKLDibgofwRG5VX
v/Vz9fOR8FqmPhlYG0iGpvzS1CyS0VXjbIAxAa9HiOGXFA63xf0sAU2A21hFK7JH
HQIDAQAB
-----END PUBLIC KEY-----`;

const CC_APP_ID = "a1b89848-2c86-4f84-88d4-4634c3a9b1f8";

// Transactions KPI
const KPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA394uvbNpgLQpvvcBcY5p
g0XABNMwyOKfz8q8WotK9cblQ7qk+xVJn/oqyA9KLhIwKoA2GeENLSyLb8pjR8Gt
n4f+ObjJe/tlPonVOyzaCIIqku3ZSFIlSVh1Iw8K1RXRQzXXcNJ5bgrEgFNJjwdP
ZM65zwzI2gNoHNp3uAm9Bs0GwJJVUH237uUdknyWyY0ThptbLWqs1a/I0lJk4qrM
rDGdvHB9BAS0ZtAA0hYFMDQVNcFIVwMzrRR4T21rdvG7zKkTUUmVVHZR5eDphIoT
6ZhVZ3qONjXkJb5k0b98b/7DvdO3TGneqJ3K0CTmpteKRDV72tSrG/AEgjiKAxRe
8wIDAQAB
-----END PUBLIC KEY-----`;

const KPI_APP_ID = "40ea058f-5654-4732-9de6-7c57f3485649";

/* ───────────────────── Wix SDK clients ───────────────────── */

const ccClient = createClient({
  auth: AppStrategy({
    appId: CC_APP_ID,
    publicKey: CC_PUBLIC_KEY,
  }),
  modules: { appInstances },
});

const kpiClient = createClient({
  auth: AppStrategy({
    appId: KPI_APP_ID,
    publicKey: KPI_PUBLIC_KEY,
  }),
  modules: { appInstances },
});

/* ───────────────────── Resend Setup ───────────────────── */

const resend = new Resend(process.env.RESEND_API_KEY);

// set these in Render → Environment
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "you@example.com";
const FROM_EMAIL =
  process.env.FROM_EMAIL || "Clario Apps <no-reply@example.com>";

async function sendAdminEmail(subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY not set – skipping email.");
    return;
  }
  if (!ADMIN_EMAIL || !FROM_EMAIL) {
    console.warn(
      "⚠️ ADMIN_EMAIL or FROM_EMAIL not set – set them in Render environment."
    );
    return;
  }

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject,
      html,
    });
    console.log("📧 Admin email sent:", result);
  } catch (err) {
    console.error("❌ Failed to send admin email:", err);
  }
}

function formatDate(value) {
  if (!value) return "N/A";
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value);
  }
}

/* ───────────────────── Generic Event Handlers ─────────────────────
   appName = "Clario Commission Calculator" OR "Clario Transactions KPI"
───────────────────── */

async function handleAppInstalled(event, appName) {
  console.log(`👉 [${appName}] App installed for instance:`, event.instanceId);

  const html = `
    <h1>${appName} – App Installed</h1>
    <p>The app was just <strong>installed</strong> on a site.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>App ID:</strong> ${event.payload?.appId || "N/A"}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – App Installed`, html);
}

async function handlePaidPlanPurchased(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] Paid plan purchased for instance:`, event.instanceId);
  console.log("   Product:", p.vendorProductId);
  console.log("   Cycle:", p.cycle);
  console.log("   Expires on:", p.expiresOn);

  const html = `
    <h1>${appName} – Paid Plan Purchased</h1>
    <p>A user just <strong>purchased a paid plan</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Purchased at:</strong> ${formatDate(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${formatDate(p.expiresOn)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – Paid Plan Purchased`, html);
}

async function handlePaidPlanAutoRenewalCancelled(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] Auto-renewal cancelled for instance:`, event.instanceId);
  console.log("   Product:", p.vendorProductId);
  console.log("   Expires on:", p.expiresOn);

  const html = `
    <h1>${appName} – Auto-Renewal Cancelled</h1>
    <p>A user <strong>cancelled auto-renewal</strong> for their paid plan.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${formatDate(p.expiresOn)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – Auto-Renewal Cancelled`, html);
}

async function handlePaidPlanReactivated(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] Paid plan reactivated for instance:`, event.instanceId);

  const html = `
    <h1>${appName} – Plan Reactivated</h1>
    <p>A previously cancelled plan was <strong>reactivated</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Reactivated at:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – Plan Reactivated`, html);
}

async function handlePaidPlanConvertedToPaid(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] Trial converted to paid for instance:`, event.instanceId);

  const html = `
    <h1>${appName} – Plan Converted to Paid</h1>
    <p>A user converted from a <strong>free or trial plan to a paid plan</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – Plan Converted to Paid`, html);
}

async function handlePaidPlanTransferred(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] Plan transferred. Instance:`, event.instanceId);
  console.log("   From:", p.originInstanceId);
  console.log("   To:", p.targetInstanceId);

  const html = `
    <h1>${appName} – Plan Transferred</h1>
    <p>A paid plan was <strong>transferred</strong> (e.g. to a different site or owner).</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>From Instance:</strong> ${p.originInstanceId || "N/A"}</li>
      <li><strong>To Instance:</strong> ${p.targetInstanceId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – Plan Transferred`, html);
}

async function handleAppRemoved(event, appName) {
  const p = event.payload || {};
  console.log(`👉 [${appName}] App removed from instance:`, event.instanceId);

  const html = `
    <h1>${appName} – App Removed</h1>
    <p>The app was <strong>removed/uninstalled</strong> from a site.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(`${appName} – App Removed`, html);
}

/* ───────────────────── Webhook endpoint: Commission Calculator ───────────────────── */

app.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  console.log("===== [Commission Calculator] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await ccClient.webhooks.process(req.body);

    console.log("Decoded CC event from Wix SDK:");
    console.log(JSON.stringify(event, null, 2));

    const appName = "Clario Commission Calculator";

    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event, appName);
        break;

      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appName);
        break;

      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appName);
        break;

      // Reactivated – handle both names
      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appName);
        break;

      // Converted to Paid – handle both names
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appName);
        break;

      // Transferred – handle both names
      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appName);
        break;

      case "AppRemoved":
        await handleAppRemoved(event, appName);
        break;

      default:
        console.log("[CC] 👉 Unhandled event type:", event.eventType);
        break;
    }
  } catch (err) {
    console.error("[CC] Error in webhooks.process:", err);
  }

  res.status(200).send("ok");
});

/* ───────────────────── Webhook endpoint: Transactions KPI ───────────────────── */

app.post("/webhook-kpi", express.text({ type: "*/*" }), async (req, res) => {
  console.log("===== [Transactions KPI] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await kpiClient.webhooks.process(req.body);

    console.log("Decoded KPI event from Wix SDK:");
    console.log(JSON.stringify(event, null, 2));

    const appName = "Clario Transactions KPI";

    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event, appName);
        break;

      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appName);
        break;

      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appName);
        break;

      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appName);
        break;

      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appName);
        break;

      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appName);
        break;

      case "AppRemoved":
        await handleAppRemoved(event, appName);
        break;

      default:
        console.log("[KPI] 👉 Unhandled event type:", event.eventType);
        break;
    }
  } catch (err) {
    console.error("[KPI] Error in webhooks.process:", err);
  }

  res.status(200).send("ok");
});

/* ───────────────────── Start server ───────────────────── */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
