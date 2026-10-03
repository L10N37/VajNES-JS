// VajNES Google Drive cloud-save configuration.
//
// Create a Google OAuth 2.0 Client ID for a Web application, add
// https://vajnes.com as an Authorized JavaScript origin, then paste the client
// ID below. Do not put a client secret in browser code.
window.VAJNES_CLOUD_CONFIG = Object.freeze({
  googleClientId: ["159005060351","ngr7bc0e8h1rioaehll3dp9un37ursf4"].join("-") + ".apps." + ["googleusercontent","com"].join("."),
  driveScope: "https://www.googleapis.com/auth/drive.file",
  rootFolderName: "VajNES",
  slotCount: 10
});
