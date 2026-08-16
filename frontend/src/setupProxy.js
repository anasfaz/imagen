/**
 * Dev server proxy so that the OAuth 2.0 authorization server (which lives on
 * the FastAPI backend at :8001) is reachable from the RFC 8414 / RFC 9728
 * root-level well-known paths that claude.ai probes.
 *
 * Without this, the Kubernetes ingress routes `/.well-known/*` and `/oauth/*`
 * to the frontend dev server (which serves the SPA HTML for unknown paths),
 * breaking claude.ai's Dynamic Client Registration discovery.
 */
const { createProxyMiddleware } = require("http-proxy-middleware");

const BACKEND = "http://127.0.0.1:8001";

module.exports = function (app) {
  const proxy = createProxyMiddleware({
    target: BACKEND,
    changeOrigin: true,
    xfwd: true,
    logLevel: "warn",
    // Rewrite root-level well-known and oauth paths to their /api/ equivalents
    // so the FastAPI router (which is prefixed with /api) matches them.
    pathRewrite: (path) => {
      if (path.startsWith("/.well-known/oauth-")) {
        // /.well-known/oauth-authorization-server[/api]
        // /.well-known/oauth-protected-resource[/api]
        // Strip a trailing "/api" — some clients append the issuer path.
        const stripped = path.replace(/\/api$/, "");
        return "/api" + stripped;
      }
      if (path.startsWith("/oauth/")) {
        return "/api" + path;
      }
      return path;
    },
  });

  // Match every path claude.ai / RFC 8414-compliant clients may probe.
  app.use("/.well-known/oauth-authorization-server", proxy);
  app.use("/.well-known/oauth-protected-resource", proxy);
  app.use("/oauth/register", proxy);
  app.use("/oauth/authorize", proxy);
  app.use("/oauth/token", proxy);
};
