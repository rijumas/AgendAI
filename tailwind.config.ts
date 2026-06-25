import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        paper: "#f6f7f1",
        mint: "#48a06d",
        coral: "#dd6b4d"
      }
    }
  },
  plugins: []
};

export default config;
