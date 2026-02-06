import React, { useMemo, useState } from "react";

function resolveProfileTokens(text, profile) {
  if (!text) return text;
  return text.replace(/\{\{\s*profile\.([^}]+)\s*\}\}/g, (match, path) => {
    const value = path
      .split('.')
      .reduce((acc, key) => (acc ? acc[key] : undefined), profile);
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
