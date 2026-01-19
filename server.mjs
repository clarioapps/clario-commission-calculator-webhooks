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
    req.path === "/webhook-mortgage"
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
      ...(replyToHeader ? { reply_to: replyToHeader } : {}),
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

/* ───────────────────── Showing Emails ───────────────────── */

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  if (s.startsWith("es")) return "es";
  if (s.startsWith("fr")) return "fr";
  if (s.startsWith("de")) return "de";
  if (s.startsWith("pt")) return "pt";
  return "en";
}

const EMAIL_COPY = {
  en: {
    subjectNew: "New Showing Request",
    headingNew: "New Showing Request",
    manage: "Manage Showing",
    fallbackLinkNote: "If the button doesn’t work, use this link:",
    requestedTime: "Requested Time",
    buyer: "Buyer",
    property: "Property",
    statusLabel: "Status",
    linksExpireNotePrefix: "Manage links expire in",

    subjectReceived: "We received your showing request",
    headingReceived: "Request received",
    receivedIntro:
      "We received your request to tour the home below. The listing agent will review availability and you’ll receive a confirmation email soon.",
    whatNext: "What happens next",
    next1: "The agent is reviewing availability now.",
    next2: "You’ll receive an email confirming your appointment or requesting a different time.",
    buyerAgentNoteLabel: "Buyer’s Agent",
    waitlistNote:
      "This home may not be accepting showings yet. If so, we’ll notify you as soon as showings are available.",

    subjectApproved: "Showing Confirmed",
    subjectDeclined: "Showing Request Declined",
    headingApproved: "Your showing is confirmed",
    headingDeclined: "Your request was declined",
    reasonLabel: "Reason",
    approvedBody: "Your appointment has been confirmed. We look forward to seeing you.",
    declinedBody: "Unfortunately, the requested time is not available.",
    rescheduleBtn: "Pick a different time",
    contactLinePrefix: "Need help?",
    cancelRescheduleLine: "If you need to cancel or reschedule, contact the agent directly.",
    confirmedTimeLabel: "Confirmed Time (Property Time)",
  },
  es: {
    subjectNew: "Nueva solicitud de visita",
    headingNew: "Nueva solicitud de visita",
    manage: "Administrar visita",
    fallbackLinkNote: "Si el botón no funciona, usa este enlace:",
    requestedTime: "Hora solicitada",
    buyer: "Comprador",
    property: "Propiedad",
    statusLabel: "Estado",
    linksExpireNotePrefix: "Los enlaces de gestión expiran en",

    subjectReceived: "Recibimos tu solicitud de visita",
    headingReceived: "Solicitud recibida",
    receivedIntro:
      "Recibimos tu solicitud para visitar la propiedad. El agente revisará la disponibilidad y pronto recibirás un correo de confirmación.",
    whatNext: "¿Qué sigue?",
    next1: "El agente está revisando la disponibilidad.",
    next2: "Recibirás un correo confirmando tu cita o solicitando otra hora.",
    buyerAgentNoteLabel: "Agente del comprador",
    waitlistNote:
      "Es posible que esta propiedad aún no esté aceptando visitas. Si es así, te avisaremos cuando haya visitas disponibles.",

    subjectApproved: "Visita confirmada",
    subjectDeclined: "Solicitud rechazada",
    headingApproved: "Tu visita está confirmada",
    headingDeclined: "Tu solicitud fue rechazada",
    reasonLabel: "Motivo",
    approvedBody: "Tu cita ha sido confirmada.",
    declinedBody: "Lamentablemente, la hora solicitada no está disponible.",
    rescheduleBtn: "Elegir otra hora",
    contactLinePrefix: "¿Necesitas ayuda?",
    cancelRescheduleLine: "Si necesitas cancelar o reprogramar, contacta al agente.",
    confirmedTimeLabel: "Hora confirmada (hora de la propiedad)",
  },
  fr: {},
  de: {},
  pt: {},
};

