import express from "express";
import { AppStrategy, createClient } from "@wix/sdk";
import { appInstances } from "@wix/app-management";

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

// Single webhook endpoint for ALL events
app.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  console.log("===== Webhook received =====");
  console.log("Raw body:", req.body);

  try {
    // Let Wix SDK verify & decode the webhook
    const event = await client.webhooks.process(req.body);

    console.log("Decoded event from Wix SDK:");
    console.log(JSON.stringify(event, null, 2));

    // Basic routing by eventType
    switch (event.eventType) {
      case "AppInstalled":
        console.log("👉 App installed for instance:", event.instanceId);
        break;

      case "PaidPlanPurchased":
        console.log("👉 Paid plan purchased for instance:", event.instanceId);
        console.log("   Product:", event.payload?.vendorProductId);
        console.log("   Cycle:", event.payload?.cycle);
        console.log("   Expires on:", event.payload?.expiresOn);
        break;

      case "PaidPlanAutoRenewalCancelled":
        console.log("👉 Auto-renewal cancelled for instance:", event.instanceId);
        console.log("   Product:", event.payload?.vendorProductId);
        console.log("   Expires on:", event.payload?.expiresOn);
        break;

      case "PaidPlanReactivated":
        console.log("👉 Paid plan reactivated for instance:", event.instanceId);
        break;

      case "PaidPlanConvertedToPaid":
        console.log("👉 Trial converted to paid for instance:", event.instanceId);
        break;

      case "PaidPlanTransferred":
        console.log("👉 Plan transferred. Instance:", event.instanceId);
        console.log("   From:", event.payload?.originInstanceId);
        console.log("   To:", event.payload?.targetInstanceId);
        break;

      case "AppRemoved":
        console.log("👉 App removed from instance:", event.instanceId);
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
