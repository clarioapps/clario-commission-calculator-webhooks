import express from "express";
import { createClient, AppStrategy } from "@wix/sdk";
import { appInstances } from "@wix/app-management";
import { siteProperties } from "@wix/business-tools";
import { Resend } from "resend";

const app = express();

/* ───────────────────── Parsers ─────────────────────
   IMPORTANT:
   - Webhook routes need RAW TEXT.
   - Our custom routes need JSON.
*/
app.use(express.json({ limit: "1mb" }));
const rawText = express.text({ type: "*/*" });

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
PASTE_YOUR_MORTGAGE_APP_PUBLIC_KEY_FROM_DEV_CENTER_HERE
-----END PUBLIC KEY-----`;

/* ───────────────────── Env (Render → Environment) ─────────────────────
  COMM_APP_SECRET      = Commission app OAuth Client Secret
  KPI_APP_SECRET       = KPI app OAuth Client Secret
  MORTGAGE_APP_SECRET  = Mortgage app OAuth Client Secret
  RESEND_API_KEY       = your Resend API key

  ADMIN_EMAIL          = optional fallback admin inbox
  FROM_EMAIL           = "Clario Apps <wecare@clarioapps.net>"

  CLARIO_SHOWINGS_EMAIL_TOKEN = shared secret to protect /showings/new-request
  (Optional legacy fallback) CLARIO_EMAIL_WEBHOOK_SECRET
----------------------------------------------------------------------- */

const COMM_APP_SECRET     = process.env.COMM_APP_SECRET     || "";
const KPI_APP_SECRET      = process.env.KPI_APP_SECRET      || "";
const MORTGAGE_APP_SECRET = process.env.MORTGAGE_APP_SECRET || "";

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
const FROM_EMAIL  = process.env.FROM_EMAIL  || "Clario Apps <wecare@clarioapps.net>";

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ RESEND_API_KEY not set – skipping email.");
    return;
  }
  if (!FROM_EMAIL) {
    console.warn("⚠️ FROM_EMAIL not set – set it in Render environment.");
    return;
  }

  // Defensive: if callers forget recipients, fall back to ADMIN_EMAIL when available.
  let recipients = Array.isArray(to) ? to.filter(Boolean) : [];
  if (recipients.length === 0 && ADMIN_EMAIL) recipients = [ADMIN_EMAIL];

  if (!recipients || recipients.length === 0) {
    console.warn("⚠️ No recipients provided and ADMIN_EMAIL not set – skipping email.");
    return;
  }

  try {
    const result = await resend.emails.send({ from: FROM_EMAIL, to: recipients, subject, html });
    console.log("📧 Email sent:", result);
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

function isoOrNA(v) {
  if (!v) return "N/A";
  try { return new Date(v).toISOString(); } catch { return String(v); }
}

/* ───────────────────── Fetch Extra Instance Details (existing) ───────────────────── */

async function fetchInstanceDetails(appKey, instanceId) {
  try {
    let appId, appSecret;
    if (appKey === "commission") {
      appId = COMM_APP_ID; appSecret = COMM_APP_SECRET;
    } else if (appKey === "kpi") {
      appId = KPI_APP_ID; appSecret = KPI_APP_SECRET;
    } else {
      appId = MORTGAGE_APP_ID; appSecret = MORTGAGE_APP_SECRET;
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

/* ───────────────────── NEW: Showing Email (Agent/Admin) ───────────────────── */

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase();
  if (s.startsWith("es")) return "es";
  return "en";
}

const EMAIL_COPY = {
  en: {
    subject: "New Showing Request",
    heading: "New Showing Request",
    buyer: "Buyer",
    property: "Property",
    requested: "Requested",
    approve: "Approve",
    decline: "Decline",
    manage: "Manage",
    fallbackLinkNote: "If the buttons don’t work, use this link:",
  },
  es: {
    subject: "Nueva solicitud de visita",
    heading: "Nueva solicitud de visita",
    buyer: "Comprador",
    property: "Propiedad",
    requested: "Solicitado",
    approve: "Aprobar",
    decline: "Rechazar",
    manage: "Administrar",
    fallbackLinkNote: "Si los botones no funcionan, usa este enlace:",
  },
};

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
  const street = p?.street || "";
  const city = p?.city || "";
  const state = p?.state || "";
  const zip = p?.zip || "";
  const line2 = [city, state].filter(Boolean).join(", ");
  return [street, [line2, zip].filter(Boolean).join(" ")].filter(Boolean).join("<br/>");
}

function buildNewShowingEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, links }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

  const brandLine = escapeHtml(brokerageName || agentName || "Showing Scheduler");
  const addressHtml = formatAddress(property);

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const buyerName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ").trim();
  const buyerEmail = buyer?.email || "";
  const buyerPhone = buyer?.phone || "";

  function localeForLang(lang) {
  if (lang === "es") return "es-ES";
  return "en-US";
}

function formatInTimeZone(dateValue, timeZone, lang) {
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return "";
    const tz = String(timeZone || "").trim() || "America/New_York";
    const locale = localeForLang(lang);

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
    return "";
  }
}
   
  const approveUrl = links?.approveUrl || "";
  const declineUrl = links?.declineUrl || "";
  const manageUrl  = links?.manageUrl  || "";

  const button = (url, label) => {
    if (!url) return "";
    return `
      <a href="${escapeHtml(url)}"
         style="display:inline-block;text-decoration:none;padding:12px 16px;border-radius:10px;border:1px solid #111;color:#111;margin-right:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
        ${escapeHtml(label)}
      </a>`;
  };

  const fallbackUrl = manageUrl || approveUrl || declineUrl || "";

  return `
  <div style="background:#f6f6f7;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;">
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;">
        <div style="font-size:13px;color:#555;margin-bottom:8px;">${brandLine}</div>
        <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.2;">${escapeHtml(c.heading)}</h1>

        ${imgBlock}

        <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
          <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
          <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
        </div>

        <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
          <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.buyer)}</div>
          <div style="font-size:14px;line-height:1.6;">
            <div>${escapeHtml(buyerName || "—")}</div>
            <div>${escapeHtml(buyerEmail || "")}</div>
            <div>${escapeHtml(buyerPhone || "")}</div>
          </div>
        </div>

        ${requested ? `
          <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
            <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.requested)}</div>
            <div style="font-size:14px;line-height:1.4;">${escapeHtml(requested)}</div>
          </div>` : ""}

        <div style="margin:18px 0 8px 0;">
          ${button(approveUrl, c.approve)}
          ${button(declineUrl, c.decline)}
          ${button(manageUrl,  c.manage)}
        </div>

        ${fallbackUrl ? `
          <div style="font-size:12px;color:#666;margin-top:10px;">
            ${escapeHtml(c.fallbackLinkNote)}<br/>
            <a href="${escapeHtml(fallbackUrl)}">${escapeHtml(fallbackUrl)}</a>
          </div>` : ""}

        <div style="font-size:12px;color:#999;margin-top:18px;">
          Showing ID: ${escapeHtml(showing?.id || "")}
        </div>
      </div>
    </div>
  </div>`;
}

// Protected endpoint from Wix backend
app.post("/showings/new-request", async (req, res) => {
  try {
    const expected =
      process.env.CLARIO_SHOWINGS_EMAIL_TOKEN ||
      process.env.CLARIO_EMAIL_WEBHOOK_SECRET ||
      "";

    const got = req.headers["x-clario-secret"] || "";

    if (!expected || String(got) !== String(expected)) {
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

    // Recipients: prefer payload.to; if empty, fallback to ADMIN_EMAIL (if set)
    let to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];
    if (to.length === 0 && ADMIN_EMAIL) to = [ADMIN_EMAIL];

    const subjectBase = (EMAIL_COPY[lang] || EMAIL_COPY.en).subject;
    const subject = brokerageName ? `${subjectBase} — ${brokerageName}` : subjectBase;

    const html = buildNewShowingEmailHtml({
      lang, brokerageName, agentName, property, buyer, showing, links
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/new-request failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── Webhooks ───────────────────── */

app.post("/webhook", rawText, async (req, res) => {
  console.log("===== [Commission Calculator] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierCommission.webhooks.process(req.body);
    console.log("Decoded event (Commission):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Commission Calculator";
    switch (event.eventType) {
      case "AppInstalled":                 await handleAppInstalled(event, appLabel, "commission"); break;
      case "PaidPlanPurchased":            await handlePaidPlanPurchased(event, appLabel, "commission"); break;
      case "PaidPlanAutoRenewalCancelled": await handlePaidPlanAutoRenewalCancelled(event, appLabel, "commission"); break;
      case "PaidPlanReactivated":
      case "PlanReactivated":              await handlePaidPlanReactivated(event, appLabel, "commission"); break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":          await handlePaidPlanConvertedToPaid(event, appLabel, "commission"); break;
      case "PaidPlanTransferred":
      case "PlanTransferred":              await handlePaidPlanTransferred(event, appLabel, "commission"); break;
      case "AppRemoved":                   await handleAppRemoved(event, appLabel, "commission"); break;
      default: console.log("[Commission] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[Commission] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

app.post("/webhook-kpi", rawText, async (req, res) => {
  console.log("===== [Transactions KPI] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierKpi.webhooks.process(req.body);
    console.log("Decoded event (KPI):", JSON.stringify(event, null, 2));

    const appLabel = "Clario Transactions KPI";
    switch (event.eventType) {
      case "AppInstalled":                 await handleAppInstalled(event, appLabel, "kpi"); break;
      case "PaidPlanPurchased":            await handlePaidPlanPurchased(event, appLabel, "kpi"); break;
      case "PaidPlanAutoRenewalCancelled": await handlePaidPlanAutoRenewalCancelled(event, appLabel, "kpi"); break;
      case "PaidPlanReactivated":
      case "PlanReactivated":              await handlePaidPlanReactivated(event, appLabel, "kpi"); break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":          await handlePaidPlanConvertedToPaid(event, appLabel, "kpi"); break;
      case "PaidPlanTransferred":
      case "PlanTransferred":              await handlePaidPlanTransferred(event, appLabel, "kpi"); break;
      case "AppRemoved":                   await handleAppRemoved(event, appLabel, "kpi"); break;
      default: console.log("[KPI] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[KPI] webhooks.process failed:", err);
  }

  res.status(200).send("ok");
});

app.post("/webhook-mortgage", rawText, async (req, res) => {
  console.log("===== [Mortgage] Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    const event = await verifierMortgage.webhooks.process(req.body);
    console.log("Decoded event (Mortgage):", JSON.stringify(event, null, 2));

    const appLabel = "Clario 3-in-1 Mortgage Calculator";
    switch (event.eventType) {
      case "AppInstalled":                 await handleAppInstalled(event, appLabel, "mortgage"); break;
      case "PaidPlanPurchased":            await handlePaidPlanPurchased(event, appLabel, "mortgage"); break;
      case "PaidPlanAutoRenewalCancelled": await handlePaidPlanAutoRenewalCancelled(event, appLabel, "mortgage"); break;
      case "PaidPlanReactivated":
      case "PlanReactivated":              await handlePaidPlanReactivated(event, appLabel, "mortgage"); break;
      case "PaidPlanConvertedToPaid":
      case "PlanConvertedToPaid":          await handlePaidPlanConvertedToPaid(event, appLabel, "mortgage"); break;
      case "PaidPlanTransferred":
      case "PlanTransferred":              await handlePaidPlanTransferred(event, appLabel, "mortgage"); break;
      case "AppRemoved":                   await handleAppRemoved(event, appLabel, "mortgage"); break;
      default: console.log("[Mortgage] Unhandled event type:", event.eventType);
    }
  } catch (err) {
    console.error("[Mortgage] webhooks.process failed:", err);
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
