/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "mine-ting.vercel.app" }],
        destination: "https://mine-ting-web.vercel.app/:path*",
        permanent: true
      }
    ];
  }
};
export default nextConfig;
