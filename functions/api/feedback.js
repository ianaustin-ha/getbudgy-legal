// functions/api/feedback.js

export async function onRequest(context) {
  const { request } = context;

  // Quick health check in browser
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
    // If anything throws, we return a real response (prevents Cloudflare 502 page)
    return new Response(`Function crashed: ${err?.message || err}`, { status: 500 });
  }
}

async function handlePost({ request, env }) {
  const ct = request.headers.get("content-type") || "";

  let form;
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    form = await request.formData();
  } else {
    return new Response("Unsupported content type", { status: 415 });
  }

  const type = (form.get("type") || "General").toString().slice(0, 40);
  const name = (form.get("name") || "").toString().slice(0, 120);
  const email = (form.get("email") || "").toString().slice(0, 200);
  const message = (form.get("message") || "").toString().slice(0, 5000);

  // Honeypot (spam protection)
  const company = (form.get("company") || "").toString();
  if (company.trim().length) {
    return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
  }

  if (!message.trim()) return new Response("Message required", { status: 400 });

  // Only require these env vars
  if (!env.FEEDBACK_TO_EMAIL || !env.FEEDBACK_FROM_EMAIL) {
    return new Response("Server not configured (missing FEEDBACK_TO_EMAIL / FEEDBACK_FROM_EMAIL)", {
      status: 500,
    });
  }

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
    personalizations: [{ to: [{ email: env.FEEDBACK_TO_EMAIL }] }],
    from: {
      email: env.FEEDBACK_FROM_EMAIL,
      name: env.FEEDBACK_FROM_NAME || "Budgy Feedback",
    },
    subject,
    content: [{ type: "text/plain", value: text }],
  };

  // Set reply-to if provided
  if (email && email.includes("@")) {
    payload.reply_to = { email };
  }

  const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return new Response(`Email send failed: ${res.status}\n${errText}`, { status: 502 });
  }

  return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
}
