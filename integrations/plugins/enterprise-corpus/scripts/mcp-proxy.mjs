import { createInterface } from 'node:readline';

const baseUrl = process.env.CORPUS_BASE_URL?.trim().replace(/\/+$/, '');
if (!baseUrl) {
  process.stderr.write('CORPUS_BASE_URL is required\n');
  process.exit(1);
}
const token = process.env.CORPUS_ACCESS_TOKEN?.trim();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: line,
    });
    const body = await response.text();
    if (body) process.stdout.write(`${body}\n`);
    if (!response.ok && !body) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: `Corpus HTTP ${response.status}` },
      })}\n`);
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    })}\n`);
  }
}
