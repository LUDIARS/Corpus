const baseUrl = requiredBaseUrl();
const token = process.env.CORPUS_ACCESS_TOKEN?.trim();
const [command, target, jsonInput = '{}'] = process.argv.slice(2);

if (command === 'list') {
  print(await request('/api/capabilities'));
} else if (command === 'invoke') {
  if (!target || !target.includes('.')) {
    fail('usage: capability.mjs invoke <module.capability> <json>');
  }
  const separator = target.indexOf('.');
  let input;
  try {
    input = JSON.parse(jsonInput);
  } catch (error) {
    fail(`invalid JSON input: ${error.message}`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('input must be a JSON object');
  }
  print(await request(
    `/api/capabilities/${encodeURIComponent(target.slice(0, separator))}/` +
      `${encodeURIComponent(target.slice(separator + 1))}/invoke`,
    input,
  ));
} else {
  fail('usage: capability.mjs <list|invoke>');
}

function requiredBaseUrl() {
  const value = process.env.CORPUS_BASE_URL?.trim();
  if (!value) fail('CORPUS_BASE_URL is required');
  return value.replace(/\/+$/, '');
}

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({
    error: 'invalid_server_response',
    status: response.status,
  }));
  if (!response.ok) {
    fail(JSON.stringify(payload));
  }
  return payload;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
