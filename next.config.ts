import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, devIndicators:false, serverExternalPackages:['pg','sharp','pg-boss'], experimental:{serverActions:{bodySizeLimit:'16mb'}} };
export default config;