function copyForLang(lang) {
  const key = normalizeLang(lang);
  const base = EMAIL_COPY.en;
  const specific = EMAIL_COPY[key] || {};
  return { ...base, ...specific };
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

function localeForLang(lang) {
  const s = String(lang || "").toLowerCase();
  if (s.startsWith("es")) return "es-ES";
  if (s.startsWith("fr")) return "fr-FR";
  if (s.startsWith("de")) return "de-DE";
  if (s.startsWith("pt")) return "pt-PT";
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
    String(timeZone || showing?.propertyTimeZoneSnapshot || "America/New_York").trim() ||
    "America/New_York";

  const displayProperty = String(showing?.requestedStartDisplayProperty || "").trim();
  const displayCombined = String(showing?.requestedStartDisplayCombined || "").trim();

  if (displayProperty) return displayProperty;
  if (displayCombined) return displayCombined;

  const whenText = formatInTimeZone(
    showing?.requestedStart ||
      showing?.requestedStartUtc ||
      showing?.slotStart ||
      showing?.start ||
      showing?.startTime ||
      showing?.dateTime,
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

function infoPill(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  return `
    <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#1e3a8a;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">
      ${escapeHtml(t)}
    </span>
  `.trim();
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
}) {
  const c = copyForLang(lang);

  const brandLine = brokerageName || agentName || "Showing Scheduler";
  const addressHtml = formatAddress(property);

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
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });
  const statusLabel = String(showing?.statusLabel || "").trim();

  const manageUrl = String((links && links.manageUrl) || "").trim();
  const fallbackUrl = manageUrl || "";

  const expireDays = Number(linksExpireDays || 0) || 0;
  const expireLine =
    expireDays > 0
      ? `<div style="font-size:12px;color:#666;margin-top:10px;">
           ${escapeHtml(c.linksExpireNotePrefix)} ${escapeHtml(String(expireDays))} ${escapeHtml(expireDays === 1 ? "day" : "days")}.
         </div>`
      : "";

  const sections = `
    ${statusLabel ? `<div style="margin:0 0 14px 0;">${infoPill(`${c.statusLabel}: ${statusLabel}`)}</div>` : ""}

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.requestedTime)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.buyer)}</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(buyerName || "—")}</div>
        ${buyerEmail ? `<div><a href="mailto:${escapeHtml(buyerEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(buyerEmail)}</a></div>` : ""}
        ${buyerPhone ? `<div>${escapeHtml(buyerPhone)}</div>` : ""}
        ${buyerHasAgentText ? `<div style="margin-top:8px;font-size:13px;color:#111;"><strong>${escapeHtml(c.buyerAgentNoteLabel)}:</strong> ${escapeHtml(buyerHasAgentText)}</div>` : ""}
      </div>
    </div>

    <div style="margin:18px 0 8px 0;">
      ${primaryButton(manageUrl, c.manage)}
    </div>

    ${
      fallbackUrl
        ? `
      <div style="font-size:12px;color:#666;margin-top:10px;">
        ${escapeHtml(c.fallbackLinkNote)}<br/>
        <a href="${escapeHtml(fallbackUrl)}">${escapeHtml(fallbackUrl)}</a>
      </div>`
        : ""
    }

    ${expireLine}
  `.trim();

  return emailShell({
    brandLine,
    heading: c.headingNew,
    imgBlock,
    sectionsHtml: sections,
    footerHtml: "",
    showingId: showing?.id || "",
  });
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
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const statusLabel = String(showing?.statusLabel || "").trim();
  const lowerStatus = String(statusLabel || "").toLowerCase();
  const waitlistNote =
    lowerStatus.includes("wait") || lowerStatus.includes("coming") ? c.waitlistNote : "";

  const buyerHasAgentText = String(buyer?.buyerHasAgentText || "").trim();

  const expireDays = Number(linksExpireDays || 0) || 0;
  const expireLine =
    expireDays > 0
      ? `<div style="font-size:12px;color:#666;margin-top:10px;">
           ${escapeHtml(c.linksExpireNotePrefix)} ${escapeHtml(String(expireDays))} ${escapeHtml(expireDays === 1 ? "day" : "days")}.
         </div>`
      : "";

  const sections = `
    ${statusLabel ? `<div style="margin:0 0 14px 0;">${infoPill(`${c.statusLabel}: ${statusLabel}`)}</div>` : ""}

    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(c.headingReceived)}</div>
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(c.receivedIntro)}</div>
      ${waitlistNote ? `<div style="margin-top:10px;">${escapeHtml(waitlistNote)}</div>` : ""}
      ${buyerHasAgentText ? `<div style="margin-top:10px;"><strong>${escapeHtml(c.buyerAgentNoteLabel)}:</strong> ${escapeHtml(buyerHasAgentText)}</div>` : ""}
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Requested Time (Property Time)</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>

    <div style="margin-top:10px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${escapeHtml(c.whatNext)}</div>
      <ul style="margin:0;padding-left:18px;color:#111;font-size:14px;line-height:1.6;">
        <li>${escapeHtml(c.next1)}</li>
        <li>${escapeHtml(c.next2)}</li>
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

