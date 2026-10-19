// Lynx Library teacher settings. Fill these in from Firebase:
// Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
// These values are not secret; the Firestore rules decide who can change settings.
window.LYNX_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};
// Only teachers with an email at this domain can change which topics are shown.
window.LYNX_TEACHER_DOMAIN = "lausanneschool.com";
// Lausanne's Microsoft directory (tenant) ID, so only Lausanne accounts can sign in.
// Find it in the Microsoft Entra admin center → Overview → "Tenant ID".
window.LYNX_MS_TENANT = "";
