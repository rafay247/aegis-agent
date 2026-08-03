import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfjs-dist dynamically imports its own worker module at runtime
  // (its Node.js "fake worker" fallback). Bundling it with webpack rewrites
  // that dynamic import into an internal module reference that doesn't
  // exist at runtime, breaking PDF text extraction. Excluding it here lets
  // Node's native module resolution handle it unbundled.
  serverExternalPackages: ["pdfjs-dist"]
};

export default nextConfig;
