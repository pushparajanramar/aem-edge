# Informational Card Delivery Pattern (AEP + AEM + Adobe I/O)

This document delivers a production-ready, end-to-end pattern for static and dynamic informational cards (e.g., Personal Cup card) aligned to Adobe personalization guidance.

---

## 1. AEM Content Fragment Model (informational-card)

> **Responsibility:** Authoring system of record. Supports static and tokenized content. Tokens are preserved verbatim for runtime resolution in the UI.

**Content Fragment Model JSON** (exportable from AEM CFM editor):

```json
{
  "name": "informational-card",
  "title": "Informational Card",
  "description": "Model for static and tokenized informational cards",
  "status": "enabled",
  "elements": [
    {
      "name": "cardId",
      "fieldLabel": "Card ID",
      "dataType": "string",
      "required": true,
      "multiple": false,
      "defaultValue": ""
    },
    {
      "name": "headline",
      "fieldLabel": "Headline",
      "dataType": "string",
      "required": false,
      "multiple": false,
      "defaultValue": "",
      "description": "Supports profile tokens like {{profile.starbucks.person.name.firstName}}"
    },
    {
      "name": "body",
      "fieldLabel": "Body",
      "dataType": "string",
      "required": false,
      "multiple": false,
      "defaultValue": ""
    },
    {
      "name": "image",
      "fieldLabel": "Image",
      "dataType": "contentReference",
      "required": false,
      "multiple": false,
      "defaultValue": ""
    },
    {
      "name": "ctaLabel",
      "fieldLabel": "CTA Label",
      "dataType": "string",
      "required": false,
      "multiple": false,
      "defaultValue": ""
    },
    {
      "name": "ctaAction",
      "fieldLabel": "CTA Action",
      "dataType": "enum",
      "required": false,
      "multiple": false,
      "enumValues": ["browser", "overlay"],
      "defaultValue": "browser"
    },
    {
      "name": "termsText",
      "fieldLabel": "Terms Text",
      "dataType": "string",
      "required": false,
      "multiple": false,
      "defaultValue": ""
    },
    {
      "name": "cacheTTL",
      "fieldLabel": "Cache TTL (seconds)",
      "dataType": "number",
      "required": false,
      "multiple": false,
      "defaultValue": 86400
    }
  ]
}
```

**Authoring guidance**
- **Static card**: Author plain strings (no tokens). The output JSON is identical for all users.
- **Dynamic card**: Insert profile tokens in `headline`/`body` (e.g., `Welcome {{profile.starbucks.person.name.firstName}}`). Tokens are preserved end-to-end and resolved only in the UI layer.

---

## 2. Adobe I/O (App Builder) Service

> **Responsibility:** User-agnostic publish-time transformer. Fetches CF JSON from Author, resolves only static (non-profile) tokens, preserves profile tokens verbatim, and writes immutable JSON to Publish for CDN caching.

**App Builder action (Node.js)**

```js
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
```

**AEM Event Trigger (example event payload mapping)**

```json
{
  "cfPath": "/content/dam/cards/personal-cup",
  "authorHost": "https://author.example.aem.cloud",
  "publishHost": "https://publish.example.aem.cloud",
  "authorAccessToken": "${AEM_AUTHOR_SERVICE_TOKEN}",
  "publishAccessToken": "${AEM_PUBLISH_SERVICE_TOKEN}",
  "staticTokens": {
    "environment.brand": "Starbucks"
  }
}
```

**Why this is safe**
- No user identity is passed to Adobe I/O.
- The payload is immutable, deterministic, and identical for all users.
- Profile tokens are not resolved at this layer.

---

## 3. AEM CDN / Dispatcher Cache Configuration

> **Responsibility:** Serve immutable JSON from `/content/cards/*.json` with long-lived cache headers and public cacheability.

**Dispatcher farm configuration**

```apacheconf
# /conf.dispatcher.d/filters/filters.any
/0100 { /type "allow" /url "/content/cards/*.json" }
```

```apacheconf
# /conf.dispatcher.d/cache/cache.any
/cache {
  /rules {
    /0000 { /glob "*" /type "deny" }
    /0100 { /glob "/content/cards/*.json" /type "allow" }
  }
  /headers {
    "Cache-Control"
    "Content-Type"
    "Last-Modified"
    "ETag"
  }
}
```

