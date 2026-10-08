// Builds public/downloads/HelloHR.mobileconfig: an iOS "Web Clip" profile that puts the HelloHR icon on the home screen after the user approves it in Settings.
//   node tools/make-webclip.js [https://your-site]
const fs = require('fs'), path = require('path');
const site = (process.argv[2] || 'https://hellohr24.vercel.app').replace(/\/$/, '');
const icon = fs.readFileSync(path.join(__dirname, '..', 'public', 'icons', 'apple-touch-icon.png')).toString('base64').replace(/(.{76})/g, '$1\n');
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>com.techrunn.hellohr.webclip</string>
      <key>PayloadUUID</key><string>6F1C6E0E-3D52-4B7C-9C1A-5B7A2D9E4A11</string>
      <key>PayloadDisplayName</key><string>HelloHR</string>
      <key>Label</key><string>HelloHR</string>
      <key>URL</key><string>${site}/</string>
      <key>IsRemovable</key><true/>
      <key>FullScreen</key><true/>
      <key>Precomposed</key><true/>
      <key>Icon</key>
      <data>
${icon}
      </data>
    </dict>
  </array>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>com.techrunn.hellohr</string>
  <key>PayloadUUID</key><string>0B7D2B58-8A64-4F3B-A1D0-2C9F6E3B7C22</string>
  <key>PayloadDisplayName</key><string>HelloHR app icon</string>
  <key>PayloadDescription</key><string>Adds the HelloHR employee portal icon to your home screen. It does not change any other setting on your phone.</string>
  <key>PayloadOrganization</key><string>TechRunn IT Solutions</string>
  <key>PayloadRemovalDisallowed</key><false/>
</dict>
</plist>
`;
fs.mkdirSync(path.join(__dirname, '..', 'public', 'downloads'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'public', 'downloads', 'HelloHR.mobileconfig'), plist);
console.log('written');
