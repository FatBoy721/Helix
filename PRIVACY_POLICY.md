# Helix Privacy Policy

**Last updated: July 18, 2026**

Helix is a mobile app for monitoring and controlling Klipper and Moonraker 3D printers. This policy explains what information Helix handles and how it is used.

## Information Helix handles

### Printer connection information

Helix stores printer names, printer addresses, connection settings, and notification preferences on the user's device so the app can connect to the printer. Printer connections may use a local network address or Tailscale. This information is not sold or used for advertising.

### Push notification information

If Firebase push notifications are enabled, Helix sends the device's Firebase Cloud Messaging token and the selected printer identifier to Helix's notification relay. The relay uses this information only to deliver printer-event notifications. Notification registration records may include creation, update, delivery, and disablement timestamps.

Users can disable Firebase push notifications in Helix settings. Local notification and ntfy options are also available where supported.

### Camera and photos

Helix can display compatible printer camera feeds and can save user-requested snapshots or spool labels to the device's photo library. Helix does not continuously scan the device's photos and does not sell or use photos for advertising.

### MakerWorld

MakerWorld import is optional. When used, Helix redirects the user to MakerWorld for authentication. Helix does not create a Helix account. MakerWorld handles its own account, authentication, and privacy practices.

## How information is used

Helix uses information to connect to printers, display printer data, import content when requested, save user-requested images, and deliver push notifications. Helix does not use personal information for advertising, profiling, or sale to third parties.

## Sharing and service providers

Firebase Cloud Messaging and the Helix notification relay process the notification token and printer identifier only to deliver requested push notifications. Helix may connect to the user's configured printer and to MakerWorld when the user requests those features. Helix does not sell user information.

## Security and retention

Network requests to the Helix notification relay use HTTPS. Notification registration data is retained only while needed to deliver push notifications and may be disabled when a token is invalid or the user turns notifications off. Printer connection settings and other app preferences remain on the user's device until removed by the user or the app is uninstalled.

## User choices

Users can disable push notifications, remove printer configurations, stop using MakerWorld import, and uninstall Helix at any time. Android and iOS also provide controls for camera, photo-library, and notification permissions.

## Children's privacy

Helix is not directed to children under 13, and Helix does not knowingly collect personal information from children under 13.

## Changes to this policy

This policy may be updated when Helix's data practices change. The latest version will be published in this repository.

## Contact

For privacy questions or requests, open an issue at [github.com/FatBoy721/Helix/issues](https://github.com/FatBoy721/Helix/issues).