**CDN headers** (AEM Publish or CDN override):

```
Cache-Control: public, max-age=31536000, immutable
Surrogate-Control: max-age=31536000, immutable
```

**Why global caching is safe**
- Content is **user-agnostic** and identical across users.
- AEP Edge only returns `contentUrl` and **never content**.
- Profile tokens remain unresolved until client rendering.

---

## 4. Web SDK (AEP Edge) Integration

> **Responsibility:** Send identity and request eligibility/state decisions. Response contains metadata only (cardId, contentUrl, state). AEP Edge never assembles or resolves content.

```html
<script src="https://cdn1.adoberesources.net/alloy/latest/alloy.min.js"></script>
<script>
  alloy("configure", {
    edgeConfigId: "YOUR_EDGE_CONFIG_ID",
    orgId: "YOUR_ORG_ID",
    debugEnabled: false
  });

  // Send identity: ECID + loyaltyId
  alloy("sendEvent", {
    type: "decisioning.propositionFetch",
    xdm: {
      identityMap: {
        ECID: [{ id: "${ECID}" }],
        loyaltyId: [{ id: "${LOYALTY_ID}" }]
      }
    },
    decisionScopes: ["informational-cards"],
    data: {
      // request only metadata to ensure content is not assembled at Edge
      request: { contentOnly: false }
    }
  }).then((result) => {
    const cards = result?.propositions?.[0]?.items || [];
    // Each item example:
    // {
    //   cardId: "personal-cup",
    //   contentUrl: "https://publish.example.aem.cloud/content/cards/personal-cup.json",
    //   state: { progress: 3, status: "in_progress", expiry: "2025-12-31" }
    // }
    window.__cards = cards;
  });
</script>
```

---

## 5. UI Rendering (React)

> **Responsibility:** Fetch immutable CDN JSON using `contentUrl`, resolve profile tokens in the UI, and render Edge state overlay.

```jsx
import React, { useMemo, useState } from "react";

function resolveProfileTokens(text, profile) {
  if (!text) return text;
  return text.replace(/\{\{\s*profile\.([^}]+)\s*\}\}/g, (match, path) => {
    const value = path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), profile);
    return value ?? match;
  });
}

export function InformationalCard({ card, profile }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    let active = true;
    fetch(card.contentUrl, { cache: "force-cache" })
      .then((res) => res.json())
      .then((json) => {
        if (active) setContent(json);
      })
      .catch((err) => {
        if (active) setError(err);
      });
    return () => { active = false; };
  }, [card.contentUrl]);

  const resolvedHeadline = useMemo(() => {
    return resolveProfileTokens(content?.headline, profile);
  }, [content?.headline, profile]);

  if (error) return null;
  if (!content) return null;

  const state = card.state || {};
  const progressPct = Math.min(100, Math.max(0, (state.progress || 0) * 10));

  return (
    <div className="card">
      {content.image && <img src={content.image} alt="" className="card__image" />}
      <div className="card__body">
        <h3>{resolvedHeadline}</h3>
        <p>{content.body}</p>
        {state.status && (
          <span className={`badge badge--${state.status}`}>{state.status}</span>
        )}
        {state.progress != null && (
          <div className="progress">
            <div className="progress__bar" style={{ width: `${progressPct}%` }} />
          </div>
        )}
        <button
          className="cta"
          onClick={() => {
            if (content.ctaAction === "overlay") {
              // open modal overlay
              window.dispatchEvent(new CustomEvent("open-terms", { detail: content.termsText }));
            } else {
              window.location.href = "/offers";
            }
          }}
        >
          {content.ctaLabel}
        </button>
      </div>
    </div>
  );
}
```

**UI responsibility notes**
- Fetches immutable card JSON from the CDN.
- Resolves profile tokens at render time with locally available profile data.
- Renders Edge state as overlay (badge/progress bar) without modifying card JSON.

---

## Architectural Alignment (Adobe Guidance)

- **Adobe I/O user-agnostic**: Only service credentials. No user context passes through Adobe I/O.
- **AEM CDN immutable**: `/content/cards/{cardId}.json` is cached globally with long-lived TTL.
- **AEP Edge decisioning**: Only eligibility + state returned (cardId/contentUrl/state).
- **UI token resolution**: Profile tokens resolved **only** in the client at render time.
- **Content identical across users**: CDN payload is stable and safe to cache globally.
