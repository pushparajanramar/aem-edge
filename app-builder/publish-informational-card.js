/*
  Adobe I/O Runtime Action: publish-informational-card
  Trigger: AEM CF publish event (AEM as a Cloud Service)
  Auth: Service credentials only (no user identity)
*/

const fetch = require('node-fetch');

const PROFILE_TOKEN_REGEX = /\{\{\s*profile\.[^}]+\}\}/g;

function resolveStaticTokens(input, staticTokens) {
  if (!input) return input;
  // Replace only known static tokens. Profile tokens are preserved.
  return input.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, token) => {
    const trimmed = token.trim();
    if (PROFILE_TOKEN_REGEX.test(match)) return match;
    if (Object.prototype.hasOwnProperty.call(staticTokens, trimmed)) {
      return staticTokens[trimmed];
    }
    return match;
  });
}

async function fetchAemJson(url, accessToken) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AEM fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function putAemJson(url, accessToken, body, ttlSeconds) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttlSeconds}, immutable`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AEM publish write failed: ${res.status} ${text}`);
  }
  return res.json();
}

exports.main = async (params) => {
  /*
    Expected params from event:
    - cfPath: path to the CF in AEM Author
    - authorHost, publishHost
    - authorAccessToken, publishAccessToken (service tokens)
  */
  const {
    cfPath,
    authorHost,
    publishHost,
    authorAccessToken,
    publishAccessToken,
    staticTokens = {}
  } = params;

  if (!cfPath || !authorHost || !publishHost) {
    return { statusCode: 400, body: 'Missing required parameters' };
  }

  const cfUrl = `${authorHost}${cfPath}.model.json`;
  const cfJson = await fetchAemJson(cfUrl, authorAccessToken);

  const elements = cfJson?.elements || {};
  const cardId = elements?.cardId?.value;
  if (!cardId) {
    return { statusCode: 422, body: 'cardId is required' };
  }

  const ttl = Number(elements?.cacheTTL?.value || 86400);

  const payload = {
    cardId,
    headline: resolveStaticTokens(elements?.headline?.value, staticTokens),
    body: resolveStaticTokens(elements?.body?.value, staticTokens),
    image: elements?.image?.value || null,
    ctaLabel: resolveStaticTokens(elements?.ctaLabel?.value, staticTokens),
    ctaAction: elements?.ctaAction?.value || 'browser',
    termsText: resolveStaticTokens(elements?.termsText?.value, staticTokens),
    cacheTTL: ttl
  };

  const publishUrl = `${publishHost}/content/cards/${cardId}.json`;
  await putAemJson(publishUrl, publishAccessToken, payload, ttl);

  return {
    statusCode: 200,
    body: {
      message: 'Card payload published',
      publishUrl
    }
  };
};
