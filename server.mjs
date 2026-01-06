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

  CLARIO_SHOWINGS_EMAIL_TOKEN = shared secret to protect /showings/* routes
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

/* ================================================================
 * Recipient normalization (FIXES Resend 422 Invalid `to`)
 * - Accepts: "email@x.com", "Name <email@x.com>", "foo@x.com; bar@y.com"
 * - Extracts valid emails, dedupes, and ONLY sends valid emails to Resend.
 * - If no valid emails can be found, throws a clear error (so endpoint returns 500).
 * ================================================================ */
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

  // If caller forgot, let ADMIN_EMAIL try to supply recipients (but still must be valid emails)
  if (raw.length === 0 && ADMIN_EMAIL) raw.push(ADMIN_EMAIL);

  // Split on common separators and extract emails
  let emails = raw
    .flatMap((item) => String(item == null ? "" : item).split(/[;,]/g))
    .flatMap((part) => extractValidEmails(part));

  // Dedupe
  emails = Array.from(new Set(emails));

  return { raw, emails };
}

async function sendEmail({ to, subject, html }) {
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

  if (emails.length === 0) {
    throw new Error(
      `No valid recipient emails found. to=${JSON.stringify(to)} ADMIN_EMAIL=${JSON.stringify(ADMIN_EMAIL)}`
    );
  }

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: emails, // ONLY valid emails
      subject,
      html,
    });

    // Resend returns { data, error }. Treat error as failure.
    if (result && result.error) {
      console.error("❌ Resend validation/send error:", result.error);
      throw new Error(result.error.message || "Resend error");
    }

    console.log("📧 Email sent:", result);
  } catch (err) {
    console.error("❌ Failed to send email:", err);
    throw err; // so your endpoint returns 500 on failure (no more false "ok")
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

/* ───────────────────── Showing Emails ───────────────────── */

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase();
  if (s.startsWith("es")) return "es";
  return "en";
}

