import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';

/**
 * Loads the two families the design system is built on.
 *
 * The keys here are the contract with `src/theme/tokens.ts` — `fonts.sans` and friends are
 * these exact strings. React Native resolves `fontFamily` by registered name and cannot
 * synthesise a bold from a regular file, so every weight Inter is used at has to be loaded
 * separately; a weight that is not loaded silently falls back to the system face rather than
 * erroring, which is precisely the failure that is hard to spot in review.
 *
 * @returns true once both families are usable (or have definitively failed to load).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_500Medium,
  });

  // A font that fails to load must not wedge the app behind a permanent splash: the screens
  // are perfectly legible in the system face, just off-brand. Unblock and carry on.
  return loaded || error !== null;
}
