import type { MenuItemConstructorOptions } from 'electron';

/**
 * The macOS menu bar with the app's display name in its labels ("About sbtlTV", "Quit sbtlTV").
 * Electron's default menu writes app.name there, which is the package name (@sbtltv/electron). The app's
 * name itself must not change: the data folder and the Keychain entry for saved logins are derived from it.
 * Everything else keeps Electron's standard roles, so editing, fullscreen and window handling are as before.
 */
export function macMenuTemplate(displayName: string): MenuItemConstructorOptions[] {
  return [
    {
      label: displayName,
      submenu: [
        { role: 'about', label: `About ${displayName}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${displayName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${displayName}` },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