const EMAIL_COPY = {
  en: {
    // Agent/Admin
    subjectNew: "New Showing Request",
    headingNew: "New Showing Request",
    manage: "Manage Showing",
    fallbackLinkNote: "If the button doesn’t work, use this link:",
    requestedTime: "Requested Time",
    scheduledTime: "Scheduled Time",
    buyer: "Buyer",
    property: "Property",

    // Buyer received
    subjectReceived: "We received your showing request",
    headingReceived: "Request received",
    receivedIntro:
      "We received your request to tour the home below. The listing agent will review availability and you’ll receive a confirmation email soon.",
    whatNext: "What happens next",
    next1: "The agent is reviewing availability now.",
    next2: "You’ll receive an email confirming your appointment or requesting a different time.",

    // Buyer status
    subjectApproved: "Showing Confirmed",
    subjectDeclined: "Showing Request Declined",
    headingApproved: "Your showing is confirmed",
    headingDeclined: "Your request was declined",
    statusLabel: "Status",
    reasonLabel: "Reason",
    approvedBody: "Your appointment has been confirmed. We look forward to seeing you.",
    declinedBody: "Unfortunately, the requested time is not available.",
    rescheduleBtn: "Pick a different time",
    contactLinePrefix: "Need help?",
    cancelRescheduleLine: "If you need to cancel or reschedule, contact the agent directly.",

    // Buyer reminders (24h only)
    subjectReminder24hPrefix: "Reminder: Your showing is tomorrow",
    headingReminder24h: "Showing reminder (24 hours)",
    reminderIntro24h: "This is a reminder about your upcoming showing.",
    agentContact: "Agent Contact",

    // Agent reminders (24h only)
    subjectAgentReminder24hPrefix: "Reminder: Showing tomorrow",
    agentReminderHeading24h: "Showing reminder (24 hours)",
    dashboardOnlyNote:
      "You can manage this showing from your dashboard. (The Manage Showing link is no longer valid after approve/decline.)",
  },
  es: {
    subjectNew: "Nueva solicitud de visita",
    headingNew: "Nueva solicitud de visita",
    manage: "Administrar visita",
    fallbackLinkNote: "Si el botón no funciona, usa este enlace:",
    requestedTime: "Hora solicitada",
    scheduledTime: "Hora programada",
    buyer: "Comprador",
    property: "Propiedad",

    subjectReceived: "Recibimos tu solicitud de visita",
    headingReceived: "Solicitud recibida",
    receivedIntro:
      "Recibimos tu solicitud para visitar la propiedad. El agente revisará la disponibilidad y pronto recibirás un correo de confirmación.",
    whatNext: "¿Qué sigue?",
    next1: "El agente está revisando la disponibilidad.",
    next2: "Recibirás un correo confirmando tu cita o solicitando otra hora.",

    subjectApproved: "Visita confirmada",
    subjectDeclined: "Solicitud rechazada",
    headingApproved: "Tu visita está confirmada",
    headingDeclined: "Tu solicitud fue rechazada",
    statusLabel: "Estado",
    reasonLabel: "Motivo",
    approvedBody: "Tu cita ha sido confirmada.",
    declinedBody: "Lamentablemente, la hora solicitada no está disponible.",
    rescheduleBtn: "Elegir otra hora",
    contactLinePrefix: "¿Necesitas ayuda?",
    cancelRescheduleLine: "Si necesitas cancelar o reprogramar, contacta al agente.",

    // Buyer reminders (24h only)
    subjectReminder24hPrefix: "Recordatorio: tu visita es mañana",
    headingReminder24h: "Recordatorio (24 horas)",
    reminderIntro24h: "Este es un recordatorio de tu visita.",
    agentContact: "Contacto del agente",

    // Agent reminders (24h only)
    subjectAgentReminder24hPrefix: "Recordatorio: visita mañana",
    agentReminderHeading24h: "Recordatorio (24 horas)",
    dashboardOnlyNote:
      "Puedes gestionar esta visita desde tu panel. (El enlace de administrar ya no es válido después de aprobar/rechazar.)",
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
  const street = p?.street || p?.streetAddress || p?.address || "";
  const city = p?.city || "";
  const state = p?.state || "";
  const zip = p?.zip || p?.postalCode || "";
  const line2 = [city, state].filter(Boolean).join(", ");
  return [street, [line2, zip].filter(Boolean).join(" ")].filter(Boolean).join("<br/>");
}

function subjectAddressShort(property) {
  const street = String(property?.street || property?.streetAddress || property?.address || "").trim();
  const city = String(property?.city || "").trim();
  if (street && city) return `${street}, ${city}`;
  return street || city || "Property";
}

function safeDisplayTimeOnlyProperty({ showing, timeZone, lang }) {
  // Your backend already sets requestedStartDisplayCombined to property-time for buyer flows.
  // For agent/admin, we still prefer requestedStartDisplayProperty (single TZ) and fall back.
  const tzFallback = String(timeZone || showing?.propertyTimeZoneSnapshot || "America/New_York").trim() || "America/New_York";
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

function primaryButton(url, label) {
  if (!url) return "";
  return `
    <a href="${escapeHtml(url)}"
       style="display:inline-block;text-decoration:none;padding:12px 16px;border-radius:10px;background:#0b5cff;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">
      ${escapeHtml(label)}
    </a>`;
}

function emailShell({ brandLine, heading, imgBlock, sectionsHtml, footerHtml, showingId }) {
  return `
  <div style="background:#f6f6f7;padding:24px;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;">
        ${brandLine ? `<div style="font-size:13px;color:#555;margin-bottom:8px;">${escapeHtml(brandLine)}</div>` : ""}
        <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.2;">${escapeHtml(heading)}</h1>

        ${imgBlock || ""}

        ${sectionsHtml || ""}

        ${footerHtml || ""}

        ${showingId ? `<div style="font-size:12px;color:#999;margin-top:18px;">Showing ID: ${escapeHtml(showingId)}</div>` : ""}
      </div>
    </div>
  </div>
  `.trim();
}

/* ───────────── HTML Builders ───────────── */

function buildNewShowingEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, links, timeZone }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

  const brandLine = brokerageName || agentName || "Showing Scheduler";
  const addressHtml = formatAddress(property);

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const buyerName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ").trim();
  const buyerEmail = buyer?.email || "";
  const buyerPhone = buyer?.phone || "";

  const tz =
    String(
      (property && property.timeZone) ||
      (showing && showing.propertyTimeZoneSnapshot) ||
      timeZone ||
      "America/New_York"
    ).trim() || "America/New_York";

  const requestedText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const manageUrl = links?.manageUrl || "";
  const fallbackUrl = manageUrl || "";

  const sections = `
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
      </div>
    </div>

    <div style="margin:18px 0 8px 0;">
      ${primaryButton(manageUrl, c.manage)}
    </div>

    ${fallbackUrl ? `
      <div style="font-size:12px;color:#666;margin-top:10px;">
        ${escapeHtml(c.fallbackLinkNote)}<br/>
        <a href="${escapeHtml(fallbackUrl)}">${escapeHtml(fallbackUrl)}</a>
      </div>` : ""}
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

function buildBuyerReceivedEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, timeZone }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

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

  const sections = `
    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(c.headingReceived)}</div>
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(c.receivedIntro)}</div>
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

function buildBuyerStatusEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, status, declineReasonLabel, timeZone, links, agent }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

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

  const schedulerUrl = links?.schedulerUrl || "";

  const agentPhone = String(agent?.phone || "").trim();
  const agentEmail = String(agent?.email || "").trim();
  const agentContactLine = (agentName || agentPhone || agentEmail)
    ? `
      <div style="margin-top:10px;font-size:14px;line-height:1.6;">
        <div><strong>${escapeHtml(c.agentContact)}:</strong> ${escapeHtml(agentName || "Agent")}</div>
        ${agentPhone ? `<div>${escapeHtml(agentPhone)}</div>` : ""}
        ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a></div>` : ""}
      </div>
    `.trim()
    : "";

  const reasonBlock = (!isApproved && String(declineReasonLabel || "").trim())
    ? `
      <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
        <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.reasonLabel)}</div>
        <div style="font-size:14px;line-height:1.4;">${escapeHtml(declineReasonLabel)}</div>
      </div>
    `.trim()
    : "";

  const rescheduleBlock = (!isApproved && schedulerUrl)
    ? `<div style="margin:14px 0 8px 0;">${primaryButton(schedulerUrl, c.rescheduleBtn)}</div>`
    : "";

  const sections = `
    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(intro)}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Confirmed Time (Property Time)</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>

    ${reasonBlock}

    ${agentContactLine ? agentContactLine : ""}

    ${isApproved ? `
      <div style="margin-top:12px;font-size:13px;color:#111;">
        ${escapeHtml(c.cancelRescheduleLine)}
      </div>` : ""}

    ${rescheduleBlock}

    ${(!isApproved && (agentPhone || agentEmail)) ? `
      <div style="margin-top:10px;font-size:13px;color:#111;">
        ${escapeHtml(c.contactLinePrefix)} ${escapeHtml(agentName || "the agent")}
        ${agentPhone ? ` at ${escapeHtml(agentPhone)}` : ""}${agentEmail ? ` or <a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a>` : ""}.
      </div>` : ""}
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

function buildBuyerReminderEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, timeZone, reminderType, agent }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

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

  // 24h only
  const heading = c.headingReminder24h;
  const intro = c.reminderIntro24h;

  const agentPhone = String(agent?.phone || "").trim();
  const agentEmail = String(agent?.email || "").trim();

  const agentContactBlock = (agentName || agentPhone || agentEmail)
    ? `
      <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-top:14px;">
        <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.agentContact)}</div>
        <div style="font-size:14px;line-height:1.6;">
          <div>${escapeHtml(agentName || "Agent")}</div>
          ${agentPhone ? `<div>${escapeHtml(agentPhone)}</div>` : ""}
          ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(agentEmail)}</a></div>` : ""}
        </div>
      </div>
    `.trim()
    : "";

  const sections = `
    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(heading)}</div>
      <div>Hi ${escapeHtml(greetingName)},</div>
      <div>${escapeHtml(intro)}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">Time (Property Time)</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(requestedText || "—")}</div>
    </div>

    ${agentContactBlock}

    <div style="margin-top:12px;font-size:13px;color:#111;">
      ${escapeHtml(c.cancelRescheduleLine)}
    </div>
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

