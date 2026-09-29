import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfjs-dist dynamically imports its own worker module at runtime
  // (its Node.js "fake worker" fallback). Bundling it with webpack rewrites
  // that dynamic import into an internal module reference that doesn't
  // exist at runtime, breaking PDF text extraction. Excluding it here lets
  // Node's native module resolution handle it unbundled.
  serverExternalPackages: ["pdfjs-dist"],
  // Output file tracing can't see two runtime loads, so serverless deploys
  // (Vercel) would ship pdf.mjs without them:
  // - the dynamic import of its worker module;
  // - @napi-rs/canvas, loaded via createRequire. pdf.mjs calls
  //   `new DOMMatrix()` at import time and polyfills DOMMatrix from it on
  //   Node, so without it the route fails with "DOMMatrix is not defined".
  //   The linux-x64-gnu binary is the one Vercel's runtime loads.
  outputFileTracingIncludes: {
    "/api/sources/pdf": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*"
    ]
  }
};

export default nextConfig;
