import { Platform, Share } from 'react-native';

/** Called only by an explicit share button; never sends or publishes automatically. */
export async function shareInvitation(title: string, message: string) {
  try {
    if (Platform.OS === 'web') {
      if (navigator.share) { await navigator.share({ title, text: message }); return ''; }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        return 'Invitation copied. Share it whenever you are ready.';
      }
      throw new Error('Sharing is unavailable in this browser. Copy the invitation link below.');
    }
    await Share.share({ title, message });
    return '';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return '';
    throw error;
  }
}
