// Resolve Edge npm: aliases to the same locally installed official dependencies.
declare module 'npm:date-fns@3' { export * from 'date-fns'; }
declare module 'npm:date-fns-tz@3' { export * from 'date-fns-tz'; }
declare module 'npm:ical.js@2.0.1' { export { default } from 'ical.js'; }
