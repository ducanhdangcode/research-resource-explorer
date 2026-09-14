import { defineConfig } from "wxt";
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Resource Explorer",
    version: "0.1.0",
    minimum_chrome_version: "120",
    description:
      "Open citations and locate matching passages. Local research tools.",
    permissions: [
      "activeTab",
      "scripting",
      "storage",
      "sidePanel",
      "alarms",
      "offscreen",
    ],
    host_permissions: ["https://generativelanguage.googleapis.com/*"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    action: { default_title: "Explore citations" },
    icons: {
      16: "/icons/16.png",
      32: "/icons/32.png",
      48: "/icons/48.png",
      128: "/icons/128.png",
    },
  },
});
