import { readFile } from 'node:fs/promises';

export class AdminApiSessionError extends Error {}

function parseCredentials(text) {
  const username = text.match(/^Utilisateur\s*:\s*(.+)$/imu)?.[1]?.trim();
  const password = text.match(/^Mot de passe\s*:\s*(.+)$/imu)?.[1]?.trim();
  if (!username || !password) {
    throw new AdminApiSessionError('Le fichier d’identifiants ne contient pas les champs attendus.');
  }
  return { username, password };
}

async function responseJson(response, action) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiSessionError(`${action} a retourné une réponse illisible (${response.status}).`);
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && typeof payload.detail === 'string'
      ? payload.detail
      : `HTTP ${response.status}`;
    throw new AdminApiSessionError(`${action} refusé : ${detail}`);
  }
  return payload;
}

function sessionCookie(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const pair = setCookies
    .flatMap((value) => value.split(/,(?=[^;,]+=)/u))
    .map((value) => value.split(';', 1)[0])
    .find((value) => value.startsWith('fireviewer_admin='));
  if (!pair) throw new AdminApiSessionError('La connexion n’a pas créé de session administrateur.');
  return pair;
}

export async function authenticateAdmin(apiOrigin, credentialsFile) {
  const credentials = parseCredentials(await readFile(credentialsFile, 'utf8'));
  const response = await fetch(`${apiOrigin}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const cookie = sessionCookie(response);
  const payload = await responseJson(response, 'Connexion administrateur');
  if (payload.authenticated !== true || typeof payload.csrf_token !== 'string' || !payload.csrf_token) {
    throw new AdminApiSessionError('La réponse de session administrateur est incomplète.');
  }
  return { cookie, csrfToken: payload.csrf_token };
}

export async function adminGet(apiOrigin, session, path) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Cookie: session.cookie },
  });
  return responseJson(response, path);
}

export async function adminPost(apiOrigin, session, path, body, idempotencyKey) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return responseJson(response, path);
}
