// functions/api/feedback.js

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "GET") {
    return new Response("OK: /api/feedback is live. Send POST from the form.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  return handlePost(context);
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

  // Honeypot
  const company = (form.get("company") || "").toString();
  if (company.trim().length) {
    return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
  }

  if (!message.trim()) return new Response("Message required", { status: 400 });

  if (!env.RESEND_API_KEY || !env.FEEDBACK_TO_EMAIL || !env.FEEDBACK_FROM_EMAIL) {
    return new Response("Server not configured", { status: 500 });
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

  const payload = {
    from: `Budgy Feedback <${env.FEEDBACK_FROM_EMAIL}>`,
    to: [env.FEEDBACK_TO_EMAIL],
    subject,
    text,
    reply_to: email && email.includes("@") ? email : undefined,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return new Response(`Email send failed: ${res.status}\n${err}`, { status: 502 });
  }

  return Response.redirect(new URL("/thanks/", request.url).toString(), 303);
}
