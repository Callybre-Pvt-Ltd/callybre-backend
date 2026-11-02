// Sends a contact submission to Slack via an Incoming Webhook.
// Docs: https://api.slack.com/messaging/webhooks

// Escape Slack mrkdwn control chars so user input can't inject
// links, @channel pings or formatting.
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function sendToSlack(webhookUrl, { name, email, phone, service, message }) {
  const fields = [
    { type: 'mrkdwn', text: `*Name:*\n${esc(name)}` },
    { type: 'mrkdwn', text: `*Email:*\n${esc(email)}` },
    { type: 'mrkdwn', text: `*Phone:*\n${phone ? esc(phone) : '—'}` },
    { type: 'mrkdwn', text: `*Service:*\n${service ? esc(service) : '—'}` },
  ]

  const payload = {
    // Fallback text for notifications
    text: `New contact form submission from ${esc(name)}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📬 New contact form submission' } },
      { type: 'section', fields },
      { type: 'section', text: { type: 'mrkdwn', text: `*Message:*\n${esc(message)}` } },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Received ${new Date().toUTCString()}` }],
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Slack webhook failed: ${res.status} ${body}`)
  }
}
