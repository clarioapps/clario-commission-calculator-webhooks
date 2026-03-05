import express from "express";
import { createClient, AppStrategy } from "@wix/sdk";
import { appInstances } from "@wix/app-management";
import { siteProperties } from "@wix/business-tools";
import { Resend } from "resend";

const app = express();

/* ───────────────────── Parsers ─────────────────────
   IMPORTANT:
   - Webhook routes need RAW TEXT.
   - Our custom routes (showings) need JSON.
*/
const jsonParser = express.json({ limit: "1mb" });
const rawText = express.text({ type: "*/*" });

// ✅ FIX: ensure webhooks receive RAW TEXT even if Wix sends application/json
app.use((req, res, next) => {
  if (
  req.path === "/webhook" ||
  req.path === "/webhook-kpi" ||
  req.path === "/webhook-mortgage" ||
  req.path === "/webhook-showing-scheduler"
) {
  return rawText(req, res, next);
}
  return jsonParser(req, res, next);
});

/* ───────────────────── Showings Route Diagnostics (TEMP) ─────────────────────
   Logs inbound /showings traffic + auth decision + resend send attempts
--------------------------------------------------------------------------- */
app.use("/showings", (req, _res, next) => {
  try {
    console.log("[ShowingsRoute] INBOUND", {
      method: req.method,
      path: req.path,
      contentType: req.headers["content-type"] || "",
      reqId: req.headers["x-clario-reqid"] || "",
      hasBody: !!req.body,
      bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
    });
  } catch (e) {
    console.log("[ShowingsRoute] INBOUND log failed:", e);
  }
  next();
});

/* ───────────────────── Support Route Diagnostics (TEMP) ───────────────────── */
app.use("/support", (req, _res, next) => {
  try {
    console.log("[SupportRoute] INBOUND", {
      method: req.method,
      path: req.path,
      contentType: req.headers["content-type"] || "",
      reqId: req.headers["x-clario-reqid"] || "",
      hasBody: !!req.body,
      bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
    });
  } catch (e) {
    console.log("[SupportRoute] INBOUND log failed:", e);
  }
  next();
});

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

// 3-in-1 Mortgage Calculator
const MORTGAGE_APP_ID = "1f98b470-b5ed-4a30-964d-eac0970e876c";
const MORTGAGE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyoix9ey+HOrVI+FyYd0x
4GOhjogDKqjrpUAq1QhVhLxj8MpxKqQobeJ9BYY0Ef8EenMxzoXmfYPfeIJTLmX2
gFCj+LQjYubpKjoV14UHv7dWw+Ei+dCRmDrs2AwYhLEd0oDChtdeuwlZVrKToQ3Z
b8LLwH5z8FzxXlTrYH+Z+pFbgi3bBrJ2+dkqTQIS3rCVAvovzbqrwfUrVcBSipAh
WQ58o6mSHmzu/c/KCGBOAbWhu7yRYmcdo2B6jC/wXh48xMCilqkWlWXlX/FE2rIO
XZ0NxerAygYREHDxA4PZQnTy9ZuEbvD5kZX115WOVFZo7QMW7YfARuHlzx4abhZw
NQIDAQAB
-----END PUBLIC KEY-----`;

// Showing Scheduler
const SHOWINGS_APP_ID = "e537a7a6-e228-483c-b33f-8174ccadf567";
const SHOWINGS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyJ/GANiZXLLsDokCUvsD
Qdq3qnUZfQNq1cSUoQI8yiUjZF9FNQeH9zT6wQh7DEbH91v+iRXjW+6wvge+Y8PU
FWOiBwed9/H+6zdJANxmzSfkMRic3sUcrCOErgf22VvxM2a9e0bpKY/KxVazmDxP
Wf+jYhhCeXkSgFcfkMTWipo8zd3qOj2vwsPMIXFSIT82xYRHfokF0MA9QvYHR0Nx
5IfK0q64Q4FJAjGmpd9+FQHQnYVWwlUmT6XZNCfOuL7KR998BKgY0yyD2jiq0FRY
glDrBa9fpvCDfR+7Nq3hqIUJw6RAcUbv0XljkaMG1tEs2Lb10MaSZuH9Jh9uxvcu
2wIDAQAB
-----END PUBLIC KEY-----`;

/* ───────────────────── Env (Render → Environment) ─────────────────────
  COMM_APP_SECRET      = Commission app OAuth Client Secret
  KPI_APP_SECRET       = KPI app OAuth Client Secret
  MORTGAGE_APP_SECRET  = Mortgage app OAuth Client Secret
  RESEND_API_KEY       = your Resend API key

  ADMIN_EMAIL          = optional fallback admin inbox
  FROM_EMAIL           = "Clario Apps <wecare@zoldly.com>" or "Clario Apps <wecare@clarioapps.net>"

  CLARIO_SHOWINGS_EMAIL_TOKEN = shared secret to protect /showings/* routes
  (Optional legacy fallback) CLARIO_EMAIL_WEBHOOK_SECRET
----------------------------------------------------------------------- */

const COMM_APP_SECRET = process.env.COMM_APP_SECRET || "";
const KPI_APP_SECRET = process.env.KPI_APP_SECRET || "";
const MORTGAGE_APP_SECRET = process.env.MORTGAGE_APP_SECRET || "";
const SHOWINGS_APP_SECRET = process.env.SHOWINGS_APP_SECRET || "";

/* ───────────────────── Verifier Clients (public key only) ───────────────────── */

const verifierCommission = createClient({
  auth: AppStrategy({ appId: COMM_APP_ID, publicKey: COMM_PUBLIC_KEY }),
  modules: { appInstances },
});

const verifierKpi = createClient({
  auth: AppStrategy({ appId: KPI_APP_ID, publicKey: KPI_PUBLIC_KEY }),
  modules: { appInstances },
});

const verifierMortgage = createClient({
  auth: AppStrategy({ appId: MORTGAGE_APP_ID, publicKey: MORTGAGE_PUBLIC_KEY }),
  modules: { appInstances },
});

const verifierShowings = createClient({
  auth: AppStrategy({ appId: SHOWINGS_APP_ID, publicKey: SHOWINGS_PUBLIC_KEY }),
  modules: { appInstances },
});

/* ───────────────────── Per-event Authed Client Builder ───────────────────── */

function clientForInstance(appId, appSecret, instanceId) {
  return createClient({
    auth: AppStrategy({ appId, appSecret, instanceId }),
    modules: { appInstances, siteProperties },
  });
}

/* ───────────────────── Email Setup (Resend) ───────────────────── */

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "Clario Apps <wecare@clarioapps.net>";

function extractValidEmails(input) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const s = String(input == null ? "" : input);
  const matches = s.match(emailRegex) || [];
  return matches.map((m) => String(m).trim()).filter(Boolean);
}

function normalizeRecipients(to) {
  const raw = [];

  if (Array.isArray(to)) raw.push(...to);
  else if (typeof to === "string") raw.push(to);

  // Defensive fallback to ADMIN_EMAIL like the old server
  if (raw.length === 0 && ADMIN_EMAIL) raw.push(ADMIN_EMAIL);

  let emails = raw
    .flatMap((item) => String(item == null ? "" : item).split(/[;,]/g))
    .flatMap((part) => extractValidEmails(part));

  emails = Array.from(new Set(emails));

  return { raw, emails };
}

