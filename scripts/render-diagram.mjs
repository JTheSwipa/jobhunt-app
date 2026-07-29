// Renders docs/architecture.mmd to PNG + SVG.
//
//   npm run docs:diagram
//
// Mermaid is a browser library, so this drives a real headless browser. It
// deliberately reuses CHROMIUM_BIN — the same env var the CV PDF renderer uses
// (apps/api/src/cv/render.ts) — instead of pulling a second bundled browser in
// as a dev dependency. If you can render a CV, you can render this.
//
// Needs network on first run: mermaid is loaded from a CDN.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright-core";

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

const [src = "docs/architecture.mmd", outPng = "docs/architecture.png", outSvg = "docs/architecture.svg"] =
  process.argv.slice(2);

const CANDIDATES = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error(
    "No Chromium found. Set CHROMIUM_BIN to a Chrome/Chromium binary — the same one\n" +
      "the CV PDF renderer uses. Tried:\n  " + CANDIDATES.join("\n  "),
  );
  process.exit(1);
}

const graph = readFileSync(src, "utf8");

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin:0; background:#ffffff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #d { padding: 28px; display:inline-block; }
</style></head>
<body><div id="d" class="mermaid"></div>
<script src="${MERMAID_CDN}"></script>
<script>
  window.__err = null;
  document.getElementById("d").textContent = ${JSON.stringify(graph)};
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "loose",
    flowchart: { htmlLabels: true, curve: "basis", nodeSpacing: 45, rankSpacing: 55 },
    themeVariables: {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      fontSize: "15px",
      primaryColor: "#f1f5f4",
      primaryTextColor: "#14151a",
      primaryBorderColor: "#0f9d6b",
      lineColor: "#63666b",
      clusterBkg: "#fafaf9",
      clusterBorder: "#c9cecc"
    }
  });
  mermaid.run({ nodes: [document.getElementById("d")] })
    .then(() => { window.__done = true; })
    .catch((e) => { window.__err = String((e && e.message) || e); window.__done = true; });
</script></body></html>`;

// --no-sandbox: distros that restrict unprivileged user namespaces (Ubuntu
// 23.10+ with AppArmor) refuse to start otherwise. This renders a local file we
// generated ourselves, so there is no untrusted content in the page.
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForFunction("window.__done === true", null, { timeout: 30000 });

  const err = await page.evaluate(() => window.__err);
  if (err) {
    console.error("Mermaid failed to parse " + src + ":\n" + err);
    process.exit(1);
  }

  // Mermaid stamps a max-width on the <svg>, which squashes the diagram down to
  // the viewport and makes the labels unreadable. Force its natural size first.
  await page.evaluate(() => {
    const svg = document.querySelector("#d svg");
    const vb = svg.viewBox.baseVal;
    svg.removeAttribute("style");
    svg.setAttribute("width", String(vb.width));
    svg.setAttribute("height", String(vb.height));
  });

  const el = page.locator("#d");
  await el.screenshot({ path: outPng });
  const svg = await page.evaluate(() => document.querySelector("#d svg")?.outerHTML ?? "");
  if (!svg) {
    console.error("Mermaid produced no SVG.");
    process.exit(1);
  }
  writeFileSync(outSvg, svg, "utf8");

  const box = await el.boundingBox();
  console.log(`${outPng}  ${Math.round(box.width * 2)}x${Math.round(box.height * 2)}px`);
  console.log(`${outSvg}  ${svg.length} bytes`);
  console.log("\nLook at the PNG before committing — mermaid silently drops some characters.");
} finally {
  await browser.close();
}