function buildAgentReminderEmailHtml({ lang, brokerageName, agentName, property, buyer, showing, timeZone, reminderType }) {
  const c = EMAIL_COPY[lang] || EMAIL_COPY.en;

  const brandLine = brokerageName || agentName || "Showing Scheduler";
  const addressHtml = formatAddress(property);

  const imgUrl = wixImageToPublicUrl(property?.image);
  const imgBlock = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="Property" style="width:100%;max-width:560px;border-radius:12px;display:block;margin:0 auto 16px auto;" />`
    : "";

  const tz =
    String(
      (property && property.timeZone) ||
      (showing && showing.propertyTimeZoneSnapshot) ||
      timeZone ||
      "America/New_York"
    ).trim() || "America/New_York";

  const scheduledText = safeDisplayTimeOnlyProperty({ showing, timeZone: tz, lang });

  const buyerName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ").trim();
  const buyerEmail = buyer?.email || "";
  const buyerPhone = buyer?.phone || "";

  // 24h only
  const heading = c.agentReminderHeading24h;

  const sections = `
    <div style="font-size:14px;line-height:1.6;margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(heading)}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.property)}</div>
      <div style="font-size:14px;line-height:1.4;">${addressHtml || "—"}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.scheduledTime)}</div>
      <div style="font-size:14px;line-height:1.4;">${escapeHtml(scheduledText || "—")}</div>
    </div>

    <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:14px;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;">${escapeHtml(c.buyer)}</div>
      <div style="font-size:14px;line-height:1.6;">
        <div>${escapeHtml(buyerName || "—")}</div>
        ${buyerEmail ? `<div><a href="mailto:${escapeHtml(buyerEmail)}" style="color:#0b5cff;text-decoration:none;">${escapeHtml(buyerEmail)}</a></div>` : ""}
        ${buyerPhone ? `<div>${escapeHtml(buyerPhone)}</div>` : ""}
      </div>
    </div>

    <div style="margin-top:10px;font-size:13px;color:#111;">
      ${escapeHtml(c.dashboardOnlyNote)}
    </div>
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
    process.env.CLARIO_SHOWINGS_EMAIL_TOKEN ||
    process.env.CLARIO_EMAIL_WEBHOOK_SECRET ||
    "";

  const got = req.headers["x-clario-secret"] || "";
  return !!expected && String(got) === String(expected);
}

/* ───────────────────── /showings/new-request ───────────────────── */

app.post("/showings/new-request", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
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

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    let to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];
    if (to.length === 0 && ADMIN_EMAIL) to = [ADMIN_EMAIL];

    const subjectBase = (EMAIL_COPY[lang] || EMAIL_COPY.en).subjectNew;
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
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/new-request failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── /showings/buyer-status ───────────────────── */