function capFirst(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
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
        (showing && showing.propertyTimeZoneSnapshot) ||
        timeZone ||
        "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const statusNorm = capFirst(status);
  const isApproved = statusNorm === "Approved";

  const heading = isApproved ? c.headingApproved : c.headingDeclined;
  const intro = isApproved ? c.approvedBody : c.declinedBody;

  const statusLabel = String(showing?.statusLabel || "").trim();
  const schedulerUrl = String((links && links.schedulerUrl) || "").trim();

  const agentPhone = String(agent?.phone || "").trim();
  const agentEmail = String(agent?.email || "").trim();

  const agentContactLine =
    agentName || agentPhone || agentEmail
      ? `
      <div style="margin-top:10px;font-size:14px;line-height:1.6;">
        <div><strong>Agent Contact:</strong> ${escapeHtml(agentName || "Agent")}</div>
        ${agentPhone ? `<div>${escapeHtml(agentPhone)}</div>` : ""}
        ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a></div>` : ""}
      </div>
    `.trim()
      : "";

  const reasonBlock =
    !isApproved && String(declineReasonLabel || "").trim()
      ? `
      <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
        <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.reasonLabel)}</div>
        <div style="font-size:14px;line-height:1.4;">${escapeHtml(declineReasonLabel)}</div>
      </div>
    `.trim()
      : "";

  const rescheduleBlock =
    !isApproved && schedulerUrl
      ? `<div style="margin:14px 0 8px 0;">${primaryButton(schedulerUrl, c.rescheduleBtn)}</div>`
      : "";

  const expireDays = Number(linksExpireDays || 0) || 0;
  const expireLine =
    expireDays > 0
      ? `<div style="font-size:12px;color:#666;margin-top:10px;">
           ${escapeHtml(c.linksExpireNotePrefix)} ${escapeHtml(String(expireDays))} ${escapeHtml(expireDays === 1 ? "day" : "days")}.
         </div>`
      : "";

  const sections = `
    ${statusLabel ? `<div style="margin:0 0 14px 0;">${infoPill(`${c.statusLabel}: ${statusLabel}`)}</div>` : ""}

    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(intro)}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.confirmedTimeLabel)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>

    ${reasonBlock}

    ${agentContactLine ? agentContactLine : ""}

    ${
      isApproved
        ? `
      <div style="margin-top:12px;font-size:13px;color:#111;">
        ${escapeHtml(c.cancelRescheduleLine)}
      </div>`
        : ""
    }

    ${rescheduleBlock}

    ${
      !isApproved && (agentPhone || agentEmail)
        ? `
      <div style="margin-top:10px;font-size:13px;color:#111;">
        ${escapeHtml(c.contactLinePrefix)} ${escapeHtml(agentName || "the agent")}
        ${agentPhone ? ` at ${escapeHtml(agentPhone)}` : ""}${agentEmail ? ` or <a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a>` : ""}.
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
  const expected =
    process.env.CLARIO_SHOWINGS_EMAIL_TOKEN || process.env.CLARIO_EMAIL_WEBHOOK_SECRET || "";

  const got = req.headers["x-clario-secret"] || "";
  const ok = !!expected && String(got) === String(expected);

  try {
    console.log("[ShowingsAuth] CHECK", {
      ok,
      expectedSet: !!expected,
      expectedPrefix: expected ? String(expected).slice(0, 6) + "..." : "",
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
      body.timeZone || property.timeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

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
    const subjectBase = c.subjectNew;
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
    });

    const replyTo = String((body.agent && body.agent.email) || body.agentEmail || body.agent_email || "").trim();
    const fromName = brokerageName || agentName || "Showing Scheduler";

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
      body.timeZone || property.timeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

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

    const linksExpireDays = body.linksExpireDays || body.links_expire_days || 0;

    const timeZone =
      body.timeZone || property.timeZone || showing.propertyTimeZoneSnapshot || "America/New_York";

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
    });

    const replyTo = String((body.agent && body.agent.email) || body.agentEmail || body.agent_email || "").trim();
    const fromName = brokerageName || agentName || "Showing Scheduler";

    await sendEmail({ to, subject, html, fromName, replyTo });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-received failed:", err);
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

/* ───────────────────── Health ───────────────────── */

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

/* ───────────────────── Start server ───────────────────── */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

