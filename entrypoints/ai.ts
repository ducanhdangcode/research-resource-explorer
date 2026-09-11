import { extractCitations } from "../src/adapters";
export default defineUnlistedScript({
  globalName: true,
  main() {
    try {
      return { citations: extractCitations(document, location.hostname) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  },
});