app.post("/showings/buyer-status", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
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
    const agent = body.agent || {}; // optional

    const status = body.status || body.showingStatus || "";
    const declineReasonLabel =
      body.declineReasonLabel ||
      (body.declineReason && body.declineReason.label) ||
      "";

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    const buyerEmail = (buyer && buyer.email) ? String(buyer.email).trim() : "";
    let to = [];
    if (buyerEmail) to = [buyerEmail];

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
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
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-status failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── NEW: /showings/buyer-received ───────────────────── */

app.post("/showings/buyer-received", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};

    const lang = normalizeLang(body.language);
    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    const buyerEmail = (buyer && buyer.email) ? String(buyer.email).trim() : "";
    const to = buyerEmail ? [buyerEmail] : [];

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
    const subject = `${c.subjectReceived} — ${subjectAddressShort(property)}`;

    const html = buildBuyerReceivedEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-received failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── NEW: Buyer reminders (explicit endpoint, 24h only) ───────────────────── */

app.post("/showings/buyer-reminder-24h", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).send("unauthorized");

    const body = req.body || {};
    const lang = normalizeLang(body.language);

    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};
    const agent = body.agent || {}; // in your triggerBuyerReminderCore payload

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    // FIX: allow buyer.email OR body.to for testing; sendEmail() will extract valid emails only
    const buyerEmail = (buyer && buyer.email) ? String(buyer.email).trim() : "";
    let to = [];
    if (buyerEmail) to = [buyerEmail];
    else if (Array.isArray(body.to)) to = body.to.filter(Boolean);

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
    const subject = `${c.subjectReminder24hPrefix} — ${subjectAddressShort(property)}`;

    const html = buildBuyerReminderEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
      reminderType: "24h",
      agent,
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-reminder-24h failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── NEW: Agent reminders (explicit endpoint, 24h only) ───────────────────── */

app.post("/showings/agent-reminder-24h", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).send("unauthorized");

    const body = req.body || {};
    const lang = normalizeLang(body.language);

    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    // your triggerAgentReminderCore sends `to` array (agent email)
    const to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
    const subject = `${c.subjectAgentReminder24hPrefix} — ${subjectAddressShort(property)}`;

    const html = buildAgentReminderEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
      reminderType: "24h",
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/agent-reminder-24h failed:", err);
    return res.status(500).send("error");
  }
});

/* ───────────────────── REQUIRED by showings-reminders.jsw (hourly job) ─────────────────────
   Your hourly job posts to:
     - /showings/buyer-reminder
     - /showings/agent-reminder
   This server now supports 24h reminders ONLY.
*/

app.post("/showings/buyer-reminder", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).send("unauthorized");

    // 24h only (ignore any reminderType provided)
    const body = req.body || {};
    const lang = normalizeLang(body.language);

    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};
    const agent = body.agent || {};

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    // FIX: allow buyer.email OR body.to for testing; sendEmail() will extract valid emails only
    const buyerEmail = (buyer && buyer.email) ? String(buyer.email).trim() : "";
    let to = [];
    if (buyerEmail) to = [buyerEmail];
    else if (Array.isArray(body.to)) to = body.to.filter(Boolean);

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
    const subject = `${c.subjectReminder24hPrefix} — ${subjectAddressShort(property)}`;

    const html = buildBuyerReminderEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
      reminderType: "24h",
      agent,
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/buyer-reminder failed:", err);
    return res.status(500).send("error");
  }
});

app.post("/showings/agent-reminder", async (req, res) => {
  try {
    if (!isAuthorized(req)) return res.status(401).send("unauthorized");

    const body = req.body || {};
    const lang = normalizeLang(body.language);

    const brokerageName = body.brokerageName || "";
    const agentName = body.agentName || "";

    const property = body.property || {};
    const buyer = body.buyer || {};
    const showing = body.showing || {};

    const timeZone =
      body.timeZone ||
      property.timeZone ||
      showing.propertyTimeZoneSnapshot ||
      "America/New_York";

    // hourly job sends `to: [agentEmail]`
    const to = Array.isArray(body.to) ? body.to.filter(Boolean) : [];

    const c = EMAIL_COPY[lang] || EMAIL_COPY.en;
    const subject = `${c.subjectAgentReminder24hPrefix} — ${subjectAddressShort(property)}`;

    const html = buildAgentReminderEmailHtml({
      lang,
      brokerageName,
      agentName,
      property,
      buyer,
      showing,
      timeZone,
      reminderType: "24h",
    });

    await sendEmail({ to, subject, html });
    return res.status(200).send("ok");
  } catch (err) {
    console.error("❌ /showings/agent-reminder failed:", err);
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
