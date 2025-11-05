import express from "express";
import { AppStrategy, createClient } from "@wix/sdk";
import { appInstances } from "@wix/app-management";
import { Resend } from "resend";

const app = express();

// 🔑 Your Wix app public key (exactly as shown in Dev Center)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo8A5nj/4dkLBECsMMg3B
FzypOH6HPA9TtQdWRHeQ83kOjL1J/y1EyGqjoLxUNeE1UUeIsA5koyd1GkzQcD/v
uCpz3lK0Y9UEZDjDPdJDZD0ylwfvI5rXXsbbk2Y7kN5CjexiPFag41QuaJ/dF34b
0vqycwImHZAC/Md9NXJCHHK4DCaG4mqhwuXB8BO6oHuQRcU89UqsbAequyGxshcU
oxraNiEheNq7CyCfoTbcxdUye0Mu95EmV4UoojEqaaq0P0/CKEKLDibgofwRG5VX
v/Vz9fOR8FqmPhlYG0iGpvzS1CyS0VXjbIAxAa9HiOGXFA63xf0sAU2A21hFK7JH
HQIDAQAB
-----END PUBLIC KEY-----`;

const APP_ID = "a1b89848-2c86-4f84-88d4-4634c3a9b1f8";

// Create Wix SDK client
const client = createClient({
  auth: AppStrategy({
    appId: APP_ID,
    publicKey: PUBLIC_KEY,
  }),
  modules: { appInstances },
});

// ───────────────────── Resend Setup ─────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

// change these in Render → Environment
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

// ───────────────────── Event Handlers ─────────────────────

// AppInstalled
async function handleAppInstalled(event) {
  console.log("👉 App installed for instance:", event.instanceId);

  const html = `
    <h1>Clario Commission Calculator – App Installed</h1>
    <p>The app was just <strong>installed</strong> on a site.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>App ID:</strong> ${event.payload?.appId || "N/A"}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – App Installed",
    html
  );
}

// PaidPlanPurchased
async function handlePaidPlanPurchased(event) {
  const p = event.payload || {};
  console.log("👉 Paid plan purchased for instance:", event.instanceId);
  console.log("   Product:", p.vendorProductId);
  console.log("   Cycle:", p.cycle);
  console.log("   Expires on:", p.expiresOn);

  const html = `
    <h1>Clario Commission Calculator – Paid Plan Purchased</h1>
    <p>A user just <strong>purchased a paid plan</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Purchased at:</strong> ${formatDate(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${formatDate(p.expiresOn)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – Paid Plan Purchased",
    html
  );
}

// PaidPlanAutoRenewalCancelled
async function handlePaidPlanAutoRenewalCancelled(event) {
  const p = event.payload || {};
  console.log("👉 Auto-renewal cancelled for instance:", event.instanceId);
  console.log("   Product:", p.vendorProductId);
  console.log("   Expires on:", p.expiresOn);

  const html = `
    <h1>Clario Commission Calculator – Auto-Renewal Cancelled</h1>
    <p>A user <strong>cancelled auto-renewal</strong> for their paid plan.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
      <li><strong>Expires on:</strong> ${formatDate(p.expiresOn)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – Auto-Renewal Cancelled",
    html
  );
}

// PaidPlanReactivated
async function handlePaidPlanReactivated(event) {
  const p = event.payload || {};
  console.log("👉 Paid plan reactivated for instance:", event.instanceId);

  const html = `
    <h1>Clario Commission Calculator – Plan Reactivated</h1>
    <p>A previously cancelled plan was <strong>reactivated</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Cycle:</strong> ${p.cycle || "N/A"}</li>
      <li><strong>Reactivated at:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – Plan Reactivated",
    html
  );
}

// PaidPlanConvertedToPaid
async function handlePaidPlanConvertedToPaid(event) {
  const p = event.payload || {};
  console.log("👉 Trial converted to paid for instance:", event.instanceId);

  const html = `
    <h1>Clario Commission Calculator – Plan Converted to Paid</h1>
    <p>A user converted from a <strong>free or trial plan to a paid plan</strong>.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – Plan Converted to Paid",
    html
  );
}

// PaidPlanTransferred
async function handlePaidPlanTransferred(event) {
  const p = event.payload || {};
  console.log("👉 Plan transferred. Instance:", event.instanceId);
  console.log("   From:", p.originInstanceId);
  console.log("   To:", p.targetInstanceId);

  const html = `
    <h1>Clario Commission Calculator – Plan Transferred</h1>
    <p>A paid plan was <strong>transferred</strong> (e.g. to a different site or owner).</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Vendor Product ID:</strong> ${p.vendorProductId || "N/A"}</li>
      <li><strong>From Instance:</strong> ${p.originInstanceId || "N/A"}</li>
      <li><strong>To Instance:</strong> ${p.targetInstanceId || "N/A"}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – Plan Transferred",
    html
  );
}

// AppRemoved
async function handleAppRemoved(event) {
  const p = event.payload || {};
  console.log("👉 App removed from instance:", event.instanceId);

  const html = `
    <h1>Clario Commission Calculator – App Removed</h1>
    <p>The app was <strong>removed/uninstalled</strong> from a site.</p>
    <ul>
      <li><strong>Instance ID:</strong> ${event.instanceId}</li>
      <li><strong>Operation time:</strong> ${formatDate(p.operationTimeStamp)}</li>
    </ul>
  `;

  await sendAdminEmail(
    "Clario Commission Calculator – App Removed",
    html
  );
}

// ───────────────────── Webhook endpoint ─────────────────────

app.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  console.log("===== Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    // Let Wix SDK verify & decode the webhook
    const event = await client.webhooks.process(req.body);

    console.log("Decoded event from Wix SDK:");
    console.log(JSON.stringify(event, null, 2));

    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event);
        break;

      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event);
        break;

      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event);
        break;

      // Reactivated – handle both names
      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event);
        break;

      // Converted to Paid – handle both names
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event);
        break;

      // Transferred – handle both names
      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event);
        break;

      case "AppRemoved":
        await handleAppRemoved(event);
        break;

      default:
        console.log("👉 Unhandled event type:", event.eventType);
        break;
    }
  } catch (err) {
    console.error("Error in client.webhooks.process:", err);
    // We still return 200 so Dev Center "Test" shows as delivered
  }

  res.status(200).send("ok");
});

// ───────────────────── Start server ─────────────────────

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

