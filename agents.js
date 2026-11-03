// Agent runners. An agent is a bot user; when it should answer, runAgent returns reply text (or null).
//  - claude:  built-in, calls the Claude API (needs ANTHROPIC_API_KEY on the server)
//  - webhook: POSTs the event to your URL, signed with HMAC-SHA256; reply with {"text": "..."} or 204
//  - api:     no automatic reply; your program listens on /ws and posts with the agent token
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

let client;
const claude = () => (client ??= new Anthropic());

export async function runAgent(config, event) {
  if (config.kind === 'webhook') return webhook(config, event);
  if (config.kind === 'claude') return claudeReply(config, event);
  return null;
}

async function webhook(config, event) {
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
  const res = await fetch(config.url, {
    method: 'POST', body, signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-seams-signature': 'sha256=' + sig },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`webhook returned ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data.text || null;
}

async function claudeReply(config, { agent, convo, history }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('server has no ANTHROPIC_API_KEY set');
  // Claude needs alternating user/assistant turns: fold consecutive human messages together.
  const messages = [];
  for (const h of history) {
    const role = h.user_id === agent.id ? 'assistant' : 'user';
    const text = role === 'user' ? `${h.display}: ${h.body}` : h.body;
    if (messages.at(-1)?.role === role) messages.at(-1).content += '\n' + text;
    else messages.push({ role, content: text });
  }
  while (messages[0]?.role === 'assistant') messages.shift();
  if (!messages.length || messages.at(-1).role !== 'user') return null;

  const res = await claude().beta.messages.create({
    model: config.model || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' }, // chat replies: fast and cheap
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: `You are ${agent.display} (@${agent.name}), an AI agent in the Seams team chat ${convo.kind} "${convo.name || 'direct message'}". ` +
      `Messages from people are prefixed with their name. Reply concisely in plain text or Markdown.\n\n${config.system || ''}`,
    messages,
  });
  if (res.stop_reason === 'refusal') return "Sorry, I can't help with that.";
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
}
