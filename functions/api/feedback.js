// functions/api/feedback.js
// ✅ Cloudflare Pages Function: /api/feedback
// ✅ GET = health check
// ✅ POST = send email via MailChannels
// ✅ Debug mode: /api/feedback?debug=1 returns MailChannels error text as 200 (so CF won't mask it)

export async function onRequest(context) {
  const { request } = context;

  // Health check
  if (request.method === "GET") {
    return new Response("OK: /api/feedback is live. Send POST from the form.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    return await handlePost(context);
  } catch (err) {
    // Prevent Cloudflare's branded 502 page by returning a real response
    return new Response(`Function crashed: ${err?.message || String(err)}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function handlePost({ request, env }) {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";

  const ct = request.headers.get("content-type") || "";
  let form;

  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    form = await request.formData();
  } else {
    return new Response("Unsupported content type", { status: 415 });
  }

  // Fields
  const type = (form.get("type") || "General").toString().slice(0, 40);
  const name = (form.get("name") || "").toString().slice(0, 120);
  const email = (form.get("email") || "").toString().slice(0, 200);
  const message = (form.get("message") || "").toString().slice(0, 5000);

  // Honeypot
  const company = (form.get("company") || "").toString();
  if (company.trim().length) {
    return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
  }

  if (!message.trim()) {
    return new Response("Message required", { status: 400 });
  }

  // Env vars required
  const TO = (env.FEEDBACK_TO_EMAIL || "").trim();
  const FROM = (env.FEEDBACK_FROM_EMAIL || "").trim();
  const FROM_NAME = (env.FEEDBACK_FROM_NAME || "Budgy Feedback").trim();

  if (!TO || !FROM) {
    return new Response(
      "Server not configured (missing FEEDBACK_TO_EMAIL / FEEDBACK_FROM_EMAIL)",
      { status: 500 }
    );
  }

  // Metadata
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ua = request.headers.get("user-agent") || "unknown";
  const now = new Date().toISOString();

  const subject = `Budgy Feedback: ${type}`;
  const text = `New Budgy feedback

Type: ${type}
Name: ${name || "(not provided)"}
Email: ${email || "(not provided)"}

Message:
${message}

---
Time: ${now}
IP: ${ip}
UA: ${ua}
`;

  // MailChannels payload
  const payload = {
    personalizations: [{ to: [{ email: TO }] }],
    from: { email: FROM, name: FROM_NAME },
    subject,
    content: [{ type: "text/plain", value: text }],
    headers: {
      "X-Feedback-IP": ip,
      "X-Feedback-UA": ua,
    },
  };

  // Reply-to if provided
  if (email && email.includes("@")) {
    payload.reply_to = { email };
  }

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => "");

  // ✅ If MailChannels fails, show the real error in debug mode without CF masking it
  if (!res.ok) {
    if (debug) {
      return new Response(
        `MailChannels failed\nStatus: ${res.status}\n\n${bodyText}`,
        {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }
      );
    }

    // Return 500 (not 502) to avoid CF "Bad gateway" branding as often
    return new Response("Email send failed", { status: 500 });
  }

  // Optional: show MailChannels response in debug mode
  if (debug) {
    return new Response(`MailChannels OK\n\n${bodyText || "(no body)"}`, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
}
