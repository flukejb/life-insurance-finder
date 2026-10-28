import { onRequestGet } from "../functions/api/market.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/market" && request.method === "GET") return onRequestGet();
    return env.ASSETS.fetch(request);
  },
};
