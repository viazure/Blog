/**
 * Temporary-transfer cache proxy for blog assets.
 *
 * R2 bucket `cache` is ephemeral: ok to clear anytime.
 * Current scene: music cover art via /cover/lastfm/... and /cover/caa/...
 */

const FETCH_TIMEOUT_MS = 6000;
/** Reject oversized upstream bodies before buffering into Worker memory / R2. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const CACHE_CONTROL = "public, max-age=2592000";
const LASTFM_HOST = "https://lastfm-img.freetls.fastly.net/i/u";
const CAA_HOST = "https://coverartarchive.org/release";

/** Only sizes emitted by build_lastfm.py today. */
const LASTFM_SIZE = /^(64s|300x300)$/;
const LASTFM_FILE = /^[a-f0-9]+\.(jpg|png|gif)$/i;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CoverRoute =
  | { kind: "lastfm"; size: string; file: string; cacheKey: string; upstream: string }
  | { kind: "caa"; mbid: string; cacheKey: string; upstream: string };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const route = parseCoverRoute(url.pathname);
    if (!route) {
      return new Response("Not Found", { status: 404 });
    }

    const cached = await env.CACHE.get(route.cacheKey);
    if (cached) {
      const headers = new Headers();
      cached.writeHttpMetadata(headers);
      headers.set("Cache-Control", CACHE_CONTROL);
      headers.set("X-Cache", "HIT");
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(cached.body, { status: 200, headers });
    }

    try {
      const upstream = await fetch(route.upstream, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
        headers: { "User-Agent": "viazure-blog-cache/1.0 (+https://viazure.cc)" },
      });

      if (!upstream.ok) {
        return Response.redirect(route.upstream, 302);
      }

      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        return Response.redirect(route.upstream, 302);
      }

      const declared = Number(upstream.headers.get("content-length") || "0");
      if (declared > MAX_COVER_BYTES) {
        console.error(
          JSON.stringify({
            event: "cover_too_large",
            route: route.kind,
            contentLength: declared,
          }),
        );
        return Response.redirect(route.upstream, 302);
      }

      const body = await upstream.arrayBuffer();
      if (body.byteLength > MAX_COVER_BYTES) {
        console.error(
          JSON.stringify({
            event: "cover_too_large",
            route: route.kind,
            bytes: body.byteLength,
          }),
        );
        return Response.redirect(route.upstream, 302);
      }

      const httpMetadata = {
        contentType,
        cacheControl: CACHE_CONTROL,
      };

      ctx.waitUntil(
        env.CACHE.put(route.cacheKey, body, {
          httpMetadata,
          customMetadata: { source: route.kind },
        }),
      );

      const headers = new Headers({
        "Content-Type": contentType,
        "Cache-Control": CACHE_CONTROL,
        "X-Cache": "MISS",
      });
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers });
      }
      return new Response(body, { status: 200, headers });
    } catch (err) {
      console.error(JSON.stringify({ event: "cover_fetch_failed", route: route.kind, err: String(err) }));
      return Response.redirect(route.upstream, 302);
    }
  },
} satisfies ExportedHandler<Env>;

function parseCoverRoute(pathname: string): CoverRoute | null {
  // /cover/lastfm/<size>/<hash>.<ext>
  const lastfm = pathname.match(/^\/cover\/lastfm\/([^/]+)\/([^/]+)$/);
  if (lastfm) {
    const size = lastfm[1];
    const file = lastfm[2];
    if (!LASTFM_SIZE.test(size) || !LASTFM_FILE.test(file)) {
      return null;
    }
    return {
      kind: "lastfm",
      size,
      file,
      cacheKey: `cover/lastfm/${size}/${file}`,
      upstream: `${LASTFM_HOST}/${size}/${file}`,
    };
  }

  // /cover/caa/<mbid>/front-250
  const caa = pathname.match(/^\/cover\/caa\/([^/]+)\/front-250$/);
  if (caa) {
    const mbid = caa[1];
    if (!MBID.test(mbid)) {
      return null;
    }
    return {
      kind: "caa",
      mbid,
      cacheKey: `cover/caa/${mbid}/front-250`,
      upstream: `${CAA_HOST}/${mbid}/front-250`,
    };
  }

  return null;
}