function sanitizeFromName(name) {
  return String(name || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmailOnly(fromValue) {
  const v = String(fromValue || "").trim();
  const m = v.match(/<([^>]+)>/);
  if (m && m[1]) return m[1].trim();
  return v;
}

function looksLikeEmail(v) {
  const s = String(v || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sendEmail({ to, subject, html, fromName, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY not set – skipping email.");
    return;
  }
  if (!FROM_EMAIL) {
    console.warn("⚠️ FROM_EMAIL not set – set it in Render environment.");
    return;
  }

  const { raw, emails } = normalizeRecipients(to);

  console.log("📩 sendEmail raw recipients:", raw);
  console.log("📩 sendEmail normalized emails:", emails);

  if (!emails || emails.length === 0) {
    console.warn(
      "⚠️ No valid recipients found (skipping). to=",
      JSON.stringify(to),
      " ADMIN_EMAIL=",
      JSON.stringify(ADMIN_EMAIL)
    );
    return;
  }

  const fromEmailOnly = extractEmailOnly(FROM_EMAIL);
  const finalFromName = sanitizeFromName(fromName) || sanitizeFromName("Clario Apps");
  const finalFrom = `${finalFromName} <${fromEmailOnly}>`;

  const replyToEmail = String(replyTo || "").trim();
  const replyToHeader = looksLikeEmail(replyToEmail) ? replyToEmail : undefined;

  try {
    console.log("🚀 Resend SEND attempt:", {
      to: emails,
      subject,
      from: finalFrom,
      replyTo: replyToHeader || "",
    });

    const result = await resend.emails.send({
      from: finalFrom,
      to: emails,
      subject,
      html,
   ...(replyToHeader ? { reply_to: replyToHeader, replyTo: replyToHeader } : {}),
    });

    if (result && result.error) {
      console.error("❌ Resend error:", result.error);
      return;
    }

    console.log("📧 Email sent:", result);
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

function isoOrNA(v) {
  if (!v) return "N/A";
  try {
    return new Date(v).toISOString();
  } catch {
    return String(v);
  }
}

/* ───────────────────── Fetch Extra Instance Details (existing) ───────────────────── */

async function fetchInstanceDetails(appKey, instanceId) {
  try {
    let appId, appSecret;
if (appKey === "commission") {
  appId = COMM_APP_ID;
  appSecret = COMM_APP_SECRET;
} else if (appKey === "kpi") {
  appId = KPI_APP_ID;
  appSecret = KPI_APP_SECRET;
} else if (appKey === "showings") {
  appId = SHOWINGS_APP_ID;
  appSecret = SHOWINGS_APP_SECRET;
} else {
  appId = MORTGAGE_APP_ID;
  appSecret = MORTGAGE_APP_SECRET;
}

    if (!appSecret) {
      console.warn(`⚠️ ${appKey.toUpperCase()}_APP_SECRET not set – details may be N/A.`);
    }

    const authed = clientForInstance(appId, appSecret, instanceId);

    let ai;
    try {
      ai = await authed.appInstances.getAppInstance({ instanceId });
      console.log(`🔎 getAppInstance (${appKey}) result:`, JSON.stringify(ai, null, 2));
    } catch (e) {
      console.error("❌ getAppInstance failed:", e);
    }

    let sp;
    try {
      sp = await authed.siteProperties.getSiteProperties({
        fields: ["siteDisplayName", "language", "paymentCurrency", "email"],
      });
      console.log(`🔎 getSiteProperties (${appKey}) result:`, JSON.stringify(sp, null, 2));
    } catch (e) {
      console.error("❌ getSiteProperties failed:", e);
    }

    const siteBlock = ai?.site || ai?.appInstance?.site;
    const ownerEmail =
      siteBlock?.ownerInfo?.email || ai?.ownerEmail || ai?.appInstance?.ownerEmail || "N/A";

    const siteId = siteBlock?.metaSiteId || ai?.siteId || ai?.metaSiteId || "N/A";

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

/* ───────────────────── Existing Admin Email Builders ───────────────────── */

async function sendAdminEmail(subject, html) {
  const to = ADMIN_EMAIL ? [ADMIN_EMAIL] : [];
  await sendEmail({ to, subject, html });
}

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

async function handlePaidPlanChanged(event, appLabel, appKey) {
  const p = event.payload || {};
  console.log(`👉 [${appLabel}] Paid plan changed. Instance:`, event.instanceId);

  const extra = await fetchInstanceDetails(appKey, event.instanceId);

  const html = `
    <h1>${appLabel} – Paid Plan Changed</h1>
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
    </ul>
    <h3>Raw Payload</h3>
    <pre style="white-space:pre-wrap;background:#f6f6f7;padding:12px;border-radius:8px;">${escapeHtml(JSON.stringify(p, null, 2))}</pre>
  `;

  await sendAdminEmail(`${appLabel} – Paid Plan Changed`, html);
}
/* ───────────────────── Showing Emails ───────────────────── */

function normalizeLang(_lang) {
  return "en";
}

const EMAIL_COPY = {
  en: {
    subjectNew: "New Showing Request",
    headingNew: "New Showing Request",

    // ✅ NEW (admin waitlist)
    subjectWaitlistNew: "New Waitlist Request",
    headingWaitlistNew: "New Waitlist Request",

    manage: "Manage Showing",
    approve: "Approve",
    decline: "Decline",
    fallbackLinkNote: "If the button doesn’t work, use this link:",
    requestedTime: "Requested Time",
    buyer: "Buyer",
    property: "Property",
    statusLabel: "Status",
    linksExpireNotePrefix: "Manage links expire in",

    subjectReceived: "We received your showing request",
    headingReceived: "Request received",

    // Normal (non-waitlist) copy
    receivedIntro:
      "We received your request to tour the home below. The listing agent will review availability and you’ll receive a confirmation email soon.",
    whatNext: "What happens next",
    next1: "The agent is reviewing availability now.",
    next2: "You’ll receive an email confirming your appointment or requesting a different time.",

    // ✅ Waitlist (LOCKED)
    waitlistIntro:
      "We received your request and added you to the waitlist for the home below. As soon as this property opens for showings, everyone on the waitlist will be notified right away—so you’ll have the first opportunity to book a time.",
    waitlistNext1: "The property isn’t accepting showings yet, so no appointment is scheduled at this time.",
    waitlistNext2: "When showings become available, you’ll get an email to book your preferred day and time.",

    buyerAgentNoteLabel: "Buyer’s Agent",

    // Approved / Not Confirmed
    subjectApproved: "Showing Confirmed",
    subjectDeclined: "Showing Request Not Confirmed",

    headingApproved: "Your showing is confirmed",
    headingDeclined: "Showing Not Confirmed",

    approvedBody: "Your appointment has been confirmed. We look forward to seeing you.",

    rescheduleBtn: "Pick a different time",
    cancelRescheduleLine: "If you need to cancel or reschedule, contact the agent directly.",

    // Labels
    confirmedTimeLabel: "Confirmed Time (Property Time)",
    requestedTimeLabel: "Requested Time (Property Time)",
    agentSectionLabel: "Assigned Agent",
  },
};

function copyForLang(_lang) {
  return EMAIL_COPY.en;
}

function wixImageToPublicUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;

  const m = v.match(/^wix:image:\/\/v1\/([^\/]+)\//i);
  if (m && m[1]) {
    return `https://static.wixstatic.com/media/${m[1]}`;
  }
  return "";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAddress(p) {
  const street = String(p?.street || p?.streetAddress || p?.address || "").trim();
  const city = String(p?.city || "").trim();
  const state = String(p?.state || "").trim();
  const zip = String(p?.zip || p?.postalCode || "").trim();

  const line2 = [city, state].filter(Boolean).join(", ");
  const tail = [line2, zip].filter(Boolean).join(" ");

  return [street, tail].filter(Boolean).join(" • ");
}

function subjectAddressShort(property) {
  const street = String(property?.street || property?.streetAddress || property?.address || "").trim();
  const city = String(property?.city || "").trim();
  if (street && city) return `${street}, ${city}`;
  return street || city || "Property";
}

function localeForLang(_lang) {
  return "en-US";
}

function parseDateSafe(v) {
  try {
    if (!v) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
    return null;
  } catch (_e) {
    return null;
  }
}

function formatInTimeZone(dateValue, timeZone, lang) {
  const d = parseDateSafe(dateValue);
  if (!d) return "";

  const tz = String(timeZone || "").trim() || "America/New_York";
  const locale = localeForLang(lang);

  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(d);
  } catch (_e) {
    return d.toISOString();
  }
}

function safeDisplayTimeOnlyProperty({ showing, timeZone, lang }) {
  const tzFallback =
    String(
      timeZone ||
        showing?.requestedTimeZone ||
        showing?.propertyTimeZoneSnapshot ||
        "America/New_York"
    ).trim() || "America/New_York";

  const displayProperty = String(showing?.requestedStartDisplayProperty || "").trim();
  const displayCombined = String(showing?.requestedStartDisplayCombined || "").trim();
  const displayAlt1 = String(showing?.requestedStartDisplay || "").trim();
  const displayAlt2 = String(showing?.requestedTimeDisplay || "").trim();

  if (displayProperty) return displayProperty;
  if (displayCombined) return displayCombined;
  if (displayAlt1) return displayAlt1;
  if (displayAlt2) return displayAlt2;

  const whenText = formatInTimeZone(
    showing?.requestedStart ||
      showing?.requestedStartUtc ||
      showing?.requestedDateTime ||
      showing?.requestedDateTimeUtc ||
      showing?.slotStart ||
      showing?.start ||
      showing?.startTime ||
      showing?.dateTime ||
      showing?.requested_start ||
      showing?.requested_start_utc,
    tzFallback,
    lang
  );

  return whenText || "—";
}

function primaryButton(url, label) {
  if (!url) return "";
  return `
    <a href="${escapeHtml(url)}"
       style="display:inline-block;text-decoration:none;padding:12px 16px;border-radius:10px;background:#0b5cff;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">
      ${escapeHtml(label)}
    </a>`;
}

function secondaryButton(url, label) {
  if (!url) return "";
  return `
    <a href="${escapeHtml(url)}"
       style="display:inline-block;text-decoration:none;padding:12px 16px;border-radius:10px;background:#ffffff;border:1px solid #d1d5db;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">
      ${escapeHtml(label)}
    </a>`;
}

function infoPill(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  return `
    <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#1e3a8a;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">
      ${escapeHtml(t)}
    </span>
  `.trim();
}

function supportTopicLabel(topicValue, topicLabel) {
  const direct = String(topicLabel || "").trim();
  if (direct) return direct;

  const v = String(topicValue || "").trim().toLowerCase();

  const map = {
    billing: "Billing and Upgrades",
    technical: "Technical Support",
    feature: "Feature Request",
    other: "Other",
  };

  return map[v] || (v ? (v.charAt(0).toUpperCase() + v.slice(1)) : "Support");
}

function emailShell({ brandLine, heading, imgBlock, sectionsHtml, footerHtml, showingId }) {
  return `
  <div style="background:#f6f6f7;padding:8px;">
    <div style="width:100%;max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.06);box-sizing:border-box;">
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;">
        ${brandLine ? `<div style="font-size:13px;color:#555;margin-bottom:10px;">${escapeHtml(brandLine)}</div>` : ""}
        <h1 style="margin:0 0 14px 0;font-size:22px;line-height:1.25;">${escapeHtml(heading)}</h1>

        ${imgBlock || ""}

        ${sectionsHtml || ""}

        ${footerHtml || ""}

        ${showingId ? `<div style="font-size:12px;color:#999;margin-top:16px;">Showing ID: ${escapeHtml(showingId)}</div>` : ""}
      </div>
    </div>
  </div>
  `.trim();
}

function buildSupportAdminEmailHtml({ brokerageName, request, siteBaseUrl }) {
  const brandLine = "";   
  const reqId = String(request?.requestId || request?.id || "").trim();
  const fullName = `${String(request?.firstName || "").trim()} ${String(request?.lastName || "").trim()}`.trim();
  const email = String(request?.email || "").trim();
  const siteUrl = String(request?.siteUrl || "").trim();
  const topic = String(request?.topic || "").trim();
  const topicLabel = String(request?.topicLabel || "").trim();
  const topicDisplay = supportTopicLabel(topic, topicLabel);
  const desc = String(request?.description || "").trim();

  const attachments = Array.isArray(request?.attachments) ? request.attachments : [];
  const attachmentsHtml =
    attachments.length
      ? `<ul style="margin:0;padding-left:18px;">${
          attachments
            .map((a) => {
              const name = escapeHtml(String(a?.name || "Attachment"));
              const url = escapeHtml(String(a?.url || ""));
              if (!url) return "";
              return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
            })
            .filter(Boolean)
            .join("")
        }</ul>`
      : `<div style="color:#666;font-size:13px;">None</div>`;

  const sections = `
    ${reqId ? `<div style="margin:0 0 14px 0;">${infoPill(`Request ID: ${reqId}`)}</div>` : ""}

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Requester</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(fullName || "—")}</div>
        ${email ? `<div><a href="mailto:${escapeHtml(email)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(email)}</a></div>` : ""}
        ${siteUrl ? `<div>Site: <a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0b5cff;text-decoration:none;">${escapeHtml(siteUrl)}</a></div>` : ""}
      </div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Topic</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(topicDisplay || "—")}</div>
</div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Description</div>
      <div style="font-size:14px;line-height:1.6;white-space:pre-line;">${escapeHtml(desc || "—")}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Attachments</div>
      ${attachmentsHtml}
    </div>

    ${siteBaseUrl ? `<div style="font-size:12px;color:#666;">Site Base URL: ${escapeHtml(siteBaseUrl)}</div>` : ""}
  `.trim();

  return emailShell({
    brandLine,
    heading: "New Support Request",
    imgBlock: "",
    sectionsHtml: sections,
    footerHtml: "",
    showingId: "",
  });
}

function buildSupportConfirmationEmailHtml({ brokerageName, request }) {
  const brandLine = "";
   
  const reqId = String(request?.requestId || request?.id || "").trim();
  const firstName = String(request?.firstName || "").trim();
  const greeting = firstName || "there";
  const lastName = String(request?.lastName || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const email = String(request?.email || "").trim();
  const siteUrl = String(request?.siteUrl || "").trim();

  const topic = String(request?.topic || "").trim();
  const topicLabelRaw = String(request?.topicLabel || "").trim();
  const topicDisplay = supportTopicLabel(topic, topicLabelRaw);

  const desc = String(request?.description || "").trim();

  const attachments = Array.isArray(request?.attachments) ? request.attachments : [];
  const attachmentsHtml =
  attachments.length
    ? `<ul style="margin:0;padding-left:18px;">${
        attachments
          .map((a) => {
            const name = escapeHtml(String(a?.name || "Attachment"));
            const url = escapeHtml(String(a?.url || ""));
            if (!url) return "";
            return `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`;
          })
          .filter(Boolean)
          .join("")
      }</ul>`
    : `<div style="color:#666;font-size:13px;">None</div>`;
  const sections = `
  ${reqId ? `<div style="margin:0 0 14px 0;">${infoPill(`Request ID: ${reqId}`)}</div>` : ""}

  <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
    <div>Hi ${escapeHtml(greeting)},</div>
    <div>We received your support request. Our team will review it and reply by email.</div>
    <div style="margin-top:10px;">Here’s a copy of what you submitted:</div>
  </div>

  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
    <div style="font-size:12px;color:#666;margin-bottom:6px;">Your Info</div>
    <div style="font-size:14px;line-height:1.6;">
      <div>${escapeHtml(fullName || "—")}</div>
      ${email ? `<div>${escapeHtml(email)}</div>` : ""}
      ${siteUrl ? `<div>Site: <a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0b5cff;text-decoration:none;">${escapeHtml(siteUrl)}</a></div>` : ""}
    </div>
  </div>

  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
    <div style="font-size:12px;color:#666;margin-bottom:6px;">Topic</div>
    <div style="font-size:14px;line-height:1.4;">${escapeHtml(topicDisplay || "—")}</div>
  </div>

  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
    <div style="font-size:12px;color:#666;margin-bottom:6px;">Description</div>
    <div style="font-size:14px;line-height:1.6;white-space:pre-line;">${escapeHtml(desc || "—")}</div>
  </div>

  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
    <div style="font-size:12px;color:#666;margin-bottom:6px;">Attachments</div>
    ${attachmentsHtml}
  </div>

  <div style="font-size:13px;color:#666;">
    Tip: keep this email for reference${reqId ? ` (Request ID: ${escapeHtml(reqId)})` : ""}.
  </div>
`.trim();

  return emailShell({
    brandLine,
    heading: "Support Request Received",
    imgBlock: "",
    sectionsHtml: sections,
    footerHtml: "",
    showingId: "",
  });
}

/* ───────────────────── Recipient Robustness Helpers ───────────────────── */

function asTrim(v) {
  return String(v == null ? "" : v).trim();
}

function firstEmailFromAny(...vals) {
  for (const v of vals) {
    const s = asTrim(v);
    if (!s) continue;
    const found = extractValidEmails(s);
    if (found && found.length) return found[0];
  }
  return "";
}

function normalizeToList(val) {
  if (Array.isArray(val)) return val.map(asTrim).filter(Boolean);
  const s = asTrim(val);
  if (!s) return [];
  return s.split(/[;,]/g).map(asTrim).filter(Boolean);
}

/* ───────────────────── URL Helpers ───────────────────── */

function normalizeBaseUrl(baseSiteUrl) {
  const base = String(baseSiteUrl || "").trim().replace(/\/+$/g, "");
  if (!base) return "";
  if (/^https?:\/\//i.test(base)) return base;
  return "https://" + base;
}

function absolutizeUrlMaybe(url, baseSiteUrl) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;

  const base = normalizeBaseUrl(baseSiteUrl);
  if (!base) return u;

  if (u.startsWith("/")) return base + u;
  return base + "/" + u;
}

/* ───────────────────── Google Maps + Google Calendar Helpers ───────────────────── */

function googleMapsSearchUrl(addressText) {
  const q = String(addressText || "").trim();
  if (!q) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

function googleCalendarUtcStamp(dateObj) {
  try {
    const iso = dateObj.toISOString(); // e.g. 2026-02-18T15:30:00.000Z
    return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); // 20260218T153000Z
  } catch (_e) {
    return "";
  }
}

function getShowingStartDate(showing) {
  return parseDateSafe(
    showing?.requestedStart ||
      showing?.requestedStartUtc ||
      showing?.requestedDateTime ||
      showing?.requestedDateTimeUtc ||
      showing?.slotStart ||
      showing?.start ||
      showing?.startTime ||
      showing?.dateTime ||
      showing?.requested_start ||
      showing?.requested_start_utc
  );
}

function getShowingDurationMinutes(showing) {
  const candidates = [
    showing?.durationMinutes,
    showing?.slotDurationMinutes,
    showing?.duration,
    showing?.durationMin,
    showing?.minutes,
    showing?.slotMinutes,
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return 30; // safe default
}

function googleCalendarCreateEventUrl({ title, details, location, startDate, endDate }) {
  try {
    const text = String(title || "").trim();
    const det = String(details || "").trim();
    const loc = String(location || "").trim();

    if (!startDate || !(startDate instanceof Date) || isNaN(startDate.getTime())) return "";

    const end =
      (endDate && endDate instanceof Date && !isNaN(endDate.getTime()))
        ? endDate
        : new Date(startDate.getTime() + 30 * 60 * 1000);

    const dates = `${googleCalendarUtcStamp(startDate)}/${googleCalendarUtcStamp(end)}`;
    if (!dates || dates.includes("undefined")) return "";

    const base = "https://calendar.google.com/calendar/render?action=TEMPLATE";
    const q = [
      `text=${encodeURIComponent(text)}`,
      `details=${encodeURIComponent(det)}`,
      `location=${encodeURIComponent(loc)}`,
      `dates=${encodeURIComponent(dates)}`,
    ].join("&");

    return base + "&" + q;
  } catch (_e) {
    return "";
  }
}

/* ───────────── HTML Builders ───────────── */

function buildNewShowingEmailHtml({
  lang,
  brokerageName,
  agentName,
  property,
  buyer,
  showing,
  links,
  timeZone,
  linksExpireDays,
  siteBaseUrl,
}) {
  const c = copyForLang(lang);

  const brandLine = brokerageName || agentName || "Showing Scheduler";

  const addressText = formatAddress(property);
  const mapsUrl = googleMapsSearchUrl(addressText);

  const addressHtml = mapsUrl
    ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0b5cff;text-decoration:none;">${escapeHtml(addressText || "—")}</a>`
    : (addressText || "—");

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const buyerName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ").trim();
  const buyerEmail = buyer?.email || "";
  const buyerPhone = buyer?.phone || "";
  const buyerHasAgentText = String(buyer?.buyerHasAgentText || "").trim();

  const tz =
    String(
      (property && property.timeZone) ||
        (showing && showing.requestedTimeZone) ||
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });
  const statusLabel = String(showing?.statusLabel || "").trim();

  // ✅ NEW: detect waitlist for admin email
  const lowerStatus = String(statusLabel || "").toLowerCase();
  const isWaitlist = lowerStatus.includes("wait") || lowerStatus.includes("coming");

  // ✅ Manage only. Also ensure ABSOLUTE URL.
  const rawManage = String((links && (links.manageUrl || links.managePath)) || "").trim();
  const manageUrl = absolutizeUrlMaybe(rawManage, siteBaseUrl || "");

  const expireDays = Number(linksExpireDays || 0) || 0;
  const expireLine =
    expireDays > 0
      ? `<div style="font-size:12px;color:#666;margin-top:10px;">
           ${escapeHtml(c.linksExpireNotePrefix)} ${escapeHtml(String(expireDays))} ${escapeHtml(expireDays === 1 ? "day" : "days")}.
         </div>`
      : "";

  // ✅ CHANGE: waitlist admin email should NOT show requested time, manage button/link, or expire note
  const requestedTimeBoxHtml = isWaitlist
    ? ""
    : `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.requestedTime)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>
  `.trim();

  // ✅ NEW: Google Calendar button (Agent new request) — only if not waitlist and has a start date
  const startDate = getShowingStartDate(showing);
  const durMin = getShowingDurationMinutes(showing);
  const endDate = startDate ? new Date(startDate.getTime() + durMin * 60 * 1000) : null;

  const calUrl = (!isWaitlist && startDate)
    ? googleCalendarCreateEventUrl({
        title: `Home Showing: ${subjectAddressShort(property)}`,
        details: `Showing request${buyerName ? ` for ${buyerName}` : ""}.`,
        location: addressText,
        startDate,
        endDate,
      })
    : "";

  const calendarBlockHtml = calUrl
    ? `
    <div style="margin:4px 0 14px 0;">
      ${secondaryButton(calUrl, "Add to Google Calendar")}
    </div>
  `.trim()
    : "";

  const manageBlockHtml = isWaitlist
    ? ""
    : `
    <div style="margin:18px 0 8px 0;">
      ${primaryButton(manageUrl, c.manage)}
    </div>

    ${
      manageUrl
        ? `
      <div style="font-size:12px;color:#666;margin-top:10px;">
        ${escapeHtml(c.fallbackLinkNote)}<br/>
        <a href="${escapeHtml(manageUrl)}">${escapeHtml(manageUrl)}</a>
      </div>`
        : ""
    }

    ${expireLine}
  `.trim();

  const sections = `
    ${statusLabel ? `<div style="margin:0 0 14px 0;">${infoPill(`${c.statusLabel}: ${statusLabel}`)}</div>` : ""}

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    ${requestedTimeBoxHtml}

    ${calendarBlockHtml}

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.buyer)}</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(buyerName || "—")}</div>
        ${buyerEmail ? `<div><a href="mailto:${escapeHtml(buyerEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(buyerEmail)}</a></div>` : ""}
        ${buyerPhone ? `<div>${escapeHtml(buyerPhone)}</div>` : ""}
        ${buyerHasAgentText ? `<div style="margin-top:8px;font-size:13px;color:#111;"><strong>${escapeHtml(c.buyerAgentNoteLabel)}:</strong> ${escapeHtml(buyerHasAgentText)}</div>` : ""}
      </div>
    </div>

    ${manageBlockHtml}
  `.trim();

  return emailShell({
    brandLine,
    heading: isWaitlist ? c.headingWaitlistNew : c.headingNew,
    imgBlock,
    sectionsHtml: sections,
    footerHtml: "",
    showingId: showing?.id || "",
  });
}

function capFirst(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function normalizeReasonLabel(reasonLabel) {
  const raw = String(reasonLabel || "").trim();
  const s = raw.toLowerCase();

  if (s.includes("seller") || s.includes("occupant")) return "Seller/Occupant Unavailable";
  if (s.includes("no longer available") || s.includes("that time")) return "That time is no longer available";

  // ✅ NEW: normalize “please choose a different time” / “requested time not available” style reasons
  if (
    s.includes("choose a different time") ||
    s.includes("pick a different time") ||
    s.includes("requested time is not available") ||
    (s.includes("requested") && s.includes("time") && s.includes("not") && s.includes("available"))
  ) {
    return "Your requested time is not available";
  }
  // ✅ NEW: Buyer represented / under agreement
  if (
    s.includes("buyer represented") ||
    s.includes("buyer-represented") ||
    s.includes("represented") ||
    s.includes("under agreement") ||
    s.includes("buyer agreement") ||
    s.includes("representation agreement") ||
    s.includes("broker agreement") ||
    (s.includes("buyer") && s.includes("agreement"))
  ) {
    return "Buyer represented / under agreement";
  }
   
  if (s.includes("offer") || s.includes("under contract") || s.includes("undercontract")) return "Offer accepted / Under contract";
  if (s.includes("temporar")) return "Temporarily unavailable";
  if (s.includes("not available for showing") || s.includes("not available for showings") || (s.includes("not available") && s.includes("show"))) return "Not available for showings";

  return raw;
}

function isRescheduleAllowedByReason(reasonLabel) {
  const normalized = normalizeReasonLabel(reasonLabel);
    return (
    normalized === "Seller/Occupant Unavailable" ||
    normalized === "That time is no longer available" ||
    normalized === "Your requested time is not available" ||
    normalized === "Buyer represented / under agreement" // ✅ NEW
  );
}

function notConfirmedIntroByReason(reasonLabel, greetingName) {
  const normalized = normalizeReasonLabel(reasonLabel);

  if (normalized === "Seller/Occupant Unavailable") {
    return `Hi ${greetingName},\nThanks for your request. The seller/occupant isn’t available at the requested time, so we couldn’t confirm your showing. Please click the button below to request a different time. We apologize for any inconvenience.`;
  }
  if (normalized === "That time is no longer available") {
    return `Hi ${greetingName},\nThanks for your request. The requested time is no longer available, so we couldn’t confirm your showing. Please click the button below to request a different time. We apologize for any inconvenience.`;
  }
  if (normalized === "Your requested time is not available") {
    return `Hi ${greetingName},\nThanks for your request. Your requested time is not available, so we couldn’t confirm your showing. Please click the button below to request a different time. We apologize for any inconvenience.`;
  }
  if (normalized === "Offer accepted / Under contract") {
    return `Hi ${greetingName},\nThanks for your request. This property has recently gone under contract, so we couldn’t confirm a showing. We apologize for any inconvenience.`;
  }
  if (normalized === "Not available for showings") {
    return `Hi ${greetingName},\nThanks for your request. This property isn’t available for showings right now, so we couldn’t confirm your appointment. When the property becomes available again, we will contact you. If you have questions, you may also reach out to the assigned agent below.`;
  }
  if (normalized === "Temporarily unavailable") {
    return `Hi ${greetingName},\nThanks for your request. This property is temporarily unavailable for showings, so we couldn’t confirm your appointment. When the property becomes available again, we will contact you. If you have questions, you may also reach out to the assigned agent below.`;
  }
    // ✅ NEW: Buyer represented / under agreement (reschedule allowed)
  if (normalized === "Buyer represented / under agreement") {
    return `Hi ${greetingName},\nYou indicated you’re currently under a buyer representation agreement with another agent, so we can’t confirm this showing request. Please have your agent request the showing.\n\nIf you selected that by mistake, you can reschedule below and update your answer.`;
  }
  // Fallback if some unknown reason comes through
  return `Hi ${greetingName},\nThanks for your request. We couldn’t confirm your showing.`;
}

function buildBuyerReceivedEmailHtml({
  lang,
  brokerageName,
  agentName,
  property,
  buyer,
  showing,
  timeZone,
  linksExpireDays,
  agent,
}) {
  const c = copyForLang(lang);

  const brandLine = brokerageName || agentName || "Showing Scheduler";
  const addressHtml = formatAddress(property);

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const buyerFirst = String(buyer?.firstName || "").trim();
  const greetingName = buyerFirst || "there";

  const tz =
    String(
      (property && property.timeZone) ||
        (showing && showing.requestedTimeZone) ||
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const statusLabelRaw = String(showing?.statusLabel || "").trim();
  const lowerStatus = String(statusLabelRaw || "").toLowerCase();
  const isWaitlist = lowerStatus.includes("wait") || lowerStatus.includes("coming");

  const buyerHasAgentText = String(buyer?.buyerHasAgentText || "").trim();

  const agentNameText = String(agentName || "").trim() || String(agent?.name || "").trim();
  const agentPhone = String(agent?.phone || "").trim();
  const agentEmail = String(agent?.email || "").trim();

  const agentContactBlock =
    (agentNameText || agentPhone || agentEmail)
      ? `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.agentSectionLabel)}</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(agentNameText || "Agent")}</div>
        ${agentPhone ? `<div>${escapeHtml(agentPhone)}</div>` : ""}
        ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a></div>` : ""}
      </div>
    </div>
  `.trim()
      : "";

  // ✅ CHANGE: buyer emails should NOT show manage-link expiry note.
  const expireLine = "";

  const introText = isWaitlist ? c.waitlistIntro : c.receivedIntro;
  const next1 = isWaitlist ? c.waitlistNext1 : c.next1;
  const next2 = isWaitlist ? c.waitlistNext2 : c.next2;

  // ✅ CHANGE: waitlist emails should NOT show a requested time block (no appointment scheduled).
  const requestedTimeBoxHtml = isWaitlist
    ? ""
    : `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.requestedTime)} (Property Time)</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>
  `.trim();

  const sections = `
    ${statusLabelRaw ? `<div style="margin:0 0 14px 0;">${infoPill(`${c.statusLabel}: ${statusLabelRaw}`)}</div>` : ""}

    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(introText)}</div>
      ${buyerHasAgentText ? `<div style="margin-top:10px;"><strong>${escapeHtml(c.buyerAgentNoteLabel)}:</strong> ${escapeHtml(buyerHasAgentText)}</div>` : ""}
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    ${requestedTimeBoxHtml}

    ${agentContactBlock ? agentContactBlock : ""}

    <div style="margin-top:10px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${escapeHtml(c.whatNext)}</div>
      <ul style="margin:0;padding-left:18px;color:#111;font-size:14px;line-height:1.6;">
        <li>${escapeHtml(next1)}</li>
        <li>${escapeHtml(next2)}</li>
      </ul>
    </div>

    ${expireLine}
  `.trim();

  return emailShell({
    brandLine,
    heading: c.headingReceived,
    imgBlock,
    sectionsHtml: sections,
    footerHtml: "",
    showingId: showing?.id || "",
  });
}

function buildBuyerStatusEmailHtml({
  lang,
  brokerageName,
  agentName,
  property,
  buyer,
  showing,
  status,
  declineReasonLabel,
  timeZone,
  links,
  agent,
  linksExpireDays,
}) {
  const c = copyForLang(lang);

  const brandLine = brokerageName || agentName || "Showing Scheduler";

  const addressText = formatAddress(property);
  const mapsUrl = googleMapsSearchUrl(addressText);

  const addressHtml = mapsUrl
    ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0b5cff;text-decoration:none;">${escapeHtml(addressText || "—")}</a>`
    : (addressText || "—");

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const buyerFirst = String(buyer?.firstName || "").trim();
  const greetingName = buyerFirst || "there";

  const tz =
    String(
      (property && property.timeZone) ||
        (showing && showing.requestedTimeZone) ||
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const statusNorm = capFirst(status);
  const isApproved = statusNorm === "Approved";

  // Approved stays as-is (existing behavior), Not Confirmed uses locked layout/copy.
  const heading = isApproved ? c.headingApproved : c.headingDeclined;

  const schedulerUrlRaw = String((links && links.schedulerUrl) || "").trim();
  const schedulerUrl = schedulerUrlRaw; // keep as-is (do not alter URL logic)

  const agentPhone = String(agent?.phone || "").trim();
  const agentEmail = String(agent?.email || "").trim();
  const agentNameText = String(agentName || "").trim() || String(agent?.name || "").trim();

  const hasAgentContact = !!(agentNameText || agentPhone || agentEmail);

  const agentContactBlock =
    hasAgentContact
      ? `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.agentSectionLabel)}</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(agentNameText || "Agent")}</div>
        ${agentPhone ? `<div>${escapeHtml(agentPhone)}</div>` : ""}
        ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a></div>` : ""}
      </div>
    </div>
  `.trim()
      : "";

  // ✅ CHANGE: buyer emails should NOT show manage-link expiry note.
  const expireLine = "";

  // Status pill rule:
  // - Approved: keep showing.statusLabel if present
  // - Not Confirmed: show REASON (not "Declined")
  const statusLabelRaw = String(showing?.statusLabel || "").trim();
  const reasonNormalized = normalizeReasonLabel(declineReasonLabel);
  const pillText = isApproved ? statusLabelRaw : (reasonNormalized || "");

  // Reschedule rule:
  // only for Seller/Occupant Unavailable and That time is no longer available
  const rescheduleAllowed = !isApproved && isRescheduleAllowedByReason(reasonNormalized);

  const introText = isApproved
    ? `Hi ${greetingName},\n${c.approvedBody}`
    : notConfirmedIntroByReason(reasonNormalized, greetingName);

    const rescheduleBtnLabel =
    (!isApproved && reasonNormalized === "Buyer represented / under agreement")
      ? "Reschedule"
      : c.rescheduleBtn;

  const rescheduleBlock =
    (!isApproved && rescheduleAllowed && schedulerUrl)
      ? `<div style="margin:12px 0 14px 0;">${primaryButton(schedulerUrl, rescheduleBtnLabel)}</div>`
      : "";

  // Info boxes rule:
  // - Property box always
  // - Time box only when reschedule is allowed (Not Confirmed)
  // - Approved keeps confirmed time box
  const timeBoxHtml = isApproved
    ? `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.confirmedTimeLabel)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>
  `.trim()
    : (rescheduleAllowed
        ? `
    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.requestedTimeLabel)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>
  `.trim()
        : "");

  // ✅ NEW: Google Calendar button (Buyer Approved only)
  const startDate = getShowingStartDate(showing);
  const durMin = getShowingDurationMinutes(showing);
  const endDate = startDate ? new Date(startDate.getTime() + durMin * 60 * 1000) : null;

  const calUrl = (isApproved && startDate)
    ? googleCalendarCreateEventUrl({
        title: `Home Showing: ${subjectAddressShort(property)}`,
        details: `Showing confirmed for ${greetingName}.`,
        location: addressText,
        startDate,
        endDate,
      })
    : "";

  const calendarBlockHtml = calUrl
    ? `
    <div style="margin:6px 0 14px 0;">
      ${secondaryButton(calUrl, "Add to Google Calendar")}
    </div>
  `.trim()
    : "";

  const sections = `
    ${pillText ? `<div style="margin:0 0 14px 0;">${infoPill(pillText)}</div>` : ""}

    <div style="font-size:14px;line-height:1.6;margin-bottom:12px;white-space:pre-line;">
      ${escapeHtml(introText)}
    </div>

    ${rescheduleBlock}

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    ${timeBoxHtml}

    ${calendarBlockHtml}

    ${agentContactBlock ? agentContactBlock : ""}

    ${
      isApproved
        ? `
      <div style="margin-top:4px;font-size:13px;color:#111;">
        ${escapeHtml(c.cancelRescheduleLine)}
      </div>`
        : ""
    }

    ${expireLine}
  `.trim();

  return emailShell({
    brandLine,
    heading,
    imgBlock,
    sectionsHtml: sections,
    footerHtml: "",
    showingId: showing?.id || "",
  });
}

/* ───────────────────── Protected endpoints from Wix backend ───────────────────── */

function isAuthorized(req) {
  const expectedEnv =
    process.env.CLARIO_SHOWINGS_EMAIL_TOKEN ||
    process.env.CLARIO_EMAIL_WEBHOOK_SECRET ||
    "";

  const LEGACY_TRIGGER_TOKEN = "cLaRIo134679LLcAppS2025ClAriOaPPs";

  const got = String(req.headers["x-clario-secret"] || "");
  const ok =
    (!!expectedEnv && got === String(expectedEnv)) ||
    (!!LEGACY_TRIGGER_TOKEN && got === String(LEGACY_TRIGGER_TOKEN));

  try {
    console.log("[ShowingsAuth] CHECK", {
      ok,
      expectedEnvSet: !!expectedEnv,
      expectedEnvPrefix: expectedEnv ? String(expectedEnv).slice(0, 6) + "..." : "",
      legacyEnabled: !!LEGACY_TRIGGER_TOKEN,
      gotPrefix: got ? String(got).slice(0, 6) + "..." : "",
      path: req.path,
      reqId: req.headers["x-clario-reqid"] || "",
    });
  } catch (_e) {}

  return ok;
}

/* ───────────────────── /showings/new-request ───────────────────── */

app.post("/showings/new-request", async (req, res) => {
  try {
    console.log("[ShowingsRoute] HANDLER START /showings/new-request", {
      reqId: req.headers["x-clario-reqid"] || "",
    });

    if (!isAuthorized(req)) {
      console.log("[ShowingsRoute] UNAUTHORIZED /showings/new-request", {
        reqId: req.headers["x-clario-reqid"] || "",
      });
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};

    const lang = normalizeLang(body.language);
    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};
    const links = body.links || {};

    const linksExpireDays = body.linksExpireDays || body.links_expire_days || 0;

    const timeZone =
      body.timeZone || property.timeZone || showing.requestedTimeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

    const siteBaseUrl = body.siteBaseUrl || body.baseSiteUrl || "";

    let to = normalizeToList(body.to);

    const agentEmailFallback = firstEmailFromAny(
      body?.agent?.email,
      body.agentEmail,
      body.agent_email,
      body?.agent?.assignedAgentEmail,
      body?.agent?.assignedAgentEmailSnapshot
    );

    if (to.length === 0 && agentEmailFallback) to = [agentEmailFallback];
    if (to.length === 0 && ADMIN_EMAIL) to = [ADMIN_EMAIL];

    const c = copyForLang(lang);

    // ✅ CHANGE: if waitlist, subject should be "New Waitlist Request"
    const statusLabelRaw = String(showing?.statusLabel || "").trim();
    const lowerStatus = String(statusLabelRaw || "").toLowerCase();
    const isWaitlist = lowerStatus.includes("wait") || lowerStatus.includes("coming");

    const subjectBase = isWaitlist ? c.subjectWaitlistNew : c.subjectNew;
    const subject = `${subjectBase} — ${subjectAddressShort(property)}`;

    const html = buildNewShowingEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      links,
      timeZone,
      linksExpireDays,
      siteBaseUrl,
    });

    const replyTo = String((body.agent && body.agent.email) || body.agentEmail || body.agent_email || "").trim();
    const fromName = brokerageName || agentName || "Showing Scheduler";

    const rawManage = String((links && (links.manageUrl || links.managePath)) || "").trim();
    const finalManage = absolutizeUrlMaybe(rawManage, siteBaseUrl || "");

    console.log("[ShowingsRoute] /showings/new-request computed", {
      to,
      replyTo: replyTo || "",
      requestedText: safeDisplayTimeOnlyProperty({ showing, timeZone, lang }),
      siteBaseUrl: siteBaseUrl || "",
      rawManageUrl: rawManage,
      manageUrlFinal: finalManage,
      isWaitlist,
      statusLabel: statusLabelRaw,
    });

    await sendEmail({ to, subject, html, fromName, replyTo });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/new-request failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── /showings/buyer-status ───────────────────── */

app.post("/showings/buyer-status", async (req, res) => {
  try {
    console.log("[ShowingsRoute] HANDLER START /showings/buyer-status", {
      reqId: req.headers["x-clario-reqid"] || "",
    });

    if (!isAuthorized(req)) {
      console.log("[ShowingsRoute] UNAUTHORIZED /showings/buyer-status", {
        reqId: req.headers["x-clario-reqid"] || "",
      });
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};

    const lang = normalizeLang(body.language);
    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};
    const links = body.links || {};
    const agent = body.agent || {};

    const linksExpireDays = body.linksExpireDays || body.links_expire_days || 0;

    const status = body.status || body.showingStatus || "";
    const declineReasonLabel =
      body.declineReasonLabel || (body.declineReason && body.declineReason.label) || "";

    const timeZone =
      body.timeZone || property.timeZone || showing.requestedTimeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

    const buyerEmail = firstEmailFromAny(
      buyer?.email,
      body?.buyerEmail,
      body?.buyer_email,
      body?.email,
      body?.leadEmail
    );

    const to = buyerEmail ? [buyerEmail] : [];

    const c = copyForLang(lang);
    const statusNorm = capFirst(status);
    const isApproved = statusNorm === "Approved";

    const subjectBase = isApproved ? c.subjectApproved : c.subjectDeclined;
    const subject = `${subjectBase} — ${subjectAddressShort(property)}`;

    const html = buildBuyerStatusEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      status: statusNorm,
      declineReasonLabel,
      timeZone,
      links,
      agent,
      linksExpireDays,
    });

    const replyTo = String(agent?.email || body.agentEmail || body.agent_email || "").trim();
    const fromName = brokerageName || agentName || "Showing Scheduler";

    console.log("[ShowingsRoute] /showings/buyer-status computed", {
      to,
      replyTo: replyTo || "",
      status: statusNorm,
      requestedText: safeDisplayTimeOnlyProperty({ showing, timeZone, lang }),
    });

    await sendEmail({ to, subject, html, fromName, replyTo });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-status failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── /showings/buyer-received ───────────────────── */

app.post("/showings/buyer-received", async (req, res) => {
  try {
    console.log("[ShowingsRoute] HANDLER START /showings/buyer-received", {
      reqId: req.headers["x-clario-reqid"] || "",
    });

    if (!isAuthorized(req)) {
      console.log("[ShowingsRoute] UNAUTHORIZED /showings/buyer-received", {
        reqId: req.headers["x-clario-reqid"] || "",
      });
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};

    const lang = normalizeLang(body.language);
    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};
    const agent = body.agent || {};

    const linksExpireDays = body.linksExpireDays || body.links_expire_days || 0;

    const timeZone =
      body.timeZone || property.timeZone || showing.requestedTimeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

    const buyerEmail = firstEmailFromAny(
      buyer?.email,
      body?.buyerEmail,
      body?.buyer_email,
      body?.email,
      body?.leadEmail
    );

    const to = buyerEmail ? [buyerEmail] : [];

    const c = copyForLang(lang);
    const subject = `${c.subjectReceived} — ${subjectAddressShort(property)}`;

    const html = buildBuyerReceivedEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
      linksExpireDays,
      agent,
    });

    const replyTo = String((agent && agent.email) || (body.agent && body.agent.email) || body.agentEmail || body.agent_email || "").trim();
    const fromName = brokerageName || agentName || "Showing Scheduler";

    console.log("[ShowingsRoute] /showings/buyer-received computed", {
      to,
      replyTo: replyTo || "",
      requestedText: safeDisplayTimeOnlyProperty({ showing, timeZone, lang }),
      agentEmail: String(agent?.email || "").trim(),
      agentPhone: String(agent?.phone || "").trim(),
    });

    await sendEmail({ to, subject, html, fromName, replyTo });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-received failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── /support/request ───────────────────── */

app.post("/support/request", async (req, res) => {
  try {
    console.log("[SupportRoute] HANDLER START /support/request", {
      reqId: req.headers["x-clario-reqid"] || "",
    });

    if (!isAuthorized(req)) {
      console.log("[SupportRoute] UNAUTHORIZED /support/request", {
        reqId: req.headers["x-clario-reqid"] || "",
      });
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};
    const brokerageName = body.brokerageName || "Clario Apps Support";
    const siteBaseUrl = body.siteBaseUrl || body.baseSiteUrl || "";

    // Expected from Wix backend:
    // body.to = support inbox list
    // body.replyTo = requester's email
    // body.request = { firstName,lastName,email,siteUrl,topic,topicLabel,description,attachments,requestId }

    const request = body.request || {};
    const requesterEmail = firstEmailFromAny(
      request?.email,
      body.replyTo,
      body.email
    );

    let supportTo = normalizeToList(body.to);
    if (supportTo.length === 0 && ADMIN_EMAIL) supportTo = [ADMIN_EMAIL];

    // Hard checks (fail fast)
    if (supportTo.length === 0) return res.status(400).send("missing support recipient");
    if (!requesterEmail) return res.status(400).send("missing requester email");

    const topicLabel = supportTopicLabel(request?.topic, request?.topicLabel);
    const siteUrl = String(request?.siteUrl || "").trim();
    const reqId = String(request?.requestId || "").trim();

    const subjectAdmin =
      `Support Request${reqId ? ` (${reqId})` : ""} — ${topicLabel}${siteUrl ? ` — ${siteUrl}` : ""}`;

    const htmlAdmin = buildSupportAdminEmailHtml({
      brokerageName,
      request,
      siteBaseUrl,
    });

    // IMPORTANT: replyTo should be the requester so you can reply directly from your inbox
    const replyTo = requesterEmail;
    const fromName = "Clario Apps";
     
    console.log("[SupportRoute] sending ADMIN email", {
      to: supportTo,
      replyTo,
      topicLabel,
      hasReqId: !!reqId,
    });

    await sendEmail({
      to: supportTo,
      subject: subjectAdmin,
      html: htmlAdmin,
      fromName,
      replyTo,
    });

    // Confirmation email to the requester
    const subjectUser =
      `We received your support request${reqId ? ` (${reqId})` : ""}`;

    const htmlUser = buildSupportConfirmationEmailHtml({
      brokerageName,
      request,
    });

    console.log("[SupportRoute] sending USER confirmation email", {
      to: [requesterEmail],
      hasReqId: !!reqId,
    });

    await sendEmail({
      to: [requesterEmail],
      subject: subjectUser,
      html: htmlUser,
      fromName: "Clario Apps",
      replyTo: (supportTo && supportTo.length ? supportTo[0] : ADMIN_EMAIL),
    });

    // Return JSON (safe even if Wix backend reads as text)
    return res.status(200).json({ ok: true, requestId: reqId || "" });
  } catch (err) {
    console.error("❌ /support/request failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── Webhooks ───────────────────── */

app.post("/webhook", async (req, res) => {
  console.log("===== [Commission Calculator] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierCommission.webhooks.process(req.body);
    console.log("Decoded event (Commission):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Commission Calculator";
    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event, appLabel, "commission");
        break;
      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appLabel, "commission");
        break;
      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appLabel, "commission");
        break;
      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appLabel, "commission");
        break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appLabel, "commission");
        break;
      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appLabel, "commission");
        break;
      case "AppRemoved":
        await handleAppRemoved(event, appLabel, "commission");
        break;
      default:
        console.log("[Commission] Unhandled event type:", event.eventType);
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
      case "AppInstalled":
        await handleAppInstalled(event, appLabel, "kpi");
        break;
      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appLabel, "kpi");
        break;
      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appLabel, "kpi");
        break;
      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appLabel, "kpi");
        break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appLabel, "kpi");
        break;
      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appLabel, "kpi");
        break;
      case "AppRemoved":
        await handleAppRemoved(event, appLabel, "kpi");
        break;
      default:
        console.log("[KPI] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[KPI] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

app.post("/webhook-mortgage", async (req, res) => {
  console.log("===== [Mortgage] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierMortgage.webhooks.process(req.body);
    console.log("Decoded event (Mortgage):", JSON.stringify(event, null, 2));

    const appLabel = "Clario 3-in-1 Mortgage Calculator";
    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event, appLabel, "mortgage");
        break;
      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appLabel, "mortgage");
        break;
      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appLabel, "mortgage");
        break;
      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appLabel, "mortgage");
        break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appLabel, "mortgage");
        break;
      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appLabel, "mortgage");
        break;
      case "AppRemoved":
        await handleAppRemoved(event, appLabel, "mortgage");
        break;
      default:
        console.log("[Mortgage] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[Mortgage] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

app.post("/webhook-showing-scheduler", async (req, res) => {
  console.log("===== [Showing Scheduler] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierShowings.webhooks.process(req.body);
    console.log("Decoded event (Showings):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Showing Scheduler";
    switch (event.eventType) {
      case "AppInstalled":
        await handleAppInstalled(event, appLabel, "showings");
        break;

      case "PaidPlanPurchased":
        await handlePaidPlanPurchased(event, appLabel, "showings");
        break;

      case "PaidPlanChanged":
        await handlePaidPlanChanged(event, appLabel, "showings");
        break;

      case "PaidPlanAutoRenewalCancelled":
        await handlePaidPlanAutoRenewalCancelled(event, appLabel, "showings");
        break;

      case "PaidPlanReactivated":
      case "PlanReactivated":
        await handlePaidPlanReactivated(event, appLabel, "showings");
        break;

      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":
        await handlePaidPlanConvertedToPaid(event, appLabel, "showings");
        break;

      case "PaidPlanTransferred":
      case "PlanTransferred":
        await handlePaidPlanTransferred(event, appLabel, "showings");
        break;

      case "AppRemoved":
        await handleAppRemoved(event, appLabel, "showings");
        break;

      default:
        console.log("[Showings] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[Showings] webhooks.process failed:", err);
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
