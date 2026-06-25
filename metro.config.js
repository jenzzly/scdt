const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const zustandCjs = path.resolve(__dirname, "node_modules/zustand/index.js");
const zustandMiddlewareCjs = path.resolve(__dirname, "node_modules/zustand/middleware.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "zustand") return context.resolveRequest(context, zustandCjs, platform);
  if (moduleName === "zustand/middleware") return context.resolveRequest(context, zustandMiddlewareCjs, platform);
  if (moduleName.startsWith("@/")) {
    return context.resolveRequest(context, path.resolve(__dirname, moduleName.replace("@/", "")), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
