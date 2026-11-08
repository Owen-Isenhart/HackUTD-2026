const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
module.exports = defineConfig([
  expo,
  { ignores: ["dist*/**", "node_modules/**"] },
  // Existing Animated.Value renderers use the React Native imperative animation API.
  // Keep the compiler's ref heuristic off only for these established renderers.
  {
    files: [
      "src/motion.tsx",
      "src/components/WaveTabBar.tsx",
      "src/screens/SignInScreen.tsx",
      "src/screens/DealsScreen.tsx",
    ],
    rules: { "react-hooks/refs": "off" },
  },
  // These effects synchronize externally driven GPS/network state.
  {
    files: [
      "src/location/useNearbyStores.ts",
      "src/finance/useFinanceRecommendation.ts",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);
