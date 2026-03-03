// functions/api/feedback.js

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
    return new Response(`Function crashed: ${err?.message || String(err)}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function handlePost({ request, env }) {
  const ct = request.headers.get("content-type") || "";

  if (
    !ct.includes("application/x-www-form-urlencoded") &&
    !ct.includes("multipart/form-data")
  ) {
    return new Response("Unsupported content type", { status: 415 });
  }

  const form = await request.formData();

  const type = (form.get("type") || "General").toString().slice(0, 40);
  const name = (form.get("name") || "").toString().slice(0, 120);
  const email = (form.get("email") || "").toString().slice(0, 200);
  const message = (form.get("message") || "").toString().slice(0, 5000);

  // Honeypot
  const company = (form.get("company") || "").toString();
  if (company.trim().length) {
    return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
  }

  if (!message.trim()) return new Response("Message required", { status: 400 });

  // ✅ Required env vars
  if (!env.RESEND_API_KEY) {
    return new Response("Server not configured (missing RESEND_API_KEY)", { status: 500 });
  }
  if (!env.FEEDBACK_TO_EMAIL || !env.FEEDBACK_FROM_EMAIL) {
    return new Response(
      "Server not configured (missing FEEDBACK_TO_EMAIL / FEEDBACK_FROM_EMAIL)",
      { status: 500 }
    );
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

  // Resend expects:
  // from: "Name <email@domain.com>" OR just "email@domain.com"
  const fromName = (env.FEEDBACK_FROM_NAME || "Budgy Feedback").toString();
  const from = `${fromName} <${env.FEEDBACK_FROM_EMAIL}>`;

  const payload = {
    from,
    to: [env.FEEDBACK_TO_EMAIL],
    subject,
    text,
    // If user entered an email, make Reply-To their email
    reply_to: email && email.includes("@") ? email : undefined,
    // Optional: set a tag for filtering in Resend
    tags: [{ name: "source", value: "website-feedback" }],
  };

  // Resend API
  const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  const body = await res.text().catch(() => "");
  return new Response(
    `Email send failed: ${res.status}\n\n${body}`,
    { status: 200, headers: { "content-type": "text/plain" } }
  );
}

return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
}
